/**
 * Booking Coordinator
 *
 * Receives slot events from scanner and coordinates booking execution.
 *
 * Key Architecture:
 * - Sequential slots per restaurant: Try one slot at a time, stop on success
 * - ISP proxy pool: 6 shared ISP proxies allocated per-restaurant, not per-user
 * - Error handling: 500 empty → switch proxy, retry; "sold out" → try next slot
 * - No parallel booking requests per user/restaurant combo
 *
 * Deduplication:
 * - In-flight processors: Don't start multiple processors for same (user, restaurant, date)
 * - Successful bookings: Don't keep trying after success
 */
import type { DiscoveredSlot } from "./scanner";
import type { Restaurant, FullSubscription, FullPassiveTarget, Proxy } from "../db/schema";
import { getTimeWindowForDate } from "./scheduler";
import type { AccountExclusions } from "./account-reservation-checker";

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
import { store } from "../store";
import { ResyClient, ResyAPIError } from "../sdk";
import { parseSlotTime } from "../filters";
import { getIspProxyPool, type IspProxyPool } from "./isp-proxy-pool";
import { logger } from "../logger";

// Maximum retries per slot when hitting WAF blocks
const MAX_RETRIES_PER_SLOT = 2;

// Timeout waiting for ISP proxy
const PROXY_ACQUIRE_TIMEOUT_MS = 10_000;

/**
 * Booking status types for internal tracking
 */
type BookingStatus =
  | "success"
  | "waf_blocked"
  | "sold_out"
  | "rate_limited"
  | "auth_failed"
  | "server_error"
  | "no_book_token"
  | "unknown";

/**
 * Internal booking result with status
 */
interface InternalBookingResult {
  success: boolean;
  status: BookingStatus;
  reservationId?: number;
  resyToken?: string;
  errorMessage?: string;
}

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
 * Slot queue entry
 */
interface QueuedSlot {
  slot: DiscoveredSlot;
  subscription: FullSubscription;
}

/**
 * Booking Coordinator class
 * Receives slot events and spawns sequential processors with deduplication
 */
export class BookingCoordinator {
  private apiKey: string;
  private dryRun: boolean;
  private onBookingSuccess?: (result: UserBookingResult) => void;
  private onBookingFailed?: (result: UserBookingResult) => void;

  // ISP proxy pool
  private ispPool: IspProxyPool;

  // Active processors: "userId:restaurantId:targetDate" → Promise
  private activeProcessors = new Map<string, Promise<InternalBookingResult>>();

  // Successful bookings: "userId:restaurantId:targetDate"
  private successfulBookings = new Set<string>();

  // Rate-limited users (stop trying for this window)
  private rateLimitedUsers = new Set<number>();

  // Auth-failed users (bad token)
  private authFailedUsers = new Set<number>();

  // Account exclusions (users with existing reservations on target date)
  private accountExclusions: AccountExclusions | null = null;

  // Claimed slots: "restaurantId:targetDate:slotTime" → userId who claimed it
  private claimedSlots = new Map<string, number>();

  constructor(config: BookingCoordinatorConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.RESY_API_KEY ?? "";
    this.dryRun = config.dryRun ?? process.env.DRY_RUN === "true";
    this.onBookingSuccess = config.onBookingSuccess;
    this.onBookingFailed = config.onBookingFailed;
    this.ispPool = getIspProxyPool();
  }

  /**
   * Initialize the coordinator (call after store is initialized)
   */
  initialize(): void {
    this.ispPool.initialize();
    logger.info("Booking coordinator initialized with ISP proxy pool");
  }

  /**
   * Get a unique key for a slot
   */
  private getSlotKey(restaurantId: number, targetDate: string, slotTime: string): string {
    return `${restaurantId}:${targetDate}:${slotTime}`;
  }

