/**
 * Passive Monitor Service
 *
 * Polls calendar endpoints to detect available dates, matches to subscriptions
 * by day-of-week filter, fetches slots, and routes to BookingCoordinator.
 *
 * Flow:
 * 1. Get all FullSubscriptions (subscription + user + restaurant joined)
 * 2. Group by (venue_id, party_size) -> CalendarTarget
 * 3. Poll calendar for each target
 * 4. For each available date found, filter subscriptions by day-of-week
 * 5. If matches, fetch slots and route to BookingCoordinator
 */
import { DateTime } from "luxon";
import { ResyClient } from "../sdk";
import { store } from "../store";
import { PassiveProxyPool } from "./passive-proxy-pool";
import type { FullSubscription, Restaurant } from "../db/schema";
import type { DiscoveredSlot } from "./scanner";
import type { SlotInfo } from "../filters";
import { logger } from "../logger";

// Standard release times to blackout around (ET timezone)
const RELEASE_TIMES = ["00:00", "07:00", "09:00", "10:00", "12:00"];

/**
 * Calendar polling target - groups subscriptions by venue+partySize
 */
interface CalendarTarget {
  venueId: string;
  restaurantId: number;
  restaurantName: string;
  partySize: number;
  daysInAdvance: number;
  subscriptionIds: number[];
}

/**
 * Event callbacks for dashboard integration
 */
export interface PassiveMonitorCallbacks {
  onPollError?: (restaurant: string, error: string) => void;
  onBlackoutStart?: () => void;
  onBlackoutEnd?: () => void;
}

/**
 * Configuration for passive monitor
 */
export interface PassiveMonitorConfig {
  apiKey?: string;
  pollIntervalMs: number;
  blackoutMinutes: number;
  onSlotsDiscovered: (
    slots: DiscoveredSlot[],
    restaurant: Restaurant,
    date: string,
    matchingSubs: FullSubscription[]
  ) => void;
  callbacks?: PassiveMonitorCallbacks;
}

/**
 * Passive Monitor Service
 */
export class PassiveMonitorService {
  private apiKey: string;
  private proxyPool: PassiveProxyPool;
  private pollIntervalMs: number;
  private blackoutMinutes: number;
  private onSlotsDiscovered: PassiveMonitorConfig["onSlotsDiscovered"];
  private callbacks: PassiveMonitorCallbacks;

  private targets: CalendarTarget[] = [];
  private running = false;
  private pollTimer: Timer | null = null;
  private wasInBlackout = false;

  constructor(config: PassiveMonitorConfig) {
    this.apiKey = config.apiKey ?? process.env.RESY_API_KEY ?? "";
    this.proxyPool = new PassiveProxyPool();
    this.pollIntervalMs = config.pollIntervalMs;
    this.blackoutMinutes = config.blackoutMinutes;
    this.onSlotsDiscovered = config.onSlotsDiscovered;
    this.callbacks = config.callbacks ?? {};
  }

  /**
   * Start the passive monitor
   */
  start(): void {
    if (this.running) {
      logger.warn("Passive monitor already running");
      return;
    }

    this.proxyPool.initialize();
    this.rebuildTargets();
    this.running = true;

    logger.info(
      {
        targetCount: this.targets.length,
        pollIntervalMs: this.pollIntervalMs,
        blackoutMinutes: this.blackoutMinutes,
      },
      "Passive monitor started"
    );

    // Start polling loop
    this.schedulePoll();
  }

