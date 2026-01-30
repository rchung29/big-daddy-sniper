-- Create passive_targets table for passive monitoring
-- Run this in Supabase SQL Editor before running the seeding script

CREATE TABLE IF NOT EXISTS passive_targets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  party_size INTEGER NOT NULL DEFAULT 2,
  target_days INTEGER[] DEFAULT NULL,        -- Days of week: 0=Sun, 1=Mon, ..., 6=Sat (null = any day)
  time_window_start VARCHAR(5) NOT NULL,     -- "19:00"
  time_window_end VARCHAR(5) NOT NULL,       -- "21:00"
  table_types TEXT[] DEFAULT NULL,           -- Filter by table type, null = any
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, restaurant_id, party_size)
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_passive_targets_enabled ON passive_targets(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_passive_targets_user ON passive_targets(user_id);
CREATE INDEX IF NOT EXISTS idx_passive_targets_restaurant ON passive_targets(restaurant_id);

-- Enable RLS (optional, adjust policies as needed)
ALTER TABLE passive_targets ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access to passive_targets"
  ON passive_targets
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE passive_targets IS 'Passive monitoring targets - separate from release-time subscriptions';
COMMENT ON COLUMN passive_targets.target_days IS 'Days of week to monitor: 0=Sun, 1=Mon, ..., 6=Sat. NULL means any day.';
