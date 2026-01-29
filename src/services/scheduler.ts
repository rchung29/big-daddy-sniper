/**
 * Scheduler Service
 * Calculates release windows and triggers scanning at the right time
 *
 * All times are in EST (America/New_York)
 * Uses in-memory store - no direct DB access
 */
import { store } from "../store";
import type { Restaurant, FullSubscription } from "../db/schema";
import { DateTime } from "luxon";
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

// Default: start scanning 45 seconds before release
const DEFAULT_SCAN_START_SECONDS_BEFORE = 45;

/**
 * Represents a scheduled release window
 */
export interface ReleaseWindow {
  releaseTime: string; // HH:mm format
  releaseDateTime: Date; // Exact datetime of release
  scanStartDateTime: Date; // When to start scanning
  targetDate: string; // The date we're trying to book (YYYY-MM-DD)
  restaurants: Restaurant[];
  subscriptions: FullSubscription[];
}

/**
 * Calculate the target date for a restaurant based on days_in_advance
 * If reservations open 30 days in advance, and release time is 10:00 AM,
 * then at 10:00 AM today, the date 30 days from now becomes available
 */
export function calculateTargetDate(daysInAdvance: number, fromDate = new Date()): string {
  const target = new Date(fromDate);
  target.setDate(target.getDate() + daysInAdvance);
  return target.toISOString().split("T")[0];
}

/**
 * Parse a time string (HH:mm) and create a Date object for today in the given timezone
 */
export function parseReleaseTime(
  timeStr: string,
  timezone = "America/New_York"
): Date {
  const [hours, minutes] = timeStr.split(":").map(Number);

  // Get today's date in the target timezone, set the time, and convert to JS Date
  const dt = DateTime.now()
    .setZone(timezone)
    .set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });

  return dt.toJSDate();
}

/**
 * Get the next release datetime for a given release time
 * If the time has passed today, return tomorrow's release time
 */
export function getNextReleaseDateTime(
  releaseTime: string,
  timezone = "America/New_York"
): Date {
  const [hours, minutes] = releaseTime.split(":").map(Number);

  let dt = DateTime.now()
    .setZone(timezone)
    .set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });

  // If release time has passed today, schedule for tomorrow
  if (dt <= DateTime.now()) {
    dt = dt.plus({ days: 1 });
  }

  return dt.toJSDate();
}

/**
 * Get the day of week (0=Sun, 6=Sat) for a date string (YYYY-MM-DD)
 */
export function getDayOfWeek(dateStr: string): number {
  const date = new Date(dateStr + "T12:00:00"); // Use noon to avoid timezone issues
  return date.getDay();
}

/**
 * Check if a subscription should be active for a given target date
 * Returns false if the subscription has target_days set and the date doesn't match
 */
export function isSubscriptionActiveForDate(
  targetDays: number[] | null,
  targetDate: string
): boolean {
  // null means any day is fine
  if (!targetDays || targetDays.length === 0) {
    return true;
  }

  const dayOfWeek = getDayOfWeek(targetDate);
  return targetDays.includes(dayOfWeek);
}

/**
 * Calculate all upcoming release windows from in-memory store
 * Filters out subscriptions where target_days doesn't match the target date
 */
export function calculateReleaseWindows(
  scanStartSecondsBefore = DEFAULT_SCAN_START_SECONDS_BEFORE
): ReleaseWindow[] {
  const subscriptionsByReleaseTime = store.getSubscriptionsGroupedByReleaseTime();
  const windows: ReleaseWindow[] = [];

  for (const [releaseTime, allSubscriptions] of subscriptionsByReleaseTime) {
    if (allSubscriptions.length === 0) continue;

    const releaseDateTime = getNextReleaseDateTime(releaseTime);
    const scanStartDateTime = new Date(
      releaseDateTime.getTime() - scanStartSecondsBefore * 1000
    );

    // Filter subscriptions by target_days
    // Each subscription may have a different days_in_advance, so calculate per-subscription
    const activeSubscriptions = allSubscriptions.filter((sub) => {
      const targetDate = calculateTargetDate(sub.days_in_advance);
      const isActive = isSubscriptionActiveForDate(sub.target_days, targetDate);

      if (!isActive) {
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const dayOfWeek = getDayOfWeek(targetDate);
        logger.debug(
          {
            user_id: sub.user_id,
            restaurant: sub.restaurant_name,
            targetDate,
            dayOfWeek: dayNames[dayOfWeek],
            targetDays: sub.target_days?.map(d => dayNames[d]).join(", "),
          },
          "Skipping subscription - target day not in user's preferred days"
        );
      }

      return isActive;
    });

    // Skip this window entirely if no active subscriptions
    if (activeSubscriptions.length === 0) {
      logger.debug(
        { releaseTime },
        "No active subscriptions for this release window after day filter"
      );
      continue;
    }

    // Get unique restaurants for active subscriptions only
    const restaurantMap = new Map<number, Restaurant>();
    for (const sub of activeSubscriptions) {
      if (!restaurantMap.has(sub.restaurant_id)) {
        const restaurant = store.getRestaurantById(sub.restaurant_id);
        if (restaurant) {
          restaurantMap.set(sub.restaurant_id, restaurant);
        }
      }
    }

    // Use first active subscription's days_in_advance for the primary target date
    const primaryTargetDate = calculateTargetDate(activeSubscriptions[0].days_in_advance);

    windows.push({
      releaseTime,
      releaseDateTime,
      scanStartDateTime,
      targetDate: primaryTargetDate,
      restaurants: Array.from(restaurantMap.values()),
      subscriptions: activeSubscriptions,
    });
  }

  // Sort by scan start time
  windows.sort((a, b) => a.scanStartDateTime.getTime() - b.scanStartDateTime.getTime());

  return windows;
}

