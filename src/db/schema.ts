/**
 * Database schema type definitions
 * These types match the Supabase PostgreSQL tables
 */

/**
 * Restaurant in the curated library
 */
export interface Restaurant {
  id: number;
  venue_id: string;
  name: string;
  neighborhood: string | null;
  cuisine: string | null;
  days_in_advance: number;
  release_time: string; // HH:mm format
  release_time_zone: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * User with Resy credentials
 */
export interface User {
  id: number;
  discord_id: string;
  discord_username: string | null;
  resy_auth_token: string | null;
  resy_payment_method_id: number | null;
  preferred_proxy_id: number | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * User subscription to a restaurant
 */
export interface UserSubscription {
  id: number;
  user_id: number;
  restaurant_id: number;
  party_size: number;
  time_window_start: string; // HH:mm format
  time_window_end: string;
  table_types: string[] | null; // JSON array
  target_days: number[] | null; // Days of week: 0=Sun, 1=Mon, ..., 6=Sat (null = any day)
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Booking attempt record
 */
export interface BookingAttempt {
  id: number;
  user_id: number | null;
  restaurant_id: number | null;
  target_date: string; // YYYY-MM-DD
  slot_time: string | null;
  status: "pending" | "success" | "failed" | "sold_out";
  reservation_id: number | null;
  error_message: string | null;
  proxy_used: string | null;
  created_at: Date;
}

/**
 * Booking error for debugging
 */
export interface BookingError {
  id: number;
  user_id: number | null;
  restaurant_id: number | null;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  raw_response: string | null;
  created_at: Date;
}

/**
 * Proxy for rotation
 */
export interface Proxy {
  id: number;
  url: string;
  type: "datacenter" | "isp";
  enabled: boolean;
  last_used_at: Date | null;
  rate_limited_until: Date | null;
  created_at: Date;
}

/**
 * Subscription with restaurant details (denormalized for in-memory use)
 */
export interface SubscriptionWithDetails extends UserSubscription {
  restaurant_name: string;
  venue_id: string;
  days_in_advance: number;
  release_time: string;
}

/**
 * Full subscription with user auth (for executor)
 */
export interface FullSubscription extends SubscriptionWithDetails {
  discord_id: string;
  resy_auth_token: string;
  resy_payment_method_id: number;
  preferred_proxy_id: number | null;
}

/**
 * Slot snapshot for debugging drops
 */
export interface SlotSnapshot {
  id: number;
  restaurant_id: number | null;
  restaurant_name: string;
  target_date: string;
  party_size: number;
  slot_count: number;
  slots: Array<{ time: string; type: string | null }>;
  created_at: Date;
}

/**
 * Passive monitoring target - separate from release-time subscriptions
 */
export interface PassiveTarget {
  id: number;
  user_id: number;
  restaurant_id: number;
  party_size: number;
  target_days: number[] | null; // Days of week: 0=Sun, 1=Mon, ..., 6=Sat (null = any day)
  time_window_start: string; // HH:mm format
  time_window_end: string;
  table_types: string[] | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Full passive target with user and restaurant details (for passive monitor)
 */
export interface FullPassiveTarget extends PassiveTarget {
  // Restaurant details
  venue_id: string;
  restaurant_name: string;
  days_in_advance: number;
  // User details
  discord_id: string;
  resy_auth_token: string;
  resy_payment_method_id: number;
  preferred_proxy_id: number | null;
}
