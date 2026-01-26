/**
 * Booking Coordinator
 *
 * Receives slot events from scanner and coordinates booking execution.
 * Handles deduplication at multiple levels:
 * - In-flight bookings: Don't attempt same slot twice for same user
 * - Successful bookings: Don't keep trying after success for a restaurant/date
 *
 * Push model: slots come in immediately as discovered, bookings fire instantly
 */
import type { DiscoveredSlot } from "./scanner";
import type { BookingResult, UserBookingResult } from "./executor";
import type { Restaurant, FullSubscription, Proxy } from "../db/schema";
import { store } from "../store";
import { ResyClient, ResyAPIError } from "../sdk";
import { parseSlotTime } from "../filters";
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

/**
 * User context for booking - contains auth and preferences
 */
export interface UserBookingContext {
  userId: number;
  discordId: string;
  resyAuthToken: string;
  resyPaymentMethodId: number;
  preferredProxyId: number | null;
  partySize: number;
  timeWindowStart: string;
  timeWindowEnd: string;
  tableTypes: string[] | null;
}

/**
 * Configuration for the booking coordinator
 */
export interface BookingCoordinatorConfig {
  apiKey?: string;
  dryRun?: boolean;
  onBookingSuccess?: (result: UserBookingResult) => void;
  onBookingFailed?: (result: UserBookingResult) => void;
}

/**
 * Booking Coordinator class
 * Receives slot events and spawns executor tasks with deduplication
 */
export class BookingCoordinator {
  private apiKey: string;
  private dryRun: boolean;
  private onBookingSuccess?: (result: UserBookingResult) => void;
  private onBookingFailed?: (result: UserBookingResult) => void;

  // Deduplication: track in-flight bookings "userId:configId" → Promise
  private inFlight = new Map<string, Promise<BookingResult>>();

  // Deduplication: track successful bookings "userId:restaurantId:targetDate"
  private successfulBookings = new Set<string>();

  // Track rate-limited users (stop trying for this window)
  private rateLimitedUsers = new Set<number>();

  constructor(config: BookingCoordinatorConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.RESY_API_KEY ?? "";
    this.dryRun = config.dryRun ?? process.env.DRY_RUN === "true";
    this.onBookingSuccess = config.onBookingSuccess;
    this.onBookingFailed = config.onBookingFailed;
  }

  /**
   * Handle discovered slots from scanner - called immediately when slots found
   * This is the main entry point from the scanner
   */
  onSlotsDiscovered(slots: DiscoveredSlot[], restaurant: Restaurant): void {
    logger.info(
      {
        restaurant: restaurant.name,
        slotsFound: slots.length,
        slots: slots.map((s) => ({ time: s.slot.time, type: s.slot.type })),
      },
      "Coordinator received slots"
    );

    // Get users subscribed to this restaurant
    const subscriptions = store.getSubscriptionsByRestaurant(restaurant.id);
    const fullSubscriptions = this.getFullSubscriptionsForRestaurant(restaurant.id);

    if (fullSubscriptions.length === 0) {
      logger.warn({ restaurant: restaurant.name }, "No active subscriptions for restaurant");
      return;
    }

    // For each slot, try to book for each eligible user
    for (const discoveredSlot of slots) {
      this.processSlotForUsers(discoveredSlot, fullSubscriptions);
    }
  }

