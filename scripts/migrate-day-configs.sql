-- Migration: Add day_configs JSONB column for per-day time windows
--
-- This migration adds the day_configs column to support different time windows
-- for different days of the week. Example:
--   [
--     { "day": 5, "start": "18:00", "end": "22:00" },  -- Friday: 6pm-10pm
--     { "day": 6, "start": "11:30", "end": "22:00" },  -- Saturday: 11:30am-10pm
--     { "day": 0, "start": "11:30", "end": "22:00" }   -- Sunday: 11:30am-10pm
--   ]
--
-- The existing target_days and time_window_* columns are kept for backwards compatibility.
-- Application code checks day_configs first, then falls back to legacy columns.

-- Step 1: Add day_configs column to user_subscriptions
ALTER TABLE user_subscriptions
ADD COLUMN IF NOT EXISTS day_configs JSONB DEFAULT NULL;

-- Step 2: Add day_configs column to passive_targets
ALTER TABLE passive_targets
ADD COLUMN IF NOT EXISTS day_configs JSONB DEFAULT NULL;

-- Step 3: Add comment for documentation
COMMENT ON COLUMN user_subscriptions.day_configs IS
  'Per-day time window configuration. Array of {day: number, start: string, end: string}. Takes precedence over target_days + time_window_*.';

COMMENT ON COLUMN passive_targets.day_configs IS
  'Per-day time window configuration. Array of {day: number, start: string, end: string}. Takes precedence over target_days + time_window_*.';

-- Optional: Migrate existing data to day_configs format
-- This converts existing target_days + time_window_* to the new format.
-- Uncomment and run if you want to migrate existing subscriptions.
--
-- UPDATE user_subscriptions
-- SET day_configs = (
--   SELECT jsonb_agg(
--     jsonb_build_object(
--       'day', day,
--       'start', time_window_start,
--       'end', time_window_end
--     )
--   )
--   FROM unnest(target_days) AS day
-- )
-- WHERE target_days IS NOT NULL AND day_configs IS NULL;
--
-- UPDATE passive_targets
-- SET day_configs = (
--   SELECT jsonb_agg(
--     jsonb_build_object(
--       'day', day,
--       'start', time_window_start,
--       'end', time_window_end
--     )
--   )
--   FROM unnest(target_days) AS day
-- )
-- WHERE target_days IS NOT NULL AND day_configs IS NULL;

-- Verification query (run after migration to verify)
-- SELECT id, target_days, time_window_start, time_window_end, day_configs
-- FROM user_subscriptions
-- LIMIT 5;
