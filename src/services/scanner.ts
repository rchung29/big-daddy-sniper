/**
 * Scanner Service
 *
 * Push-based architecture:
 * - Scans ALL restaurants in parallel each iteration
 * - Tracks per-restaurant completion (completedRestaurants Set)
 * - When slots found: emit to callback immediately, mark restaurant done
 * - Keeps scanning non-completed restaurants for full 2-minute window
 *
 * Optionally uses rotating proxies if USE_PROXIES=true
 */
import { ResyClient, ResyAPIError } from "../sdk";
import { getProxyManager } from "./proxy-manager";
import { config } from "../config";
import { store } from "../store";
import type { ReleaseWindow } from "./scheduler";
import type { Restaurant } from "../db/schema";
import { filterSlots, type SlotInfo } from "../filters";
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

// Default configuration
const DEFAULT_SCAN_INTERVAL_MS = 2000; // 2 seconds between scans to avoid proxy bans
const DEFAULT_SCAN_TIMEOUT_SECONDS = 120; // 2 minutes after release

/**
 * Slot data with restaurant context
 */
export interface DiscoveredSlot {
  restaurant: Restaurant;
  targetDate: string;
  slot: SlotInfo;
  venueName: string;
}

/**
 * Scan result containing all discovered slots (legacy, for backwards compatibility)
 */
export interface ScanResult {
  window: ReleaseWindow;
  slots: DiscoveredSlot[];
  elapsedMs: number;
}

/**
 * Scanner configuration
 */
export interface ScannerConfig {
  scanIntervalMs?: number;
  scanTimeoutSeconds?: number;
  apiKey?: string;
  /** @deprecated Use onSlotsDiscovered instead for push-based architecture */
  onSlotsFound?: (result: ScanResult) => void;
  /** Called immediately when slots are found for a restaurant - non-blocking */
  onSlotsDiscovered?: (slots: DiscoveredSlot[], restaurant: Restaurant) => void;
  /** Called when scan window completes (2min timeout or all restaurants found slots) */
  onScanComplete?: (window: ReleaseWindow, stats: ScanStats) => void;
}

/**
 * Statistics for a completed scan
 */
export interface ScanStats {
  totalIterations: number;
  totalSlotsFound: number;
  restaurantsWithSlots: number;
  restaurantsWithoutSlots: number;
  elapsedMs: number;
}

/**
 * Scanner class that polls for slot availability
 */
export class Scanner {
  private scanIntervalMs: number;
  private scanTimeoutSeconds: number;
  private apiKey: string;
  private onSlotsFound?: (result: ScanResult) => void;
  private onSlotsDiscovered?: (slots: DiscoveredSlot[], restaurant: Restaurant) => void;
  private onScanComplete?: (window: ReleaseWindow, stats: ScanStats) => void;
  private activeScans = new Map<string, boolean>(); // window key -> running
  private proxyManager = getProxyManager();

  // Per-scan state (reset for each window)
  private completedRestaurants = new Set<number>(); // Restaurant IDs that found slots
  private totalSlotsFound = 0;

  constructor(config: ScannerConfig = {}) {
    this.scanIntervalMs = config.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS;
    this.scanTimeoutSeconds = config.scanTimeoutSeconds ?? DEFAULT_SCAN_TIMEOUT_SECONDS;
    this.apiKey = config.apiKey ?? process.env.RESY_API_KEY ?? "";
    this.onSlotsFound = config.onSlotsFound;
    this.onSlotsDiscovered = config.onSlotsDiscovered;
    this.onScanComplete = config.onScanComplete;
  }