  /**
   * Try to claim a slot for a user. Returns true if claimed, false if already claimed by another user.
   */
  private tryClaimSlot(restaurantId: number, targetDate: string, slotTime: string, userId: number): boolean {
    const key = this.getSlotKey(restaurantId, targetDate, slotTime);
    if (this.claimedSlots.has(key)) {
      return false; // Already claimed by another user
    }
    this.claimedSlots.set(key, userId);
    return true;
  }

  /**
   * Release a slot claim (only if this user owns it)
   */
  private releaseSlot(restaurantId: number, targetDate: string, slotTime: string, userId: number): void {
    const key = this.getSlotKey(restaurantId, targetDate, slotTime);
    // Only release if this user owns the claim
    if (this.claimedSlots.get(key) === userId) {
      this.claimedSlots.delete(key);
    }
  }

  /**
   * Set account exclusions (users with existing reservations)
   * Called before booking window starts
   */
  setAccountExclusions(exclusions: AccountExclusions): void {
    this.accountExclusions = exclusions;
    logger.info(
      {
        totalAccounts: exclusions.totalAccounts,
        targetDate: exclusions.targetDate,
      },
      "Account exclusions set for window"
    );
  }

  /**
   * Handle discovered slots from scanner - called immediately when slots found
   * This is the main entry point from the scanner
   */
  onSlotsDiscovered(slots: DiscoveredSlot[], restaurant: Restaurant): void {
    if (slots.length === 0) return;

    logger.info(
      {
        restaurant: restaurant.name,
        slotsFound: slots.length,
        slots: slots.map((s) => ({ time: s.slot.time, type: s.slot.type })),
      },
      "Coordinator received slots"
    );

    // Get all subscriptions for this restaurant
    const fullSubscriptions = this.getFullSubscriptionsForRestaurant(restaurant.id);

    if (fullSubscriptions.length === 0) {
      logger.warn({ restaurant: restaurant.name }, "No active subscriptions for restaurant");
      return;
    }

    this.processSlots(slots, restaurant, fullSubscriptions);
  }

  /**
   * Handle discovered slots from passive monitor - pre-filtered by day-of-week
   * This accepts pre-matched passive targets that already passed day-of-week filter
   */
  onPassiveSlotsDiscovered(
    slots: DiscoveredSlot[],
    restaurant: Restaurant,
    date: string,
    matchingTargets: FullPassiveTarget[]
  ): void {
    if (slots.length === 0) return;

    logger.info(
      {
        restaurant: restaurant.name,
        date,
        slotsFound: slots.length,
        matchingTargets: matchingTargets.length,
        slots: slots.map((s) => ({ time: s.slot.time, type: s.slot.type })),
      },
      "Coordinator received slots from passive monitor"
    );

    if (matchingTargets.length === 0) {
      logger.warn({ restaurant: restaurant.name }, "No matching targets for passive slots");
      return;
    }

    // FullPassiveTarget has the same booking-relevant fields as FullSubscription
    this.processSlots(slots, restaurant, matchingTargets as unknown as FullSubscription[]);
  }