/**
 * Scheduler class that manages release window timers
 */
export class Scheduler {
  private timers = new Map<string, Timer>();
  private scanStartSecondsBefore: number;
  private onWindowStart?: (window: ReleaseWindow) => void;
  private running = false;

  constructor(
    config: {
      scanStartSecondsBefore?: number;
      onWindowStart?: (window: ReleaseWindow) => void;
    } = {}
  ) {
    this.scanStartSecondsBefore =
      config.scanStartSecondsBefore ?? DEFAULT_SCAN_START_SECONDS_BEFORE;
    this.onWindowStart = config.onWindowStart;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.running) {
      logger.warn("Scheduler already running");
      return;
    }

    this.running = true;
    logger.info("Starting scheduler");

    // Register callback with store for blackout window detection
    store.setReleasTimeCallback(() => this.getNextReleaseTimes());

    // Register callback to recalculate windows when store syncs
    store.setOnSyncComplete(() => {
      logger.info("Store sync complete - recalculating release windows");
      this.scheduleUpcomingWindows();
    });

    this.scheduleUpcomingWindows();

    // Re-calculate windows every hour to pick up new subscriptions from memory
    setInterval(() => {
      if (this.running) {
        this.scheduleUpcomingWindows();
      }
    }, 60 * 60 * 1000);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    this.running = false;
    for (const [key, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    logger.info("Scheduler stopped");
  }

  /**
   * Get next release times (for store blackout window detection)
   */
  private getNextReleaseTimes(): Date[] {
    const windows = calculateReleaseWindows(this.scanStartSecondsBefore);
    return windows.map((w) => w.releaseDateTime);
  }

  /**
   * Schedule timers for upcoming release windows
   */
  private scheduleUpcomingWindows(): void {
    const windows = calculateReleaseWindows(this.scanStartSecondsBefore);
    const now = Date.now();

    logger.info(
      { windowCount: windows.length },
      "Calculating upcoming release windows"
    );

    for (const window of windows) {
      const key = `${window.releaseTime}-${window.targetDate}`;
      const msUntilScan = window.scanStartDateTime.getTime() - now;

      // Only schedule if scan start is in the future and within 24 hours
      if (msUntilScan > 0 && msUntilScan < 24 * 60 * 60 * 1000) {
        // Don't reschedule if already scheduled
        if (this.timers.has(key)) continue;

        const timer = setTimeout(() => {
          this.handleWindowStart(window);
          this.timers.delete(key);
        }, msUntilScan);

        this.timers.set(key, timer);

        const minutesUntil = Math.round(msUntilScan / 60000);
        logger.info(
          {
            releaseTime: window.releaseTime,
            targetDate: window.targetDate,
            scanStartsIn: `${minutesUntil} minutes`,
            restaurantCount: window.restaurants.length,
            subscriptionCount: window.subscriptions.length,
          },
          "Scheduled release window"
        );
      }
    }
  }

  /**
   * Handle the start of a release window
   */
  private handleWindowStart(window: ReleaseWindow): void {
    logger.info(
      {
        releaseTime: window.releaseTime,
        targetDate: window.targetDate,
        restaurants: window.restaurants.map((r) => r.name),
        subscriptions: window.subscriptions.length,
      },
      "Release window starting - beginning scan"
    );

    if (this.onWindowStart) {
      this.onWindowStart(window);
    }
  }

  /**
   * Get currently scheduled windows
   */
  getScheduledWindows(): string[] {
    return Array.from(this.timers.keys());
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    running: boolean;
    scheduledWindows: number;
    upcomingWindows: ReleaseWindow[];
  } {
    return {
      running: this.running,
      scheduledWindows: this.timers.size,
      upcomingWindows: calculateReleaseWindows(this.scanStartSecondsBefore),
    };
  }

  /**
   * Manually trigger a window (for testing)
   */
  triggerWindow(releaseTime: string): void {
    const windows = calculateReleaseWindows(this.scanStartSecondsBefore);
    const window = windows.find((w) => w.releaseTime === releaseTime);
    if (window) {
      this.handleWindowStart(window);
    } else {
      logger.warn({ releaseTime }, "No window found for release time");
    }
  }
}

// Singleton instance
let scheduler: Scheduler | null = null;

/**
 * Get the scheduler singleton
 */
export function getScheduler(
  config?: {
    scanStartSecondsBefore?: number;
    onWindowStart?: (window: ReleaseWindow) => void;
  }
): Scheduler {
  if (!scheduler) {
    scheduler = new Scheduler(config);
  }
  return scheduler;
}
