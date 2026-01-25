/**
 * Scanner Service
 * Polls restaurants every 1 second to detect slot availability
 * Optionally uses rotating proxies if USE_PROXIES=true
 */
import { ResyClient, ResyAPIError } from "../sdk";
import { getProxyManager } from "./proxy-manager";
import { config } from "../config";
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
const DEFAULT_SCAN_INTERVAL_MS = 1000; // 1 second
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
 * Scan result containing all discovered slots
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
  onSlotsFound?: (result: ScanResult) => void;
}

/**
 * Scanner class that polls for slot availability
 */
export class Scanner {
  private scanIntervalMs: number;
  private scanTimeoutSeconds: number;
  private apiKey: string;
  private onSlotsFound?: (result: ScanResult) => void;
  private activeScans = new Map<string, boolean>(); // window key -> running
  private proxyManager = getProxyManager();

  constructor(config: ScannerConfig = {}) {
    this.scanIntervalMs = config.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS;
    this.scanTimeoutSeconds = config.scanTimeoutSeconds ?? DEFAULT_SCAN_TIMEOUT_SECONDS;
    this.apiKey = config.apiKey ?? process.env.RESY_API_KEY ?? "";
    this.onSlotsFound = config.onSlotsFound;
  }

  /**
   * Start scanning for a release window
   * Continues until slots are found or timeout
   */
  async startScan(window: ReleaseWindow): Promise<ScanResult | null> {
    const windowKey = `${window.releaseTime}-${window.targetDate}`;

    if (this.activeScans.get(windowKey)) {
      logger.warn({ windowKey }, "Scan already active for this window");
      return null;
    }

    this.activeScans.set(windowKey, true);
    const startTime = Date.now();
    const timeoutMs = this.scanTimeoutSeconds * 1000;

    logger.info(
      {
        releaseTime: window.releaseTime,
        targetDate: window.targetDate,
        restaurants: window.restaurants.map((r) => r.name),
        scanInterval: this.scanIntervalMs,
        timeout: this.scanTimeoutSeconds,
      },
      "Starting slot scan"
    );

    let scanCount = 0;

    try {
      while (this.activeScans.get(windowKey)) {
        const elapsed = Date.now() - startTime;
        if (elapsed > timeoutMs) {
          logger.info(
            { windowKey, scanCount, elapsed },
            "Scan timeout reached without finding slots"
          );
          break;
        }

        scanCount++;
        const scanStartTime = Date.now();

        // Scan all restaurants in parallel
        const results = await this.scanAllRestaurants(window);

        if (results.length > 0) {
          logger.info(
            {
              windowKey,
              slotsFound: results.length,
              scanCount,
              elapsed: Date.now() - startTime,
            },
            "Slots discovered!"
          );

          const scanResult: ScanResult = {
            window,
            slots: results,
            elapsedMs: Date.now() - startTime,
          };

          if (this.onSlotsFound) {
            this.onSlotsFound(scanResult);
          }

          this.activeScans.delete(windowKey);
          return scanResult;
        }

        // Calculate time to next scan
        const scanDuration = Date.now() - scanStartTime;
        const sleepTime = Math.max(0, this.scanIntervalMs - scanDuration);

        if (sleepTime > 0) {
          await sleep(sleepTime);
        }

        // Log progress every 10 scans
        if (scanCount % 10 === 0) {
          logger.debug(
            { windowKey, scanCount, elapsed: Date.now() - startTime },
            "Scan progress"
          );
        }
      }
    } finally {
      this.activeScans.delete(windowKey);
    }

    return null;
  }

  /**
   * Scan all restaurants in a window
   */
  private async scanAllRestaurants(window: ReleaseWindow): Promise<DiscoveredSlot[]> {
    const discovered: DiscoveredSlot[] = [];

    // Group restaurants by unique venue_id to avoid duplicate requests
    const uniqueRestaurants = new Map<string, Restaurant>();
    for (const r of window.restaurants) {
      uniqueRestaurants.set(r.venue_id, r);
    }

    // Scan each restaurant with rotating proxies
    const scanPromises = Array.from(uniqueRestaurants.values()).map(async (restaurant) => {
      try {
        const slots = await this.scanRestaurant(restaurant, window);
        return slots;
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
    });

    const results = await Promise.all(scanPromises);
    for (const slots of results) {
      discovered.push(...slots);
    }

    return discovered;
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
