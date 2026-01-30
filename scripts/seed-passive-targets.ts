/**
 * Seed Passive Targets
 *
 * Creates passive monitoring targets for all users × all active restaurants:
 * - Party of 2: 7pm-9pm on Friday + Saturday
 * - Party of 4: 7pm-10pm on Friday + Saturday + Sunday
 *
 * Usage: bun scripts/seed-passive-targets.ts
 */

import { createClient } from "@supabase/supabase-js";

// Load env
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Days of week: 0=Sun, 5=Fri, 6=Sat
const FRIDAY = 5;
const SATURDAY = 6;
const SUNDAY = 0;

interface TargetConfig {
  party_size: number;
  time_window_start: string;
  time_window_end: string;
  target_days: number[];
}

const TARGET_CONFIGS: TargetConfig[] = [
  {
    party_size: 2,
    time_window_start: "19:00",
    time_window_end: "21:00",
    target_days: [FRIDAY, SATURDAY],
  },
  {
    party_size: 4,
    time_window_start: "19:00",
    time_window_end: "22:00",
    target_days: [FRIDAY, SATURDAY, SUNDAY],
  },
];

async function main() {
  console.log("🌱 Seeding passive targets...\n");
  console.log("⚠️  Make sure you've run create-passive-targets-table.sql first!\n");

  // Get all users
  console.log("\n👤 Fetching users...");
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, discord_username");

  if (usersError) {
    console.error("Failed to fetch users:", usersError.message);
    process.exit(1);
  }

  console.log(`  Found ${users.length} users`);

  // Get all active restaurants
  console.log("\n🍽️  Fetching active restaurants...");
  const { data: restaurants, error: restaurantsError } = await supabase
    .from("restaurants")
    .select("id, name")
    .eq("enabled", true);

  if (restaurantsError) {
    console.error("Failed to fetch restaurants:", restaurantsError.message);
    process.exit(1);
  }

  console.log(`  Found ${restaurants.length} active restaurants`);

  // Build all targets
  const targets: Array<{
    user_id: number;
    restaurant_id: number;
    party_size: number;
    target_days: number[];
    time_window_start: string;
    time_window_end: string;
    table_types: null;
    enabled: boolean;
  }> = [];

  for (const user of users) {
    for (const restaurant of restaurants) {
      for (const config of TARGET_CONFIGS) {
        targets.push({
          user_id: user.id,
          restaurant_id: restaurant.id,
          party_size: config.party_size,
          target_days: config.target_days,
          time_window_start: config.time_window_start,
          time_window_end: config.time_window_end,
          table_types: null,
          enabled: true,
        });
      }
    }
  }

  console.log(`\n📝 Inserting ${targets.length} passive targets...`);
  console.log(`   (${users.length} users × ${restaurants.length} restaurants × ${TARGET_CONFIGS.length} configs)`);

  // Insert in batches to avoid timeout
  const BATCH_SIZE = 100;
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);

    const { data, error } = await supabase
      .from("passive_targets")
      .upsert(batch, {
        onConflict: "user_id,restaurant_id,party_size",
        ignoreDuplicates: true
      })
      .select();

    if (error) {
      console.error(`  Batch ${i / BATCH_SIZE + 1} error:`, error.message);
      skipped += batch.length;
    } else {
      inserted += data?.length ?? 0;
      skipped += batch.length - (data?.length ?? 0);
    }

    // Progress
    const progress = Math.min(100, Math.round(((i + batch.length) / targets.length) * 100));
    process.stdout.write(`\r   Progress: ${progress}%`);
  }

  console.log("\n");
  console.log("✅ Done!");
  console.log(`   Inserted: ${inserted}`);
  console.log(`   Skipped (already exist): ${skipped}`);

  // Summary
  console.log("\n📊 Summary of targets created:");
  for (const config of TARGET_CONFIGS) {
    const days = config.target_days.map(d => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ");
    console.log(`   • Party of ${config.party_size}: ${config.time_window_start}-${config.time_window_end} on ${days}`);
  }
}

main().catch(console.error);