  /**
   * Process slots for a set of subscriptions (shared by scanner and passive monitor)
   */
  private processSlots(
    slots: DiscoveredSlot[],
    restaurant: Restaurant,
    fullSubscriptions: FullSubscription[]
  ): void {
    // Group by user and start processors
    const userSubscriptions = this.groupSubscriptionsByUser(fullSubscriptions);

    for (const [userId, subs] of userSubscriptions) {
      const sub = subs[0]; // Use first for user context
      const targetDate = slots[0].targetDate;
      const key = `${userId}:${restaurant.id}:${targetDate}`;

      // Skip if already processing this combination
      if (this.activeProcessors.has(key)) {
        logger.debug({ key }, "Skipping - processor already active");
        continue;
      }

      // Skip if already has successful booking
      if (this.successfulBookings.has(key)) {
        logger.debug({ key }, "Skipping - already has successful booking");
        continue;
      }

      // Skip if user is rate-limited
      if (this.rateLimitedUsers.has(userId)) {
        logger.debug({ userId }, "Skipping - user rate limited");
        continue;
      }

      // Skip if user has auth failure
      if (this.authFailedUsers.has(userId)) {
        logger.debug({ userId }, "Skipping - user auth failed");
        continue;
      }

      // Skip if user has existing reservation on target date
      if (this.hasExistingReservationOnDate(userId, targetDate)) {
        const reason = this.getExclusionReason(userId, targetDate);
        logger.info(
          { userId, targetDate, restaurant: restaurant.name, reason },
          "Skipping - user has existing reservation on target date"
        );
        continue;
      }

      // Filter slots for this user's preferences
      const userSlots = this.filterSlotsForUser(slots, subs);
      if (userSlots.length === 0) {
        logger.debug({ userId, restaurant: restaurant.name }, "No matching slots for user preferences");
        continue;
      }

      // Sort by time (earliest first)
      userSlots.sort((a, b) =>
        parseSlotTime(a.slot.slot.time) - parseSlotTime(b.slot.slot.time)
      );

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

      // Start processor (non-blocking)
      const processorPromise = this.processUserRestaurant(userContext, userSlots);
      this.activeProcessors.set(key, processorPromise);

      // Handle result asynchronously
      processorPromise.then((result) => {
        this.activeProcessors.delete(key);

        if (result.success) {
          this.successfulBookings.add(key);

          const bookedSlot = userSlots[0]; // We don't track which slot succeeded, use first as placeholder
          const userResult: UserBookingResult = {
            userId,
            discordId: sub.discord_id,
            success: true,
            bookedSlot: bookedSlot.slot,
            reservationId: result.reservationId,
          };

          logger.info(
            {
              userId,
              restaurant: restaurant.name,
              reservationId: result.reservationId,
            },
            "BOOKING SUCCESS!"
          );

          this.onBookingSuccess?.(userResult);
        } else if (result.status === "rate_limited") {
          this.rateLimitedUsers.add(userId);
          logger.warn({ userId }, "User rate limited - stopping attempts");
        } else if (result.status === "auth_failed") {
          this.authFailedUsers.add(userId);
          logger.error({ userId }, "User auth failed - needs to re-register");
        }
      });
    }
  }

