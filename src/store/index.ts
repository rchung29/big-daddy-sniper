/**
 * In-Memory Store with Supabase Write-Through
 *
 * Architecture:
 * - Bootstrap: Load all data from Supabase into memory
 * - Reads: Always from memory (zero latency)
 * - Writes: Update memory immediately, persist to Supabase async (fire-and-forget)
 * - Sync: Refresh from DB every 5 minutes (skip if within 60s of a release)
 *
 * This keeps the hot path (booking execution) completely off the database.
 */
import { getSupabase, executeWriteThrough } from "../db/supabase";
import type {
  Restaurant,
  User,
  UserSubscription,
  Proxy,
  BookingAttempt,
  BookingError,
  FullSubscription,
} from "../db/schema";
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

// Sync interval: 5 minutes
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
// Blackout window: don't sync within 60 seconds of a release
const BLACKOUT_WINDOW_MS = 60 * 1000;

/**
 * In-memory data store
 */
class Store {
  // Core data
  private restaurants = new Map<number, Restaurant>();
  private restaurantsByVenueId = new Map<string, Restaurant>();
  private users = new Map<number, User>();
  private usersByDiscordId = new Map<string, User>();
  private subscriptions = new Map<number, UserSubscription>();
  private proxies = new Map<number, Proxy>();

  // Sync state
  private syncTimer: Timer | null = null;
  private lastSyncAt: Date | null = null;
  private initialized = false;

  // Callback for getting next release times (set by scheduler)
  private getNextReleaseTimes: (() => Date[]) | null = null;

  /**
   * Initialize store from Supabase
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn("Store already initialized");
      return;
    }

    logger.info("Initializing store from Supabase...");
    const startTime = Date.now();

    await this.loadAll();

    this.initialized = true;
    this.lastSyncAt = new Date();

    // Start periodic sync
    this.startPeriodicSync();

    logger.info(
      {
        restaurants: this.restaurants.size,
        users: this.users.size,
        subscriptions: this.subscriptions.size,
        proxies: this.proxies.size,
        loadTimeMs: Date.now() - startTime,
      },
      "Store initialized"
    );
  }

  /**
   * Load all data from Supabase
   */
  private async loadAll(): Promise<void> {
    const supabase = getSupabase();

    // Load restaurants
    const { data: restaurants, error: restError } = await supabase
      .from("restaurants")
      .select("*")
      .eq("enabled", true);

    if (restError) throw new Error(`Failed to load restaurants: ${restError.message}`);

    this.restaurants.clear();
    this.restaurantsByVenueId.clear();
    for (const r of restaurants ?? []) {
      this.restaurants.set(r.id, r);
      this.restaurantsByVenueId.set(r.venue_id, r);
    }

    // Load users
    const { data: users, error: userError } = await supabase
      .from("users")
      .select("*");

    if (userError) throw new Error(`Failed to load users: ${userError.message}`);

    this.users.clear();
    this.usersByDiscordId.clear();
    for (const u of users ?? []) {
      this.users.set(u.id, u);
      this.usersByDiscordId.set(u.discord_id, u);
    }

    // Load subscriptions
    const { data: subscriptions, error: subError } = await supabase
      .from("user_subscriptions")
      .select("*")
      .eq("enabled", true);

    if (subError) throw new Error(`Failed to load subscriptions: ${subError.message}`);

    this.subscriptions.clear();
    for (const s of subscriptions ?? []) {
      this.subscriptions.set(s.id, s);
    }

    // Load proxies
    const { data: proxies, error: proxyError } = await supabase
      .from("proxies")
      .select("*")
      .eq("enabled", true);

    if (proxyError) throw new Error(`Failed to load proxies: ${proxyError.message}`);

    this.proxies.clear();
    for (const p of proxies ?? []) {
      this.proxies.set(p.id, p);
    }
  }

  /**
   * Start periodic sync (every 5 minutes)
   */
  private startPeriodicSync(): void {
    if (this.syncTimer) return;

    this.syncTimer = setInterval(() => {
      this.syncIfSafe();
    }, SYNC_INTERVAL_MS);

    logger.info({ intervalMs: SYNC_INTERVAL_MS }, "Periodic sync started");
  }

