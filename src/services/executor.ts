/**
 * Executor Service
 * Handles parallel booking execution with per-user proxy preferences
 *
 * Strategy:
 * - Each user uses their preferred_proxy_id (null = localhost, id = specific proxy)
 * - Users run in PARALLEL (Promise.all)
 * - Slots within a user are tried SEQUENTIALLY (earliest first)
 *
 * Uses in-memory store - no direct DB access on hot path
 *
 * NOTE: For the new push-based architecture, use BookingCoordinator instead.
 * This class is kept for backwards compatibility but the coordinator
 * provides better per-restaurant tracking and instant slot processing.
 */
import { ResyClient, ResyAPIError } from "../sdk";
import { getProxyManager } from "./proxy-manager";
import { store } from "../store";
import type { FullSubscription } from "../db/schema";
import type { ScanResult, DiscoveredSlot } from "./scanner";
import { parseSlotTime } from "../filters";
import type { Proxy } from "../db/schema";
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

// Rate limit duration when a proxy gets 429'd
const RATE_LIMIT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Result of a booking attempt
 */
export interface BookingResult {
  success: boolean;
  status: "success" | "sold_out" | "rate_limited" | "auth_failed" | "unknown";
  retry: boolean;
  reservationId?: number;
  resyToken?: string;
  errorMessage?: string;
}

/**
 * Result of executing bookings for a user
 */
export interface UserBookingResult {
  userId: number;
  discordId: string;
  success: boolean;
  bookedSlot?: DiscoveredSlot;
  reservationId?: number;
  errorMessage?: string;
}

/**
 * Configuration for the executor
 */
export interface ExecutorConfig {
  apiKey?: string;
  dryRun?: boolean;
  onBookingSuccess?: (result: UserBookingResult) => void;
  onBookingFailed?: (result: UserBookingResult) => void;
}

/**
 * Executor class for parallel booking
 */
export class Executor {
  private apiKey: string;
  private dryRun: boolean;
  private proxyManager = getProxyManager();
  private onBookingSuccess?: (result: UserBookingResult) => void;
  private onBookingFailed?: (result: UserBookingResult) => void;

  constructor(config: ExecutorConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.RESY_API_KEY ?? "";
    this.dryRun = config.dryRun ?? process.env.DRY_RUN === "true";
    this.onBookingSuccess = config.onBookingSuccess;
    this.onBookingFailed = config.onBookingFailed;
  }

  /**
   * Execute bookings for all users based on scan results
   */
  async execute(scanResult: ScanResult): Promise<UserBookingResult[]> {
    const { window, slots } = scanResult;

    logger.info(
      {
        releaseTime: window.releaseTime,
        targetDate: window.targetDate,
        slotsFound: slots.length,
        subscriptions: window.subscriptions.length,
      },
      "Starting parallel booking execution"
    );

    // Group subscriptions by user
    const userSubscriptions = this.groupSubscriptionsByUser(window.subscriptions);

    // Build proxy assignments from user preferences
    // preferred_proxy_id: null = localhost, number = use that proxy
    const proxyAssignments = new Map<number, Proxy | null>();
    for (const [userId, subs] of userSubscriptions) {
      const preferredProxyId = subs[0].preferred_proxy_id;
      if (preferredProxyId) {
        const proxy = store.getProxyById(preferredProxyId);
        proxyAssignments.set(userId, proxy ?? null);
        logger.debug({ userId, proxyId: preferredProxyId }, "Using preferred proxy");
      } else {
        proxyAssignments.set(userId, null); // localhost
        logger.debug({ userId }, "Using localhost (no proxy)");
      }
    }

    logger.info({ userCount: userSubscriptions.size }, "Proxy assignments configured");

    // Execute bookings for all users in parallel
    const results = await Promise.all(
      Array.from(userSubscriptions.entries()).map(([userId, subs]) =>
        this.bookForUser(userId, subs, slots, proxyAssignments.get(userId) ?? null)
      )
    );

    // Log summary
    const successes = results.filter((r) => r.success);
    logger.info(
      {
        totalUsers: results.length,
        successes: successes.length,
        failures: results.length - successes.length,
      },
      "Booking execution complete"
    );

    return results;
  }

  /**
   * Group subscriptions by user ID
   */
  private groupSubscriptionsByUser(
    subscriptions: FullSubscription[]
  ): Map<number, FullSubscription[]> {
    const grouped = new Map<number, FullSubscription[]>();
    for (const sub of subscriptions) {
      const existing = grouped.get(sub.user_id) ?? [];
      existing.push(sub);
      grouped.set(sub.user_id, existing);
    }
    return grouped;
  }