  /**
   * Stop the passive monitor
   */
  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info("Passive monitor stopped");
  }

  /**
   * Schedule the next poll cycle
   */
  private schedulePoll(): void {
    if (!this.running) return;

    this.pollTimer = setTimeout(async () => {
      await this.pollCycle();
      this.schedulePoll();
    }, this.pollIntervalMs);
  }

  /**
   * Execute one poll cycle
   */
  private async pollCycle(): Promise<void> {
    // Check if in blackout window
    const inBlackout = this.isInBlackoutWindow();

    if (inBlackout) {
      if (!this.wasInBlackout) {
        // Just entered blackout
        this.wasInBlackout = true;
        this.callbacks.onBlackoutStart?.();
        logger.debug("Entering blackout window - pausing passive monitor");
      }
      return;
    } else if (this.wasInBlackout) {
      // Just exited blackout
      this.wasInBlackout = false;
      this.callbacks.onBlackoutEnd?.();
      logger.debug("Exiting blackout window - resuming passive monitor");
    }

    // Rebuild targets in case subscriptions changed
    this.rebuildTargets();

    if (this.targets.length === 0) {
      logger.debug("No targets to poll");
      return;
    }

    logger.debug({ targetCount: this.targets.length }, "Starting poll cycle");

    // Poll each target sequentially to avoid rate limiting
    for (const target of this.targets) {
      if (!this.running) break;

      try {
        await this.pollTarget(target);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(
          {
            restaurant: target.restaurantName,
            error: errorMsg,
          },
          "Error polling calendar"
        );
        this.callbacks.onPollError?.(target.restaurantName, errorMsg);
      }

      // Small delay between targets to be gentle on the API
      await sleep(500);
    }
  }

  /**
   * Poll calendar for a single target
   */
  private async pollTarget(target: CalendarTarget): Promise<void> {
    const proxy = this.proxyPool.getNext();

    const client = new ResyClient({
      apiKey: this.apiKey,
      proxyUrl: proxy?.url,
    });

    const today = DateTime.now().setZone("America/New_York");
    const endDate = today.plus({ days: target.daysInAdvance });

    const response = await client.getCalendar({
      venue_id: target.venueId,
      num_seats: target.partySize,
      start_date: today.toFormat("yyyy-MM-dd"),
      end_date: endDate.toFormat("yyyy-MM-dd"),
    });

    // Find available dates
    const availableDates = response.scheduled
      .filter((day) => day.inventory.reservation === "available")
      .map((day) => day.date);

    if (availableDates.length === 0) {
      return;
    }

    logger.debug(
      {
        restaurant: target.restaurantName,
        partySize: target.partySize,
        availableDates,
      },
      "Found available dates in calendar"
    );

    // Process each available date
    await this.onAvailabilityFound(target, availableDates, client);
  }

  /**
   * Handle availability found for a target
   */
  private async onAvailabilityFound(
    target: CalendarTarget,
    availableDates: string[],
    client: ResyClient
  ): Promise<void> {
    for (const date of availableDates) {
      // Find subscriptions that want this specific day of week
      const matchingSubs = this.matchSubscriptionsToDate(target, date);

      if (matchingSubs.length === 0) {
        logger.debug(
          { date, venue: target.restaurantName },
          "Available date but no subscriptions want this day of week"
        );
        continue;
      }

      logger.info(
        {
          date,
          venue: target.restaurantName,
          partySize: target.partySize,
          matchingUsers: matchingSubs.length,
        },
        "Found availability with matching subscriptions"
      );

      // Fetch actual slots
      try {
        const findResponse = await client.findSlots({
          venue_id: target.venueId,
          day: date,
          party_size: target.partySize,
        });

        const venue = findResponse.results?.venues?.[0];
        const rawSlots = venue?.slots ?? [];

        if (rawSlots.length === 0) {
          logger.debug(
            { date, venue: target.restaurantName },
            "No slots returned from find endpoint"
          );
          continue;
        }

        // Convert to SlotInfo/DiscoveredSlot format
        const restaurant = store.getRestaurantById(target.restaurantId);
        if (!restaurant) continue;

        const venueName = venue?.venue?.name ?? target.restaurantName;

        const discoveredSlots: DiscoveredSlot[] = rawSlots.map((slot) => ({
          restaurant,
          targetDate: date,
          slot: {
            config_id: slot.config?.token ?? "",
            time: slot.date?.start ?? "",
            type: slot.config?.type ?? undefined,
          } as SlotInfo,
          venueName,
        }));

        logger.info(
          {
            date,
            venue: target.restaurantName,
            slotsFound: discoveredSlots.length,
            slots: discoveredSlots.map((s) => ({
              time: s.slot.time,
              type: s.slot.type,
            })),
          },
          "Slots discovered via passive monitor - routing to coordinator"
        );

        // Route to coordinator with pre-matched subscriptions
        // Coordinator handles deduplication (won't re-book if already successful)
        this.onSlotsDiscovered(discoveredSlots, restaurant, date, matchingSubs);
      } catch (error) {
        logger.error(
          {
            date,
            venue: target.restaurantName,
            error: error instanceof Error ? error.message : String(error),
          },
          "Error fetching slots"
        );
      }
    }
  }

  /**
   * Rebuild targets from current subscriptions
   */
  private rebuildTargets(): void {
    const subscriptions = store.getFullSubscriptions();
    const targetMap = new Map<string, CalendarTarget>();

    for (const sub of subscriptions) {
      const key = `${sub.venue_id}:${sub.party_size}`;

      if (!targetMap.has(key)) {
        targetMap.set(key, {
          venueId: sub.venue_id,
          restaurantId: sub.restaurant_id,
          restaurantName: sub.restaurant_name,
          partySize: sub.party_size,
          daysInAdvance: sub.days_in_advance,
          subscriptionIds: [],
        });
      }
      targetMap.get(key)!.subscriptionIds.push(sub.id);
    }

    this.targets = Array.from(targetMap.values());

    logger.debug(
      {
        targetCount: this.targets.length,
        targets: this.targets.map((t) => ({
          venue: t.restaurantName,
          partySize: t.partySize,
          subs: t.subscriptionIds.length,
        })),
      },
      "Rebuilt calendar targets"
    );
  }

  /**
   * Match subscriptions to a specific date based on day-of-week filter
   */
  private matchSubscriptionsToDate(
    target: CalendarTarget,
    date: string
  ): FullSubscription[] {
    // Get day of week (0=Sun, 6=Sat) - Luxon weekday is 1=Mon, 7=Sun
    const luxonWeekday = DateTime.fromISO(date).weekday;
    const dayOfWeek = luxonWeekday === 7 ? 0 : luxonWeekday; // Convert to 0=Sun

    const allSubs = store.getFullSubscriptions();
    const targetSubs = allSubs.filter((s) =>
      target.subscriptionIds.includes(s.id)
    );

    // Filter by day-of-week preference
    return targetSubs.filter((sub) => {
      if (!sub.target_days || sub.target_days.length === 0) {
        return true; // No filter = wants any day
      }
      return sub.target_days.includes(dayOfWeek);
    });
  }

  /**
   * Check if we're in a blackout window around release times
   */
  private isInBlackoutWindow(): boolean {
    const now = DateTime.now().setZone("America/New_York");
    const currentMins = now.hour * 60 + now.minute;

    for (const releaseTime of RELEASE_TIMES) {
      const [h, m] = releaseTime.split(":").map(Number);
      const releaseMins = h * 60 + m;

      // Check if within blackout window
      const diff = Math.abs(currentMins - releaseMins);
      // Handle midnight wrap-around
      const wrappedDiff = Math.min(diff, 24 * 60 - diff);

      if (wrappedDiff <= this.blackoutMinutes) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get monitor status
   */
  getStatus(): {
    running: boolean;
    targetCount: number;
    proxyPool: { total: number; ids: number[] };
  } {
    return {
      running: this.running,
      targetCount: this.targets.length,
      proxyPool: this.proxyPool.getStatus(),
    };
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