  /**
   * Process a single slot for all eligible users
   */
  private processSlotForUsers(slot: DiscoveredSlot, subscriptions: FullSubscription[]): void {
    for (const sub of subscriptions) {
      // Check if slot matches user's preferences
      if (!this.slotMatchesSubscription(slot, sub)) {
        continue;
      }

      const userId = sub.user_id;
      const configId = slot.slot.config_id;
      const restaurantId = slot.restaurant.id;
      const targetDate = slot.targetDate;

      // Deduplication key for in-flight
      const inFlightKey = `${userId}:${configId}`;
      // Deduplication key for success
      const successKey = `${userId}:${restaurantId}:${targetDate}`;

      // Skip if user already has successful booking for this restaurant/date
      if (this.successfulBookings.has(successKey)) {
        logger.debug(
          { userId, restaurant: slot.restaurant.name, targetDate },
          "Skipping - user already has successful booking"
        );
        continue;
      }

      // Skip if already attempting this exact slot for this user
      if (this.inFlight.has(inFlightKey)) {
        logger.debug(
          { userId, configId },
          "Skipping - booking already in flight"
        );
        continue;
      }

      // Skip if user is rate-limited
      if (this.rateLimitedUsers.has(userId)) {
        logger.debug({ userId }, "Skipping - user is rate limited");
        continue;
      }

      // Build user context
      const userContext: UserBookingContext = {
        userId,
        discordId: sub.discord_id,
        resyAuthToken: sub.resy_auth_token,
        resyPaymentMethodId: sub.resy_payment_method_id,
        preferredProxyId: sub.preferred_proxy_id,
        partySize: sub.party_size,
        timeWindowStart: sub.time_window_start,
        timeWindowEnd: sub.time_window_end,
        tableTypes: sub.table_types,
      };

      // Fire booking attempt - non-blocking
      const bookingPromise = this.bookSlot(userContext, slot);
      this.inFlight.set(inFlightKey, bookingPromise);

      // Handle result asynchronously
      bookingPromise.then((result) => {
        this.inFlight.delete(inFlightKey);

        if (result.success) {
          // Mark as successful - no more attempts for this restaurant/date
          this.successfulBookings.add(successKey);

          const userResult: UserBookingResult = {
            userId,
            discordId: sub.discord_id,
            success: true,
            bookedSlot: slot,
            reservationId: result.reservationId,
          };

          logger.info(
            {
              userId,
              restaurant: slot.restaurant.name,
              time: slot.slot.time,
              reservationId: result.reservationId,
            },
            "BOOKING SUCCESS!"
          );

          this.onBookingSuccess?.(userResult);
        } else if (result.status === "rate_limited") {
          // Stop trying for this user this window
          this.rateLimitedUsers.add(userId);
          logger.warn({ userId }, "User rate limited - stopping attempts");
        }
      });
    }
  }

  /**
   * Book a single slot for a single user
   */
  async bookSlot(user: UserBookingContext, slot: DiscoveredSlot): Promise<BookingResult> {
    const proxy = user.preferredProxyId
      ? store.getProxyById(user.preferredProxyId) ?? null
      : null;

    logger.info(
      {
        userId: user.userId,
        restaurant: slot.restaurant.name,
        time: slot.slot.time,
        partySize: user.partySize,
        proxyId: proxy?.id ?? "localhost",
      },
      "Attempting booking"
    );

    // Record booking attempt (fire-and-forget to DB)
    store.createBookingAttempt({
      user_id: user.userId,
      restaurant_id: slot.restaurant.id,
      target_date: slot.targetDate,
      slot_time: slot.slot.time,
      status: "pending",
      reservation_id: null,
      error_message: null,
      proxy_used: proxy?.url ?? null,
    });

    const client = new ResyClient({
      apiKey: this.apiKey,
      authToken: user.resyAuthToken,
      proxyUrl: proxy?.url,
    });

    return this.attemptBooking(client, slot, user, proxy);
  }

  /**
   * Attempt to book a single slot
   */
  private async attemptBooking(
    client: ResyClient,
    slot: DiscoveredSlot,
    user: UserBookingContext,
    proxy: Proxy | null
  ): Promise<BookingResult> {
    try {
      // Step 1: Get booking details and token
      const details = await client.getDetails({
        venue_id: Number(slot.restaurant.venue_id),
        day: slot.targetDate,
        party_size: user.partySize,
        config_id: slot.slot.config_id,
      });

      const bookToken = details.book_token?.value;
      if (!bookToken) {
        this.recordFailure(user, slot, proxy, "No book token received");
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
          {
            userId: user.userId,
            restaurant: slot.restaurant.name,
            time: slot.slot.time,
          },
          "[DRY RUN] Would book slot"
        );
        this.recordSuccess(user, slot, proxy, 0);
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
        payment_method_id: user.resyPaymentMethodId,
      });