  /**
   * Book for a single user - tries slots sequentially
   */
  private async bookForUser(
    userId: number,
    subscriptions: FullSubscription[],
    allSlots: DiscoveredSlot[],
    proxy: Proxy | null
  ): Promise<UserBookingResult> {
    const sub = subscriptions[0]; // Use first subscription for auth info
    const discordId = sub.discord_id;

    logger.info(
      {
        userId,
        discordId,
        subscriptionCount: subscriptions.length,
        proxyId: proxy?.id,
      },
      "Starting booking attempts for user"
    );

    // Filter and sort slots for this user
    const userSlots = this.filterAndSortSlotsForUser(subscriptions, allSlots);

    if (userSlots.length === 0) {
      logger.info({ userId }, "No matching slots for user");
      return {
        userId,
        discordId,
        success: false,
        errorMessage: "No matching slots found",
      };
    }

    // Create Resy client with user's auth and dedicated proxy
    const client = new ResyClient({
      apiKey: this.apiKey,
      authToken: sub.resy_auth_token,
      proxyUrl: proxy?.url,
    });

    // Try each slot sequentially
    for (const slotData of userSlots) {
      const { slot, subscription, targetDate, restaurant, venueName } = slotData;

      // Check if user already has a successful booking (from in-memory state)
      if (store.hasSuccessfulBooking(userId, restaurant.id, targetDate)) {
        logger.info(
          { userId, restaurant: restaurant.name, targetDate },
          "User already has successful booking, skipping"
        );
        continue;
      }

      // Record booking attempt (fire-and-forget to DB)
      store.createBookingAttempt({
        user_id: userId,
        restaurant_id: restaurant.id,
        target_date: targetDate,
        slot_time: slot.time,
        status: "pending",
        reservation_id: null,
        error_message: null,
        proxy_used: proxy?.url ?? null,
      });

      try {
        const result = await this.attemptBooking(
          client,
          slot.config_id,
          subscription.party_size,
          subscription.resy_payment_method_id,
          {
            userId,
            restaurantId: restaurant.id,
            venueId: restaurant.venue_id,
            targetDate,
          }
        );

        if (result.success) {
          // Record success (fire-and-forget)
          store.createBookingAttempt({
            user_id: userId,
            restaurant_id: restaurant.id,
            target_date: targetDate,
            slot_time: slot.time,
            status: "success",
            reservation_id: result.reservationId ?? null,
            error_message: null,
            proxy_used: proxy?.url ?? null,
          });

          const userResult: UserBookingResult = {
            userId,
            discordId,
            success: true,
            bookedSlot: { restaurant, targetDate, slot, venueName },
            reservationId: result.reservationId,
          };

          if (this.onBookingSuccess) {
            this.onBookingSuccess(userResult);
          }

          logger.info(
            {
              userId,
              restaurant: restaurant.name,
              time: slot.time,
              reservationId: result.reservationId,
            },
            "BOOKING SUCCESS!"
          );

          return userResult;
        }

        // Handle failure cases
        if (result.status === "sold_out") {
          store.createBookingAttempt({
            user_id: userId,
            restaurant_id: restaurant.id,
            target_date: targetDate,
            slot_time: slot.time,
            status: "sold_out",
            reservation_id: null,
            error_message: null,
            proxy_used: proxy?.url ?? null,
          });
          logger.info({ userId, restaurant: restaurant.name, time: slot.time }, "Slot sold out");
          // Continue to next slot
        } else if (result.status === "rate_limited") {
          store.createBookingAttempt({
            user_id: userId,
            restaurant_id: restaurant.id,
            target_date: targetDate,
            slot_time: slot.time,
            status: "failed",
            reservation_id: null,
            error_message: "Rate limited",
            proxy_used: proxy?.url ?? null,
          });
          // Mark proxy and stop trying
          if (proxy) {
            this.proxyManager.markRateLimited(proxy.id, RATE_LIMIT_DURATION_MS);
          }
          logger.warn({ userId, proxyId: proxy?.id }, "Rate limited, stopping attempts");
          break;
        } else if (result.status === "auth_failed") {
          store.createBookingAttempt({
            user_id: userId,
            restaurant_id: restaurant.id,
            target_date: targetDate,
            slot_time: slot.time,
            status: "failed",
            reservation_id: null,
            error_message: "Auth failed",
            proxy_used: proxy?.url ?? null,
          });
          logger.error({ userId }, "Auth failed, user needs to re-register");
          break;
        } else {
          store.createBookingAttempt({
            user_id: userId,
            restaurant_id: restaurant.id,
            target_date: targetDate,
            slot_time: slot.time,
            status: "failed",
            reservation_id: null,
            error_message: result.errorMessage ?? null,
            proxy_used: proxy?.url ?? null,
          });
          // Unknown error - try next slot if retry is true
          if (!result.retry) break;
        }
      } catch (error) {
        store.createBookingAttempt({
          user_id: userId,
          restaurant_id: restaurant.id,
          target_date: targetDate,
          slot_time: slot.time,
          status: "failed",
          reservation_id: null,
          error_message: String(error),
          proxy_used: proxy?.url ?? null,
        });
        logger.error({ userId, error: String(error) }, "Unexpected error during booking");
      }
    }

    // All slots failed
    const userResult: UserBookingResult = {
      userId,
      discordId,
      success: false,
      errorMessage: "All slots failed or sold out",
    };

    if (this.onBookingFailed) {
      this.onBookingFailed(userResult);
    }

    return userResult;
  }