  /**
   * Start scanning for a release window
   * Push-based: emits slots immediately as found, continues scanning other restaurants
   */
  async startScan(window: ReleaseWindow): Promise<ScanResult | null> {
    const windowKey = `${window.releaseTime}-${window.targetDate}`;

    if (this.activeScans.get(windowKey)) {
      logger.warn({ windowKey }, "Scan already active for this window");
      return null;
    }

    // Reset per-scan state
    this.completedRestaurants.clear();
    this.totalSlotsFound = 0;

    this.activeScans.set(windowKey, true);
    const startTime = Date.now();
    const timeoutMs = this.scanTimeoutSeconds * 1000;

    logger.info(
      {
        releaseTime: window.releaseTime,
        targetDate: window.targetDate,
        restaurants: window.restaurants.map((r) => r.name),
        restaurantCount: window.restaurants.length,
        scanInterval: this.scanIntervalMs,
        timeout: this.scanTimeoutSeconds,
      },
      "Starting slot scan (push-based)"
    );

    let scanCount = 0;
    const allDiscoveredSlots: DiscoveredSlot[] = [];

    try {
      while (this.activeScans.get(windowKey)) {
        const elapsed = Date.now() - startTime;
        if (elapsed > timeoutMs) {
          logger.info(
            {
              windowKey,
              scanCount,
              elapsed,
              completedRestaurants: this.completedRestaurants.size,
              totalRestaurants: window.restaurants.length,
            },
            "Scan timeout reached"
          );
          break;
        }

        // Only scan restaurants not yet completed
        const pendingRestaurants = window.restaurants.filter(
          (r) => !this.completedRestaurants.has(r.id)
        );

        if (pendingRestaurants.length === 0) {
          logger.info(
            { windowKey, scanCount, elapsed: Date.now() - startTime },
            "All restaurants found slots - scan complete"
          );
          break;
        }

        scanCount++;
        const scanStartTime = Date.now();

        // Scan pending restaurants in parallel
        const results = await Promise.all(
          pendingRestaurants.map((r) => this.scanRestaurantAndEmit(r, window))
        );

        // Collect slots for backwards compatibility
        for (const slots of results) {
          allDiscoveredSlots.push(...slots);
        }

        // Calculate time to next scan with jitter (±500ms) to avoid predictable patterns
        const scanDuration = Date.now() - scanStartTime;
        const jitter = Math.floor(Math.random() * 1000) - 500; // -500 to +500ms
        const sleepTime = Math.max(0, this.scanIntervalMs - scanDuration + jitter);

        if (sleepTime > 0) {
          await sleep(sleepTime);
        }

        // Log progress every 10 scans
        if (scanCount % 10 === 0) {
          logger.debug(
            {
              windowKey,
              scanCount,
              elapsed: Date.now() - startTime,
              pendingRestaurants: pendingRestaurants.length,
              completedRestaurants: this.completedRestaurants.size,
            },
            "Scan progress"
          );
        }
      }
    } finally {
      this.activeScans.delete(windowKey);
    }

    const elapsedMs = Date.now() - startTime;

    // Call scan complete callback
    if (this.onScanComplete) {
      const stats: ScanStats = {
        totalIterations: scanCount,
        totalSlotsFound: this.totalSlotsFound,
        restaurantsWithSlots: this.completedRestaurants.size,
        restaurantsWithoutSlots: window.restaurants.length - this.completedRestaurants.size,
        elapsedMs,
      };
      this.onScanComplete(window, stats);
    }

    // Backwards compatibility: if using legacy onSlotsFound callback
    if (this.onSlotsFound && allDiscoveredSlots.length > 0) {
      const scanResult: ScanResult = {
        window,
        slots: allDiscoveredSlots,
        elapsedMs,
      };
      this.onSlotsFound(scanResult);
      return scanResult;
    }

    return allDiscoveredSlots.length > 0
      ? { window, slots: allDiscoveredSlots, elapsedMs }
      : null;
  }

  /**
   * Scan a single restaurant and emit slots immediately if found
   */
  private async scanRestaurantAndEmit(
    restaurant: Restaurant,
    window: ReleaseWindow
  ): Promise<DiscoveredSlot[]> {
    try {
      const slots = await this.scanRestaurant(restaurant, window);

      if (slots.length > 0) {
        // Mark restaurant as done - won't scan again
        this.completedRestaurants.add(restaurant.id);
        this.totalSlotsFound += slots.length;

        logger.info(
          {
            restaurant: restaurant.name,
            slotsFound: slots.length,
            slots: slots.map((s) => ({ time: s.slot.time, type: s.slot.type })),
          },
          "Slots discovered - emitting to coordinator"
        );

        // Fire callback immediately - non-blocking
        if (this.onSlotsDiscovered) {
          // Use setImmediate to ensure non-blocking
          setImmediate(() => {
            this.onSlotsDiscovered!(slots, restaurant);
          });
        }

        return slots;
      }

      return [];
    } catch (error) {
      if (error instanceof ResyAPIError && error.status === 429) {
        // Rate limited - if using proxies, mark the last used proxy
        if (config.USE_PROXIES) {
          const proxy = this.proxyManager.getRotatingProxy();
          if (proxy) {
            this.proxyManager.markRateLimited(proxy.id);
          }
        }
        logger.warn({ restaurant: restaurant.name }, "Rate limited during scan");
      } else {
        logger.error(
          { restaurant: restaurant.name, error: String(error) },
          "Error scanning restaurant"
        );
      }
      return [];
    }
  }