      this.recordSuccess(user, slot, proxy, bookResult.reservation_id);
      return {
        success: true,
        status: "success",
        retry: false,
        reservationId: bookResult.reservation_id,
        resyToken: bookResult.resy_token,
      };
    } catch (error) {
      return this.handleBookingError(error, user, slot, proxy);
    }
  }

  /**
   * Handle booking errors - log full response to DB and continue
   */
  private handleBookingError(
    error: unknown,
    user: UserBookingContext,
    slot: DiscoveredSlot,
    proxy: Proxy | null
  ): BookingResult {
    const status = error instanceof ResyAPIError ? error.status : 0;
    const code = error instanceof ResyAPIError ? error.code : undefined;
    const rawBody = error instanceof ResyAPIError ? error.rawBody : undefined;
    const message = error instanceof Error ? error.message : String(error);

    // Log full error to DB for analysis (fire-and-forget)
    store.logBookingError({
      user_id: user.userId,
      restaurant_id: slot.restaurant.id,
      http_status: status,
      error_code: code !== undefined ? String(code) : null,
      error_message: message,
      raw_response: rawBody ?? null,  // Full response body from Resy
    });

    // Record failure in booking_attempts
    this.recordFailure(user, slot, proxy, message, "failed");

    // Log for visibility
    logger.warn(
      {
        userId: user.userId,
        restaurant: slot.restaurant.name,
        time: slot.slot.time,
        httpStatus: status,
        code,
        rawBody: rawBody?.substring(0, 500),  // Truncate for log
      },
      "Booking error - logged to DB"
    );

    return {
      success: false,
      status: "failed",
      retry: true,
      errorMessage: message,
    };
  }

  /**
   * Record successful booking attempt
   */
  private recordSuccess(
    user: UserBookingContext,
    slot: DiscoveredSlot,
    proxy: Proxy | null,
    reservationId: number
  ): void {
    store.createBookingAttempt({
      user_id: user.userId,
      restaurant_id: slot.restaurant.id,
      target_date: slot.targetDate,
      slot_time: slot.slot.time,
      status: "success",
      reservation_id: reservationId,
      error_message: null,
      proxy_used: proxy?.url ?? null,
    });
  }

  /**
   * Record failed booking attempt
   */
  private recordFailure(
    user: UserBookingContext,
    slot: DiscoveredSlot,
    proxy: Proxy | null,
    errorMessage: string,
    status: "failed" | "sold_out" = "failed"
  ): void {
    store.createBookingAttempt({
      user_id: user.userId,
      restaurant_id: slot.restaurant.id,
      target_date: slot.targetDate,
      slot_time: slot.slot.time,
      status,
      reservation_id: null,
      error_message: errorMessage,
      proxy_used: proxy?.url ?? null,
    });
  }

  /**
   * Check if a slot matches a user's subscription preferences
   */
  private slotMatchesSubscription(slot: DiscoveredSlot, sub: FullSubscription): boolean {
    // Check time window
    const slotMinutes = parseSlotTime(slot.slot.time);
    const startMinutes = this.parseTimeWindow(sub.time_window_start);
    const endMinutes = this.parseTimeWindow(sub.time_window_end);

    if (slotMinutes < startMinutes || slotMinutes > endMinutes) {
      return false;
    }

    // Check table type if specified
    if (sub.table_types && sub.table_types.length > 0 && slot.slot.type) {
      const typeMatches = sub.table_types.some(
        (t) => slot.slot.type?.toLowerCase().includes(t.toLowerCase())
      );
      if (!typeMatches) {
        return false;
      }
    }

    return true;
  }

  /**
   * Parse time window string to minutes
   */
  private parseTimeWindow(time: string): number {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Get full subscriptions for a restaurant (with user auth data)
   */
  private getFullSubscriptionsForRestaurant(restaurantId: number): FullSubscription[] {
    return store.getFullSubscriptions().filter((s) => s.restaurant_id === restaurantId);
  }

  /**
   * Reset state for a new scan window
   * Called at the start of each release window
   */
  reset(): void {
    this.inFlight.clear();
    this.successfulBookings.clear();
    this.rateLimitedUsers.clear();
    logger.info("Coordinator state reset for new window");
  }

  /**
   * Get coordinator stats
   */
  getStats(): {
    inFlightCount: number;
    successfulBookings: number;
    rateLimitedUsers: number;
  } {
    return {
      inFlightCount: this.inFlight.size,
      successfulBookings: this.successfulBookings.size,
      rateLimitedUsers: this.rateLimitedUsers.size,
    };
  }
}

// Singleton instance
let coordinator: BookingCoordinator | null = null;

/**
 * Get the booking coordinator singleton
 */
export function getBookingCoordinator(config?: BookingCoordinatorConfig): BookingCoordinator {
  if (!coordinator) {
    coordinator = new BookingCoordinator(config);
  }
  return coordinator;
}