  /**
   * Stop periodic sync
   */
  stopPeriodicSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      logger.info("Periodic sync stopped");
    }
  }

  /**
   * Sync from DB if not in blackout window
   */
  private async syncIfSafe(): Promise<void> {
    // Check if we're in a blackout window
    if (this.isInBlackoutWindow()) {
      logger.info("Skipping sync - within blackout window of release");
      return;
    }

    await this.sync();
  }

  /**
   * Check if any release is within the blackout window
   */
  private isInBlackoutWindow(): boolean {
    if (!this.getNextReleaseTimes) return false;

    const now = Date.now();
    const releaseTimes = this.getNextReleaseTimes();

    for (const releaseTime of releaseTimes) {
      const msUntilRelease = releaseTime.getTime() - now;
      if (msUntilRelease > 0 && msUntilRelease < BLACKOUT_WINDOW_MS) {
        return true;
      }
    }

    return false;
  }

  /**
   * Force sync from Supabase (refreshes all in-memory data)
   */
  async sync(): Promise<void> {
    logger.info("Syncing from Supabase...");
    const startTime = Date.now();

    try {
      await this.loadAll();
      this.lastSyncAt = new Date();

      logger.info(
        {
          restaurants: this.restaurants.size,
          users: this.users.size,
          subscriptions: this.subscriptions.size,
          proxies: this.proxies.size,
          syncTimeMs: Date.now() - startTime,
        },
        "Sync complete"
      );
    } catch (error) {
      logger.error({ error: String(error) }, "Sync failed");
    }
  }

  /**
   * Set callback for getting next release times (called by scheduler)
   */
  setReleasTimeCallback(callback: () => Date[]): void {
    this.getNextReleaseTimes = callback;
  }

  // ============ Restaurant Operations ============

  getAllRestaurants(): Restaurant[] {
    return Array.from(this.restaurants.values());
  }

  getRestaurantById(id: number): Restaurant | undefined {
    return this.restaurants.get(id);
  }

  getRestaurantByVenueId(venueId: string): Restaurant | undefined {
    return this.restaurantsByVenueId.get(venueId);
  }

  getRestaurantsByReleaseTime(releaseTime: string): Restaurant[] {
    return this.getAllRestaurants().filter((r) => r.release_time === releaseTime);
  }

  getUniqueReleaseTimes(): string[] {
    const times = new Set<string>();
    for (const r of this.restaurants.values()) {
      times.add(r.release_time);
    }
    return Array.from(times).sort();
  }

  searchRestaurantsByName(query: string): Restaurant[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllRestaurants().filter((r) =>
      r.name.toLowerCase().includes(lowerQuery)
    );
  }

  async upsertRestaurant(
    data: Omit<Restaurant, "id" | "created_at" | "updated_at">
  ): Promise<Restaurant> {
    const supabase = getSupabase();

    // Check if exists in memory
    const existing = this.restaurantsByVenueId.get(data.venue_id);

    if (existing) {
      // Update
      const updated: Restaurant = {
        ...existing,
        ...data,
        updated_at: new Date(),
      };
      this.restaurants.set(existing.id, updated);
      this.restaurantsByVenueId.set(data.venue_id, updated);

      // Write-through
      executeWriteThrough("updateRestaurant", async () => {
        await supabase
          .from("restaurants")
          .update({
            name: data.name,
            neighborhood: data.neighborhood,
            cuisine: data.cuisine,
            days_in_advance: data.days_in_advance,
            release_time: data.release_time,
            release_time_zone: data.release_time_zone,
            enabled: data.enabled,
          })
          .eq("id", existing.id);
      });

      return updated;
    } else {
      // Insert
      const { data: inserted, error } = await supabase
        .from("restaurants")
        .insert({
          venue_id: data.venue_id,
          name: data.name,
          neighborhood: data.neighborhood,
          cuisine: data.cuisine,
          days_in_advance: data.days_in_advance,
          release_time: data.release_time,
          release_time_zone: data.release_time_zone,
          enabled: data.enabled,
        })
        .select()
        .single();

      if (error) throw new Error(`Failed to insert restaurant: ${error.message}`);

      this.restaurants.set(inserted.id, inserted);
      this.restaurantsByVenueId.set(inserted.venue_id, inserted);

      return inserted;
    }
  }

  // ============ User Operations ============

  getAllUsers(): User[] {
    return Array.from(this.users.values());
  }

  getUserById(id: number): User | undefined {
    return this.users.get(id);
  }

  getUserByDiscordId(discordId: string): User | undefined {
    return this.usersByDiscordId.get(discordId);
  }

  isUserRegistered(userId: number): boolean {
    const user = this.users.get(userId);
    return !!user?.resy_auth_token && !!user?.resy_payment_method_id;
  }

  async upsertUser(
    discordId: string,
    data: Partial<Omit<User, "id" | "discord_id" | "created_at" | "updated_at">>
  ): Promise<User> {
    const supabase = getSupabase();
    const existing = this.usersByDiscordId.get(discordId);

    if (existing) {
      // Update in memory
      const updated: User = {
        ...existing,
        ...data,
        updated_at: new Date(),
      };
      this.users.set(existing.id, updated);
      this.usersByDiscordId.set(discordId, updated);

      // Write-through
      executeWriteThrough("updateUser", async () => {
        await supabase
          .from("users")
          .update({
            discord_username: data.discord_username ?? existing.discord_username,
            resy_auth_token: data.resy_auth_token ?? existing.resy_auth_token,
            resy_payment_method_id: data.resy_payment_method_id ?? existing.resy_payment_method_id,
          })
          .eq("id", existing.id);
      });

      return updated;
    } else {
      // Insert
      const { data: inserted, error } = await supabase
        .from("users")
        .insert({
          discord_id: discordId,
          discord_username: data.discord_username ?? null,
          resy_auth_token: data.resy_auth_token ?? null,
          resy_payment_method_id: data.resy_payment_method_id ?? null,
        })
        .select()
        .single();

      if (error) throw new Error(`Failed to insert user: ${error.message}`);

      this.users.set(inserted.id, inserted);
      this.usersByDiscordId.set(inserted.discord_id, inserted);

      return inserted;
    }
  }

  // ============ Subscription Operations ============

  getAllSubscriptions(): UserSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  getSubscriptionsByUser(userId: number): UserSubscription[] {
    return this.getAllSubscriptions().filter((s) => s.user_id === userId);
  }

  getSubscriptionsByRestaurant(restaurantId: number): UserSubscription[] {
    return this.getAllSubscriptions().filter((s) => s.restaurant_id === restaurantId);
  }

  getSubscriptionByUserAndRestaurant(
    userId: number,
    restaurantId: number
  ): UserSubscription | undefined {
    return this.getAllSubscriptions().find(
      (s) => s.user_id === userId && s.restaurant_id === restaurantId
    );
  }

  getSubscriptionByUserRestaurantParty(
    userId: number,
    restaurantId: number,
    partySize: number
  ): UserSubscription | undefined {
    return this.getAllSubscriptions().find(
      (s) => s.user_id === userId && s.restaurant_id === restaurantId && s.party_size === partySize
    );
  }

  /**
   * Get all active subscriptions with full details (for scheduler/executor)
   */
  getFullSubscriptions(): FullSubscription[] {
    const result: FullSubscription[] = [];

    for (const sub of this.subscriptions.values()) {
      const user = this.users.get(sub.user_id);
      const restaurant = this.restaurants.get(sub.restaurant_id);

      if (
        !user ||
        !restaurant ||
        !user.resy_auth_token ||
        !user.resy_payment_method_id
      ) {
        continue;
      }

      result.push({
        ...sub,
        restaurant_name: restaurant.name,
        venue_id: restaurant.venue_id,
        days_in_advance: restaurant.days_in_advance,
        release_time: restaurant.release_time,
        discord_id: user.discord_id,
        resy_auth_token: user.resy_auth_token,
        resy_payment_method_id: user.resy_payment_method_id,
      });
    }

    return result;
  }

  /**
   * Get subscriptions grouped by release time
   */
  getSubscriptionsGroupedByReleaseTime(): Map<string, FullSubscription[]> {
    const grouped = new Map<string, FullSubscription[]>();
    const fullSubs = this.getFullSubscriptions();

    for (const sub of fullSubs) {
      const existing = grouped.get(sub.release_time) ?? [];
      existing.push(sub);
      grouped.set(sub.release_time, existing);
    }

    return grouped;
  }

  async upsertSubscription(
    userId: number,
    restaurantId: number,
    data: {
      party_size: number;
      time_window_start: string;
      time_window_end: string;
      table_types?: string[];
      target_days?: number[] | null;
    }
  ): Promise<UserSubscription> {
    const supabase = getSupabase();
    // Unique key is (user_id, restaurant_id, party_size)
    const existing = this.getSubscriptionByUserRestaurantParty(userId, restaurantId, data.party_size);

    if (existing) {
      // Update
      const updated: UserSubscription = {
        ...existing,
        ...data,
        target_days: data.target_days ?? existing.target_days,
        enabled: true,
        updated_at: new Date(),
      };
      this.subscriptions.set(existing.id, updated);

      executeWriteThrough("updateSubscription", async () => {
        await supabase
          .from("user_subscriptions")
          .update({
            party_size: data.party_size,
            time_window_start: data.time_window_start,
            time_window_end: data.time_window_end,
            table_types: data.table_types ?? null,
            target_days: data.target_days ?? null,
            enabled: true,
          })
          .eq("id", existing.id);
      });

      return updated;
    } else {
      // Insert
      const { data: inserted, error } = await supabase
        .from("user_subscriptions")
        .insert({
          user_id: userId,
          restaurant_id: restaurantId,
          party_size: data.party_size,
          time_window_start: data.time_window_start,
          time_window_end: data.time_window_end,
          table_types: data.table_types ?? null,
          target_days: data.target_days ?? null,
          enabled: true,
        })
        .select()
        .single();

      if (error) throw new Error(`Failed to insert subscription: ${error.message}`);

      this.subscriptions.set(inserted.id, inserted);
      return inserted;
    }
  }

  async deleteSubscription(userId: number, restaurantId: number, partySize?: number): Promise<boolean> {
    const supabase = getSupabase();
    // If partySize provided, delete specific subscription; otherwise delete first match (backwards compat)
    const existing = partySize !== undefined
      ? this.getSubscriptionByUserRestaurantParty(userId, restaurantId, partySize)
      : this.getSubscriptionByUserAndRestaurant(userId, restaurantId);

    if (!existing) return false;

    // Remove from memory
    this.subscriptions.delete(existing.id);

    // Write-through
    executeWriteThrough("deleteSubscription", async () => {
      await supabase
        .from("user_subscriptions")
        .delete()
        .eq("id", existing.id);
    });

    return true;
  }

  // ============ Proxy Operations ============

  getAllProxies(): Proxy[] {
    return Array.from(this.proxies.values());
  }

  getAvailableProxies(): Proxy[] {
    const now = new Date();
    return this.getAllProxies()
      .filter((p) => {
        if (!p.enabled) return false;
        if (p.rate_limited_until && new Date(p.rate_limited_until) > now) return false;
        return true;
      })
      .sort((a, b) => {
        // Sort by last used (least recently used first)
        const aTime = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
        const bTime = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
        return aTime - bTime;
      });
  }

  markProxyUsed(proxyId: number): void {
    const proxy = this.proxies.get(proxyId);
    if (!proxy) return;

    proxy.last_used_at = new Date();

    // Write-through (fire and forget)
    executeWriteThrough("markProxyUsed", async () => {
      const supabase = getSupabase();
      await supabase
        .from("proxies")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", proxyId);
    });
  }

  markProxyRateLimited(proxyId: number, durationMs: number): void {
    const proxy = this.proxies.get(proxyId);
    if (!proxy) return;

    proxy.rate_limited_until = new Date(Date.now() + durationMs);

    executeWriteThrough("markProxyRateLimited", async () => {
      const supabase = getSupabase();
      await supabase
        .from("proxies")
        .update({ rate_limited_until: proxy.rate_limited_until!.toISOString() })
        .eq("id", proxyId);
    });
  }

  clearProxyRateLimit(proxyId: number): void {
    const proxy = this.proxies.get(proxyId);
    if (!proxy) return;

    proxy.rate_limited_until = null;

    executeWriteThrough("clearProxyRateLimit", async () => {
      const supabase = getSupabase();
      await supabase
        .from("proxies")
        .update({ rate_limited_until: null })
        .eq("id", proxyId);
    });
  }

  // ============ Booking Operations (write-only, no in-memory cache) ============

  async createBookingAttempt(data: Omit<BookingAttempt, "id" | "created_at">): Promise<void> {
    executeWriteThrough("createBookingAttempt", async () => {
      const supabase = getSupabase();
      await supabase
        .from("booking_attempts")
        .insert({
          user_id: data.user_id,
          restaurant_id: data.restaurant_id,
          target_date: data.target_date,
          slot_time: data.slot_time,
          status: data.status,
          reservation_id: data.reservation_id,
          error_message: data.error_message,
          proxy_used: data.proxy_used,
        });
    });
  }

  async logBookingError(data: Omit<BookingError, "id" | "created_at">): Promise<void> {
    executeWriteThrough("logBookingError", async () => {
      const supabase = getSupabase();
      await supabase
        .from("booking_errors")
        .insert({
          user_id: data.user_id,
          restaurant_id: data.restaurant_id,
          http_status: data.http_status,
          error_code: data.error_code,
          error_message: data.error_message,
          raw_response: data.raw_response,
        });
    });
  }

  /**
   * Check if user has successful booking (queries memory of recent bookings - not implemented yet)
   * For now, always returns false to allow booking attempts
   */
  hasSuccessfulBooking(_userId: number, _restaurantId: number, _targetDate: string): boolean {
    // TODO: Track recent successful bookings in memory if needed
    // For now, let the booking attempt happen and Resy will reject duplicates
    return false;
  }

  // ============ Store Status ============

  getStatus(): {
    initialized: boolean;
    lastSyncAt: Date | null;
    counts: {
      restaurants: number;
      users: number;
      subscriptions: number;
      proxies: number;
    };
  } {
    return {
      initialized: this.initialized,
      lastSyncAt: this.lastSyncAt,
      counts: {
        restaurants: this.restaurants.size,
        users: this.users.size,
        subscriptions: this.subscriptions.size,
        proxies: this.proxies.size,
      },
    };
  }
}

// Singleton instance
export const store = new Store();
