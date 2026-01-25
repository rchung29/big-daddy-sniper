/**
 * Supabase Migration Script
 *
 * This script outputs SQL to run in the Supabase SQL Editor.
 *
 * Run with: bun scripts/migrate-supabase.ts
 * Then copy the output and run it in:
 * https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new
 */

const SCHEMA = `
-- ============================================
-- Big Daddy Sniper Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- Curated restaurant library (Resy only)
CREATE TABLE IF NOT EXISTS restaurants (
  id SERIAL PRIMARY KEY,
  venue_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  neighborhood TEXT,
  cuisine TEXT,
  days_in_advance INTEGER NOT NULL,
  release_time TEXT NOT NULL,
  release_time_zone TEXT DEFAULT 'America/New_York',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users with Resy credentials
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  discord_id TEXT UNIQUE NOT NULL,
  discord_username TEXT,
  resy_auth_token TEXT,
  resy_payment_method_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User subscriptions to restaurants
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  party_size INTEGER NOT NULL DEFAULT 2,
  time_window_start TEXT NOT NULL,
  time_window_end TEXT NOT NULL,
  table_types JSONB,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, restaurant_id)
);

-- Booking attempts audit trail
CREATE TABLE IF NOT EXISTS booking_attempts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  restaurant_id INTEGER REFERENCES restaurants(id),
  target_date TEXT NOT NULL,
  slot_time TEXT,
  status TEXT NOT NULL,
  reservation_id INTEGER,
  error_message TEXT,
  proxy_used TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Booking errors for learning and debugging
CREATE TABLE IF NOT EXISTS booking_errors (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  restaurant_id INTEGER,
  http_status INTEGER,
  error_code TEXT,
  error_message TEXT,
  raw_response TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Proxy pool for assignment
CREATE TABLE IF NOT EXISTS proxies (
  id SERIAL PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  type TEXT DEFAULT 'residential',
  enabled BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  rate_limited_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_restaurants_enabled ON restaurants(enabled);
CREATE INDEX IF NOT EXISTS idx_restaurants_release_time ON restaurants(release_time);
CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_restaurant_id ON user_subscriptions(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_booking_attempts_user_id ON booking_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_booking_attempts_status ON booking_attempts(status);
CREATE INDEX IF NOT EXISTS idx_proxies_enabled ON proxies(enabled);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to tables with updated_at
DROP TRIGGER IF EXISTS update_restaurants_updated_at ON restaurants;
CREATE TRIGGER update_restaurants_updated_at
    BEFORE UPDATE ON restaurants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_subscriptions_updated_at ON user_subscriptions;
CREATE TRIGGER update_user_subscriptions_updated_at
    BEFORE UPDATE ON user_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Schema migration complete!
-- ============================================
`;

console.log("=".repeat(60));
console.log("SUPABASE MIGRATION SQL");
console.log("=".repeat(60));
console.log("\nCopy the SQL below and run it in Supabase SQL Editor:");
console.log("https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new\n");
console.log("=".repeat(60));
console.log(SCHEMA);
console.log("=".repeat(60));
