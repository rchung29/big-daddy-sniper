/**
 * Scheduler Service
 * Calculates release windows and triggers scanning at the right time
 *
 * All times are in EST (America/New_York)
 * Uses in-memory store - no direct DB access
 */
import { store } from "../store";
import type { Restaurant, FullSubscription, DayConfig } from "../db/schema";
import { DateTime } from "luxon";
import { logger } from "../logger";

// Default: start scanning 45 seconds before release
const DEFAULT_SCAN_START_SECONDS_BEFORE = 45;

/**
 * Represents a scheduled release window
 */
export interface ReleaseWindow {
  id: string; // Stable key: timezone:releaseTime:targetDate
  releaseTime: string; // HH:mm format
  releaseTimeZone: string;
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
export function calculateTargetDate(
  daysInAdvance: number,
  fromDate = new Date(),
  timezone = "America/New_York"
): string {
  return DateTime.fromJSDate(fromDate)
    .setZone(timezone)
    .plus({ days: daysInAdvance })
    .toFormat("yyyy-MM-dd");
}

/**
 * Parse a time string (HH:mm) and create a Date object for today in the given timezone
 */
export function parseReleaseTime(
  timeStr: string,
  timezone = "America/New_York",
  referenceDate = new Date()
): Date {
  const [hours, minutes] = timeStr.split(":").map(Number);

  // Get today's date in the target timezone, set the time, and convert to JS Date
  const dt = DateTime.fromJSDate(referenceDate)
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
  timezone = "America/New_York",
  referenceDate = new Date()
): Date {
  const [hours, minutes] = releaseTime.split(":").map(Number);
  const now = DateTime.fromJSDate(referenceDate).setZone(timezone);

  let dt = now
    .set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });

  // If release time has passed today, schedule for tomorrow
  if (dt <= now) {
    dt = dt.plus({ days: 1 });
  }

  return dt.toJSDate();
}

/**
 * Stable identifier for a release window.
 */
export function getReleaseWindowId(
  releaseTime: string,
  targetDate: string,
  timezone = "America/New_York"
): string {
  return `${timezone}:${releaseTime}:${targetDate}`;
}

/**
 * Get the day of week (0=Sun, 6=Sat) for a date string (YYYY-MM-DD)
 */
export function getDayOfWeek(dateStr: string): number {
  const weekday = DateTime.fromISO(dateStr, { zone: "UTC" }).weekday;
  return weekday === 7 ? 0 : weekday;
}

/**
 * Get the time window for a specific date from day_configs
 * Returns the matching DayConfig or null if no config for that day
 */
export function getTimeWindowForDate(
  dayConfigs: DayConfig[] | null | undefined,
  targetDate: string
): DayConfig | null {
  if (!dayConfigs || dayConfigs.length === 0) {
    return null;
  }

  const dayOfWeek = getDayOfWeek(targetDate);
  return dayConfigs.find((config) => config.day === dayOfWeek) ?? null;
}

/**
 * Check if a subscription should be active for a given target date
 * Checks day_configs first, then falls back to legacy target_days
 * Returns false if the subscription has day restrictions and the date doesn't match
 */
export function isSubscriptionActiveForDate(
  targetDays: number[] | null,
  targetDate: string,
  dayConfigs?: DayConfig[] | null
): boolean {
  // If day_configs is present, use it for day filtering
  if (dayConfigs && dayConfigs.length > 0) {
    const dayOfWeek = getDayOfWeek(targetDate);
    return dayConfigs.some((config) => config.day === dayOfWeek);
  }

  // Fall back to legacy target_days
  // null or empty means any day is fine
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
  scanStartSecondsBefore = DEFAULT_SCAN_START_SECONDS_BEFORE,
  referenceDate = new Date()
): ReleaseWindow[] {
  const windowMap = new Map<
    string,
    {
      releaseTime: string;
      releaseTimeZone: string;
      releaseDateTime: Date;
      scanStartDateTime: Date;
      targetDate: string;
      subscriptions: FullSubscription[];
    }
  >();

  for (const sub of store.getFullSubscriptions()) {
    const releaseDateTime = getNextReleaseDateTime(
      sub.release_time,
      sub.release_time_zone,
      referenceDate
    );
    const targetDate = calculateTargetDate(
      sub.days_in_advance,
      releaseDateTime,
      sub.release_time_zone
    );
    const isActive = isSubscriptionActiveForDate(sub.target_days, targetDate, sub.day_configs);

    if (!isActive) {
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const dayOfWeek = getDayOfWeek(targetDate);
      const configuredDays = sub.day_configs
        ? sub.day_configs.map((config) => dayNames[config.day]).join(", ")
        : sub.target_days?.map((day) => dayNames[day]).join(", ");

      logger.debug(
        {
          user_id: sub.user_id,
          restaurant: sub.restaurant_name,
          targetDate,
          dayOfWeek: dayNames[dayOfWeek],
          configuredDays,
        },
        "Skipping subscription - target day not in user's preferred days"
      );
      continue;
    }

    const windowId = getReleaseWindowId(sub.release_time, targetDate, sub.release_time_zone);
    const existingWindow = windowMap.get(windowId);

    if (existingWindow) {
      existingWindow.subscriptions.push(sub);
      continue;
    }

    windowMap.set(windowId, {
      releaseTime: sub.release_time,
      releaseTimeZone: sub.release_time_zone,
      releaseDateTime,
      scanStartDateTime: new Date(
        releaseDateTime.getTime() - scanStartSecondsBefore * 1000
      ),
      targetDate,
      subscriptions: [sub],
    });
  }

  return Array.from(windowMap.entries())
    .map(([id, groupedWindow]) => {
      const restaurantMap = new Map<number, Restaurant>();
      for (const sub of groupedWindow.subscriptions) {
        if (restaurantMap.has(sub.restaurant_id)) continue;
        const restaurant = store.getRestaurantById(sub.restaurant_id);
        if (restaurant) {
          restaurantMap.set(sub.restaurant_id, restaurant);
        }
      }

      return {
        id,
        releaseTime: groupedWindow.releaseTime,
        releaseTimeZone: groupedWindow.releaseTimeZone,
        releaseDateTime: groupedWindow.releaseDateTime,
        scanStartDateTime: groupedWindow.scanStartDateTime,
        targetDate: groupedWindow.targetDate,
        restaurants: Array.from(restaurantMap.values()),
        subscriptions: groupedWindow.subscriptions,
      };
    })
    .sort((a, b) => {
      const scanStartDiff = a.scanStartDateTime.getTime() - b.scanStartDateTime.getTime();
      if (scanStartDiff !== 0) {
        return scanStartDiff;
      }
      return a.targetDate.localeCompare(b.targetDate);
    });
}

/**
 * Scheduler class that manages release window timers
 */
export class Scheduler {
  private timers = new Map<string, Timer>();
  private scanStartSecondsBefore: number;
  private onWindowStart?: (window: ReleaseWindow) => void;
  private refreshTimer: Timer | null = null;
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
    store.setReleaseTimesProvider(() => this.getNextReleaseTimes());

    // Register callback to recalculate windows when store syncs
    store.setOnSyncComplete(() => {
      logger.info("Store sync complete - recalculating release windows");
      this.scheduleUpcomingWindows();
    });

    this.scheduleUpcomingWindows();

    // Re-calculate windows every hour to pick up new subscriptions from memory
    this.refreshTimer = setInterval(() => {
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
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
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
      const key = window.id;
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
            windowId: window.id,
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
