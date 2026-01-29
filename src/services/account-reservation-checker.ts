/**
 * Account Reservation Checker
 *
 * Prefetches existing reservations for accounts before a booking window starts.
 * Accounts with existing reservations on the target date are excluded from booking
 * attempts since Resy may return the existing reservation instead of creating a new one.
 *
 * Design principles:
 * - Uses datacenter proxies (not ISP) to preserve ISP pool for booking
 * - Fetches 5 accounts in parallel to avoid rate limiting
 * - Fails open: if fetch fails, allow booking attempt anyway
 */
import type { FullSubscription } from "../db/schema";
import type { ProxyManager } from "./proxy-manager";
import { ResyClient } from "../sdk";
import { logger } from "../logger";

// Concurrency limit for fetching reservations
const FETCH_CONCURRENCY = 5;

/**
 * Represents an existing reservation on an account
 */
export interface ExistingReservation {
  date: string; // YYYY-MM-DD
  venueId: number;
  venueName: string;
  timeSlot: string;
}

/**
 * Result of prefetching reservations for all accounts in a window
 */
export interface AccountExclusions {
  reservationsByUser: Map<number, ExistingReservation[]>;
  targetDate: string;
  fetchedAt: Date;
  totalAccounts: number;
  successfulFetches: number;
  failedFetches: number;
}

/**
 * AccountReservationChecker - prefetches existing reservations before booking windows
 */
export class AccountReservationChecker {
  private proxyManager: ProxyManager;

  constructor(proxyManager: ProxyManager) {
    this.proxyManager = proxyManager;
  }

  /**
   * Prefetch existing reservations for all unique users in a window
   *
   * @param subscriptions - All subscriptions in the booking window
   * @param targetDate - The date being booked (YYYY-MM-DD)
   * @returns AccountExclusions with reservation data
   */
  async prefetchReservations(
    subscriptions: FullSubscription[],
    targetDate: string
  ): Promise<AccountExclusions> {
    // Get unique users (avoid fetching same user multiple times)
    const uniqueUsers = new Map<number, FullSubscription>();
    for (const sub of subscriptions) {
      if (!uniqueUsers.has(sub.user_id)) {
        uniqueUsers.set(sub.user_id, sub);
      }
    }

    logger.info(
      { uniqueUsers: uniqueUsers.size, targetDate },
      "Starting reservation prefetch"
    );

    const results = new Map<number, ExistingReservation[]>();
    let successfulFetches = 0;
    let failedFetches = 0;

    // Process in batches of FETCH_CONCURRENCY
    const userEntries = Array.from(uniqueUsers.entries());

    for (let i = 0; i < userEntries.length; i += FETCH_CONCURRENCY) {
      const batch = userEntries.slice(i, i + FETCH_CONCURRENCY);

      const batchResults = await Promise.all(
        batch.map(async ([userId, sub]) => {
          try {
            const reservations = await this.fetchUserReservations(sub);
            results.set(userId, reservations);
            successfulFetches++;

            // Log if user has reservations on target date
            const sameDayReservations = reservations.filter(
              (r) => r.date === targetDate
            );
            if (sameDayReservations.length > 0) {
              logger.info(
                {
                  userId,
                  targetDate,
                  existingReservations: sameDayReservations.map(
                    (r) => `${r.venueName} at ${r.timeSlot}`
                  ),
                },
                "User has existing reservation(s) on target date"
              );
            }

            return { userId, success: true };
          } catch (error) {
            // Fail open: empty array means no exclusions
            results.set(userId, []);
            failedFetches++;

            logger.warn(
              { userId, error: String(error) },
              "Failed to fetch reservations - allowing booking attempt"
            );

            return { userId, success: false };
          }
        })
      );

      logger.debug(
        {
          batchIndex: Math.floor(i / FETCH_CONCURRENCY) + 1,
          totalBatches: Math.ceil(userEntries.length / FETCH_CONCURRENCY),
          batchSize: batchResults.length,
        },
        "Completed reservation fetch batch"
      );
    }

    const exclusions: AccountExclusions = {
      reservationsByUser: results,
      targetDate,
      fetchedAt: new Date(),
      totalAccounts: uniqueUsers.size,
      successfulFetches,
      failedFetches,
    };

    // Count users that will be excluded
    const excludedCount = this.countExcludedUsers(exclusions);

    logger.info(
      {
        totalAccounts: exclusions.totalAccounts,
        successfulFetches: exclusions.successfulFetches,
        failedFetches: exclusions.failedFetches,
        excludedCount,
        targetDate,
      },
      "Reservation prefetch complete"
    );

    return exclusions;
  }

  /**
   * Fetch reservations for a single user
   */
  private async fetchUserReservations(
    sub: FullSubscription
  ): Promise<ExistingReservation[]> {
    // Get datacenter proxy for this request
    const proxy = this.proxyManager.getRotatingProxy();

    const client = new ResyClient({
      authToken: sub.resy_auth_token,
      proxyUrl: proxy?.url,
    });

    const response = await client.getUserReservations("upcoming");

    return response.reservations.map((r) => ({
      date: r.day,
      venueId: r.venue.id,
      venueName: r.venue.name ?? "Unknown",
      timeSlot: r.time_slot,
    }));
  }

  /**
   * Check if a user should be excluded from booking on a given date
   */
  shouldExcludeUser(
    exclusions: AccountExclusions,
    userId: number,
    targetDate: string
  ): boolean {
    // Only check if exclusions are for the same target date
    if (exclusions.targetDate !== targetDate) {
      return false;
    }

    const userReservations = exclusions.reservationsByUser.get(userId);
    if (!userReservations || userReservations.length === 0) {
      return false;
    }

    // Exclude if user has ANY reservation on the target date
    return userReservations.some((r) => r.date === targetDate);
  }

  /**
   * Get the reason a user is excluded (for logging)
   */
  getExclusionReason(
    exclusions: AccountExclusions,
    userId: number,
    targetDate: string
  ): string | null {
    if (!this.shouldExcludeUser(exclusions, userId, targetDate)) {
      return null;
    }

    const userReservations = exclusions.reservationsByUser.get(userId);
    if (!userReservations) {
      return null;
    }

    const sameDayRes = userReservations.find((r) => r.date === targetDate);
    if (!sameDayRes) {
      return null;
    }

    return `Existing reservation at ${sameDayRes.venueName} at ${sameDayRes.timeSlot}`;
  }

  /**
   * Count how many users will be excluded
   */
  private countExcludedUsers(exclusions: AccountExclusions): number {
    let count = 0;
    for (const [userId] of exclusions.reservationsByUser) {
      if (this.shouldExcludeUser(exclusions, userId, exclusions.targetDate)) {
        count++;
      }
    }
    return count;
  }
}

// Singleton instance
let checkerInstance: AccountReservationChecker | null = null;

/**
 * Get or create the AccountReservationChecker singleton
 */
export function getAccountReservationChecker(
  proxyManager: ProxyManager
): AccountReservationChecker {
  if (!checkerInstance) {
    checkerInstance = new AccountReservationChecker(proxyManager);
  }
  return checkerInstance;
}