  /**
   * Process booking for a user/restaurant combination
   * Tries slots sequentially, handles WAF retries
   */
  private async processUserRestaurant(
    user: UserBookingContext,
    queuedSlots: QueuedSlot[]
  ): Promise<InternalBookingResult> {
    let slotIndex = 0;
    let retryCount = 0;

    logger.info(
      {
        userId: user.userId,
        slotsToTry: queuedSlots.length,
      },
      "Starting sequential slot processor"
    );

    while (slotIndex < queuedSlots.length) {
      const { slot: discoveredSlot, subscription } = queuedSlots[slotIndex];
      const slotTime = discoveredSlot.slot.time;
      const targetDate = discoveredSlot.targetDate;
      const restaurantId = discoveredSlot.restaurant.id;

      // Try to claim this slot before attempting booking
      const claimed = this.tryClaimSlot(restaurantId, targetDate, slotTime, user.userId);

      if (!claimed) {
        logger.debug(
          { userId: user.userId, slotTime, restaurant: discoveredSlot.restaurant.name },
          "Slot already claimed by another user - skipping"
        );
        slotIndex++;
        continue;
      }

      // Acquire ISP proxy
      logger.debug(
        { userId: user.userId, slotTime: discoveredSlot.slot.time },
        "Acquiring ISP proxy"
      );

      const proxy = await this.ispPool.acquire(PROXY_ACQUIRE_TIMEOUT_MS);
      if (!proxy) {
        logger.warn(
          { userId: user.userId },
          "Failed to acquire ISP proxy - no proxies available"
        );
        return {
          success: false,
          status: "unknown",
          errorMessage: "No ISP proxy available",
        };
      }

      logger.info(
        {
          userId: user.userId,
          restaurant: discoveredSlot.restaurant.name,
          slotTime: discoveredSlot.slot.time,
          proxyId: proxy.id,
          slotIndex,
          retryCount,
        },
        "Attempting booking"
      );

      // Record booking attempt
      store.createBookingAttempt({
        user_id: user.userId,
        restaurant_id: discoveredSlot.restaurant.id,
        target_date: discoveredSlot.targetDate,
        slot_time: discoveredSlot.slot.time,
        status: "pending",
        reservation_id: null,
        error_message: null,
        proxy_used: proxy.url,
      });

      try {
        const result = await this.attemptBooking(
          user,
          discoveredSlot,
          subscription,
          proxy
        );

        if (result.success) {
          this.ispPool.release(proxy.id);
          logger.debug({ proxyId: proxy.id }, "Released ISP proxy after success");

          // Record success
          this.recordSuccess(user, discoveredSlot, proxy, result.reservationId!);
          return result;
        }

        // Handle different failure types
        switch (result.status) {
          case "waf_blocked":
            // WAF blocked - mark proxy bad, possibly retry
            this.ispPool.markBad(proxy.id);
            retryCount++;

            if (retryCount >= MAX_RETRIES_PER_SLOT) {
              logger.warn(
                { userId: user.userId, slotTime: discoveredSlot.slot.time, retryCount },
                "Max WAF retries reached - moving to next slot"
              );
              // Release slot claim so others can try
              this.releaseSlot(restaurantId, targetDate, slotTime, user.userId);
              slotIndex++;
              retryCount = 0;
            } else {
              logger.info(
                { userId: user.userId, slotTime: discoveredSlot.slot.time, retryCount },
                "WAF blocked - retrying with new proxy"
              );
              // Keep slot claimed - this user is still retrying
            }
            break;

          case "sold_out":
            // Slot taken - try next (keep slot claimed, no point others trying)
            this.ispPool.release(proxy.id);
            logger.info(
              { userId: user.userId, slotTime: discoveredSlot.slot.time },
              "Slot sold out - trying next"
            );
            this.recordFailure(user, discoveredSlot, proxy, "Sold out", "sold_out");
            slotIndex++;
            retryCount = 0;
            break;

          case "rate_limited":
            // Rate limited - stop for this user, release slot for others
            this.ispPool.markBad(proxy.id);
            this.releaseSlot(restaurantId, targetDate, slotTime, user.userId);
            this.recordFailure(user, discoveredSlot, proxy, "Rate limited", "failed");
            return result;

          case "auth_failed":
            // Auth failed - stop for this user, release slot for others
            this.ispPool.release(proxy.id);
            this.releaseSlot(restaurantId, targetDate, slotTime, user.userId);
            this.recordFailure(user, discoveredSlot, proxy, "Auth failed", "failed");
            return result;

          default:
            // Other error - try next slot, release this slot for others
            this.ispPool.release(proxy.id);
            logger.warn(
              { userId: user.userId, slotTime: discoveredSlot.slot.time, status: result.status },
              "Booking failed - trying next slot"
            );
            this.releaseSlot(restaurantId, targetDate, slotTime, user.userId);
            this.recordFailure(user, discoveredSlot, proxy, result.errorMessage ?? "Unknown error", "failed");
            slotIndex++;
            retryCount = 0;
        }
      } catch (error) {
        // Unexpected error - release proxy and slot, try next
        this.ispPool.release(proxy.id);
        this.releaseSlot(restaurantId, targetDate, slotTime, user.userId);
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(
          { userId: user.userId, error: errorMsg },
          "Unexpected error during booking"
        );
        this.recordFailure(user, discoveredSlot, proxy, errorMsg, "failed");
        slotIndex++;
        retryCount = 0;
      }
    }

    logger.info(
      { userId: user.userId, slotsAttempted: queuedSlots.length },
      "All slots failed"
    );

    return {
      success: false,
      status: "unknown",
      errorMessage: "All slots failed",
    };
  }