  /**
   * Filter slots for user's subscriptions and sort by time (earliest first)
   */
  private filterAndSortSlotsForUser(
    subscriptions: FullSubscription[],
    allSlots: DiscoveredSlot[]
  ): Array<{
    slot: DiscoveredSlot["slot"];
    subscription: FullSubscription;
    targetDate: string;
    restaurant: DiscoveredSlot["restaurant"];
    venueName: string;
  }> {
    const userSlots: Array<{
      slot: DiscoveredSlot["slot"];
      subscription: FullSubscription;
      targetDate: string;
      restaurant: DiscoveredSlot["restaurant"];
      venueName: string;
      timeMinutes: number;
    }> = [];

    for (const sub of subscriptions) {
      // Find slots matching this subscription's restaurant
      const matchingSlots = allSlots.filter(
        (s) => s.restaurant.id === sub.restaurant_id
      );

      for (const { slot, targetDate, restaurant, venueName } of matchingSlots) {
        // Check if slot is within user's time window
        const slotMinutes = parseSlotTime(slot.time);
        const startMinutes = this.parseTimeWindow(sub.time_window_start);
        const endMinutes = this.parseTimeWindow(sub.time_window_end);

        if (slotMinutes >= startMinutes && slotMinutes <= endMinutes) {
          userSlots.push({
            slot,
            subscription: sub,
            targetDate,
            restaurant,
            venueName,
            timeMinutes: slotMinutes,
          });
        }
      }
    }

    // Sort by time (earliest first)
    userSlots.sort((a, b) => a.timeMinutes - b.timeMinutes);

    return userSlots.map(({ timeMinutes, ...rest }) => rest);
  }

  /**
   * Parse time window string to minutes
   */
  private parseTimeWindow(time: string): number {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Attempt to book a single slot
   */
  private async attemptBooking(
    client: ResyClient,
    configId: string,
    partySize: number,
    paymentMethodId: number,
    context: {
      userId: number;
      restaurantId: number;
      venueId: string;
      targetDate: string;
    }
  ): Promise<BookingResult> {
    try {
      // Step 1: Get booking details and token
      const details = await client.getDetails({
        venue_id: Number(context.venueId),
        day: context.targetDate,
        party_size: partySize,
        config_id: configId,
      });

      const bookToken = details.book_token?.value;
      if (!bookToken) {
        return {
          success: false,
          status: "unknown",
          retry: true,
          errorMessage: "No book token received",
        };
      }

      // Step 2: Dry run check
      if (this.dryRun) {
        logger.info(
          { configId, partySize, targetDate: context.targetDate },
          "[DRY RUN] Would book slot"
        );
        return {
          success: true,
          status: "success",
          retry: false,
          reservationId: 0,
          resyToken: "dry-run",
        };
      }

      // Step 3: Book the reservation
      const bookResult = await client.bookReservation({
        book_token: bookToken,
        payment_method_id: paymentMethodId,
      });

      return {
        success: true,
        status: "success",
        retry: false,
        reservationId: bookResult.reservation_id,
        resyToken: bookResult.resy_token,
      };
    } catch (error) {
      const status = error instanceof ResyAPIError ? error.status : 0;
      const code = error instanceof ResyAPIError ? error.code : undefined;
      const message = error instanceof Error ? error.message : String(error);

      // Log error (fire-and-forget to DB)
      store.logBookingError({
        user_id: context.userId,
        restaurant_id: context.restaurantId,
        http_status: status,
        error_code: code !== undefined ? String(code) : null,
        error_message: message,
        raw_response: JSON.stringify(error),
      });

      // Known error handling
      if (status === 412) {
        return { success: false, status: "sold_out", retry: true };
      }
      if (status === 429) {
        return { success: false, status: "rate_limited", retry: false };
      }
      if (status === 401 || status === 403) {
        return {
          success: false,
          status: "auth_failed",
          retry: false,
          errorMessage: message,
        };
      }

      // UNKNOWN ERROR -> retry anyway, log for investigation
      logger.warn({ status, code, message }, "Unknown booking error - will retry");

      return {
        success: false,
        status: "unknown",
        retry: true,
        errorMessage: message,
      };
    }
  }
}

// Singleton instance
let executor: Executor | null = null;

/**
 * Get the executor singleton
 */
export function getExecutor(config?: ExecutorConfig): Executor {
  if (!executor) {
    executor = new Executor(config);
  }
  return executor;
}