  /**
   * Scan a single restaurant for available slots
   */
  private async scanRestaurant(
    restaurant: Restaurant,
    window: ReleaseWindow
  ): Promise<DiscoveredSlot[]> {
    // Conditionally use proxy based on config
    const proxy = config.USE_PROXIES ? this.proxyManager.getRotatingProxy() : null;

    // Create a client (with or without proxy)
    const client = new ResyClient({
      apiKey: this.apiKey,
      proxyUrl: proxy?.url,
    });

    // Calculate target date based on this restaurant's days_in_advance
    const targetDate = this.calculateTargetDate(restaurant.days_in_advance);

    // Get subscriptions for this restaurant to know party sizes to check
    const subscriptions = window.subscriptions.filter(
      (s) => s.restaurant_id === restaurant.id
    );

    // Get unique party sizes to check
    const partySizes = [...new Set(subscriptions.map((s) => s.party_size))];

    const discovered: DiscoveredSlot[] = [];

    for (const partySize of partySizes) {
      try {
        const findResult = await client.findSlots({
          venue_id: Number(restaurant.venue_id),
          day: targetDate,
          party_size: partySize,
        });

        const venue = findResult.results?.venues?.[0];
        if (!venue) continue;

        const venueName = venue.venue?.name ?? restaurant.name;
        const rawSlots = venue.slots ?? [];

        if (rawSlots.length === 0) continue;

        // Log raw slots for debugging drops
        const slotData = rawSlots.map((s) => ({
          time: s.date?.start ?? "",
          type: s.config?.type ?? null,
        }));

        logger.info(
          {
            restaurant: restaurant.name,
            partySize,
            targetDate,
            slotCount: rawSlots.length,
            slots: slotData,
          },
          "Raw slots from API"
        );

        // Save to DB async (fire-and-forget, off hot path)
        store.saveSlotSnapshot({
          restaurant_id: restaurant.id,
          restaurant_name: restaurant.name,
          target_date: targetDate,
          party_size: partySize,
          slot_count: rawSlots.length,
          slots: slotData,
        });

        // Convert to SlotInfo format
        const slotInfos: SlotInfo[] = rawSlots.map((slot) => ({
          config_id: slot.config?.token ?? "",
          time: slot.date?.start ?? "",
          type: slot.config?.type ?? undefined,
        }));

        // Filter slots based on subscribed users' preferences
        for (const sub of subscriptions.filter((s) => s.party_size === partySize)) {
          const matchingSlots = filterSlots(slotInfos, {
            id: restaurant.venue_id,
            party_size: sub.party_size,
            time_window: {
              start: sub.time_window_start,
              end: sub.time_window_end,
            },
            table_types: sub.table_types ?? undefined,
            target_dates: [targetDate],
          });

          for (const slot of matchingSlots) {
            discovered.push({
              restaurant,
              targetDate,
              slot,
              venueName,
            });
          }
        }
      } catch (error) {
        // Let parent handle the error
        throw error;
      }
    }

    return discovered;
  }

  /**
   * Calculate target date from days in advance
   */
  private calculateTargetDate(daysInAdvance: number): string {
    const target = new Date();
    target.setDate(target.getDate() + daysInAdvance);
    return target.toISOString().split("T")[0];
  }

  /**
   * Stop an active scan
   */
  stopScan(windowKey: string): void {
    if (this.activeScans.has(windowKey)) {
      this.activeScans.set(windowKey, false);
      logger.info({ windowKey }, "Stopping scan");
    }
  }

  /**
   * Stop all active scans
   */
  stopAllScans(): void {
    for (const key of this.activeScans.keys()) {
      this.activeScans.set(key, false);
    }
    logger.info("Stopping all scans");
  }

  /**
   * Check if a scan is active
   */
  isScanActive(windowKey: string): boolean {
    return this.activeScans.get(windowKey) ?? false;
  }

  /**
   * Get active scan count
   */
  getActiveScanCount(): number {
    return Array.from(this.activeScans.values()).filter(Boolean).length;
  }

  /**
   * Get per-restaurant completion status for active scan
   */
  getCompletedRestaurants(): Set<number> {
    return new Set(this.completedRestaurants);
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Singleton instance
let scanner: Scanner | null = null;

/**
 * Get the scanner singleton
 */
export function getScanner(config?: ScannerConfig): Scanner {
  if (!scanner) {
    scanner = new Scanner(config);
  }
  return scanner;
}