  /**
   * Attempt to book a single slot
   */
  private async attemptBooking(
    user: UserBookingContext,
    slot: DiscoveredSlot,
    subscription: FullSubscription,
    proxy: Proxy
  ): Promise<InternalBookingResult> {
    const client = new ResyClient({
      apiKey: this.apiKey,
      authToken: user.resyAuthToken,
      proxyUrl: proxy.url,
    });

    try {
      // Step 1: Get booking details and token
      const details = await client.getDetails({
        venue_id: Number(slot.restaurant.venue_id),
        day: slot.targetDate,
        party_size: subscription.party_size,
        config_id: slot.slot.config_id,
      });

      const bookToken = details.book_token?.value;
      if (!bookToken) {
        return {
          success: false,
          status: "no_book_token",
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
        return {
          success: true,
          status: "success",
          reservationId: 0,
          resyToken: "dry-run",
        };
      }

      // Step 3: Book the reservation
      const bookResult = await client.bookReservation({
        book_token: bookToken,
        payment_method_id: user.resyPaymentMethodId,
      });

      return {
        success: true,
        status: "success",
        reservationId: bookResult.reservation_id,
        resyToken: bookResult.resy_token,
      };
    } catch (error) {
      return this.classifyError(error, user, slot);
    }
  }

  /**
   * Classify an error into a booking status
   * Detects WAF blocks (500 with empty body) vs other errors
   */
  private classifyError(
    error: unknown,
    user: UserBookingContext,
    slot: DiscoveredSlot
  ): InternalBookingResult {
    const status = error instanceof ResyAPIError ? error.status : 0;
    const code = error instanceof ResyAPIError ? error.code : undefined;
    const rawBody = error instanceof ResyAPIError ? error.rawBody : undefined;
    const message = error instanceof Error ? error.message : String(error);

    // Log error to DB for analysis
    store.logBookingError({
      user_id: user.userId,
      restaurant_id: slot.restaurant.id,
      http_status: status,
      error_code: code !== undefined ? String(code) : null,
      error_message: message,
      raw_response: rawBody ?? null,
    });

    // Log for visibility
    logger.warn(
      {
        userId: user.userId,
        restaurant: slot.restaurant.name,
        time: slot.slot.time,
        httpStatus: status,
        code,
        rawBodyLength: rawBody?.length ?? 0,
        rawBodyPreview: rawBody?.substring(0, 200),
      },
      "Booking error - classifying"
    );

    // WAF block detection: 500 with empty or very short body
    if (status === 500) {
      const isEmpty = !rawBody || rawBody.trim().length === 0 || rawBody.trim() === "{}";
      if (isEmpty) {
        logger.info(
          { userId: user.userId, httpStatus: status },
          "Detected WAF block (500 empty body)"
        );
        return {
          success: false,
          status: "waf_blocked",
          errorMessage: "WAF blocked (500 empty body)",
        };
      }
      // 500 with JSON body is a server error, not WAF
      return {
        success: false,
        status: "server_error",
        errorMessage: message,
      };
    }

    // 412 = Slot taken (Precondition Failed)
    if (status === 412) {
      return {
        success: false,
        status: "sold_out",
        errorMessage: "Slot no longer available",
      };
    }

    // 429 = Rate limited
    if (status === 429) {
      return {
        success: false,
        status: "rate_limited",
        errorMessage: "Rate limited",
      };
    }

    // 401/403 = Auth failed
    if (status === 401 || status === 403) {
      return {
        success: false,
        status: "auth_failed",
        errorMessage: message,
      };
    }

    // Unknown error
    return {
      success: false,
      status: "unknown",
      errorMessage: message,
    };
  }

  /**
   * Check if a user has an existing reservation on the target date
   */
  private hasExistingReservationOnDate(userId: number, targetDate: string): boolean {
    if (!this.accountExclusions) return false;
    if (this.accountExclusions.targetDate !== targetDate) return false;

    const userReservations = this.accountExclusions.reservationsByUser.get(userId);
    if (!userReservations || userReservations.length === 0) return false;

    return userReservations.some((r) => r.date === targetDate);
  }

  /**
   * Get the reason a user is excluded (for logging)
   */
  private getExclusionReason(userId: number, targetDate: string): string | null {
    if (!this.accountExclusions) return null;

    const userReservations = this.accountExclusions.reservationsByUser.get(userId);
    if (!userReservations) return null;

    const sameDayRes = userReservations.find((r) => r.date === targetDate);
    if (!sameDayRes) return null;

    return `Existing reservation at ${sameDayRes.venueName} at ${sameDayRes.timeSlot}`;
  }

  /**
   * Record successful booking attempt
   */
  private recordSuccess(
    user: UserBookingContext,
    slot: DiscoveredSlot,
    proxy: Proxy,
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
      proxy_used: proxy.url,
    });
  }

  /**
   * Record failed booking attempt
   */
  private recordFailure(
    user: UserBookingContext,
    slot: DiscoveredSlot,
    proxy: Proxy,
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
      proxy_used: proxy.url,
    });
  }

  /**
   * Filter slots for user's subscription preferences
   */
  private filterSlotsForUser(
    slots: DiscoveredSlot[],
    subscriptions: FullSubscription[]
  ): QueuedSlot[] {
    const result: QueuedSlot[] = [];

    for (const slot of slots) {
      for (const sub of subscriptions) {
        if (this.slotMatchesSubscription(slot, sub)) {
          result.push({ slot, subscription: sub });
          break; // Only add once per slot
        }
      }
    }

    return result;
  }

  /**
   * Check if a slot matches a subscription's preferences
   * Uses day_configs for per-day time windows if available, falls back to legacy time_window_*
   */
  private slotMatchesSubscription(slot: DiscoveredSlot, sub: FullSubscription): boolean {
    const slotMinutes = parseSlotTime(slot.slot.time);

    // Get time window for this specific day
    let startMinutes: number;
    let endMinutes: number;

    const dayConfig = getTimeWindowForDate(sub.day_configs, slot.targetDate);
    if (dayConfig) {
      // Use per-day time window
      startMinutes = this.parseTimeWindow(dayConfig.start);
      endMinutes = this.parseTimeWindow(dayConfig.end);
    } else {
      // Fall back to legacy global time window
      startMinutes = this.parseTimeWindow(sub.time_window_start);
      endMinutes = this.parseTimeWindow(sub.time_window_end);
    }

    // Check time window
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
   * Get full subscriptions for a restaurant (with user auth data)
   */
  private getFullSubscriptionsForRestaurant(restaurantId: number): FullSubscription[] {
    return store.getFullSubscriptions().filter((s) => s.restaurant_id === restaurantId);
  }

  /**
   * Reset state for a new scan window
   */
  reset(): void {
    this.activeProcessors.clear();
    this.successfulBookings.clear();
    this.rateLimitedUsers.clear();
    this.authFailedUsers.clear();
    this.accountExclusions = null;
    this.claimedSlots.clear();
    this.ispPool.reset();
    logger.info("Coordinator state reset for new window");
  }

  /**
   * Get coordinator stats
   */
  getStats(): {
    activeProcessors: number;
    successfulBookings: number;
    rateLimitedUsers: number;
    authFailedUsers: number;
    claimedSlots: number;
    proxyPoolStatus: {
      available: number;
      inUse: number;
      cooldown: number;
      total: number;
    };
  } {
    return {
      activeProcessors: this.activeProcessors.size,
      successfulBookings: this.successfulBookings.size,
      rateLimitedUsers: this.rateLimitedUsers.size,
      authFailedUsers: this.authFailedUsers.size,
      claimedSlots: this.claimedSlots.size,
      proxyPoolStatus: this.ispPool.getStatus(),
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
