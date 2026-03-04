/**
 * Seed subscriptions for ALL accounts
 *
 * DELETES ALL EXISTING SUBSCRIPTIONS first, then creates fresh ones:
 * - Every user subscribed to every active restaurant
 * - Party size: 4
 * - Per-day time windows using day_configs:
 *   - Default restaurants: Fri 7-11 PM, Sat any time, Sun any time
 *   - Excluded restaurants (IDs 29, 51, 36): any time, any day
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// DayConfig type for per-day time windows
interface DayConfig {
  day: number;    // 0=Sun, 1=Mon, ..., 6=Sat
  start: string;  // HH:mm format
  end: string;    // HH:mm format
}

// Restaurant IDs that should be any time, any day
const ANY_TIME_RESTAURANT_IDS = [29, 51, 36];

async function seedSubscriptions() {
  const partySize = 4;

  // Default: Fri 7-11 PM, Sat any time, Sun any time
  const defaultDayConfigs: DayConfig[] = [
    { day: 5, start: "19:00", end: "23:00" },  // Friday: 7:00 PM - 11:00 PM
    { day: 6, start: "00:00", end: "23:59" },  // Saturday: any time
    { day: 0, start: "00:00", end: "23:59" },  // Sunday: any time
  ];

  // Any time, any day
  const anyTimeDayConfigs: DayConfig[] = [
    { day: 0, start: "00:00", end: "23:59" },  // Sunday
    { day: 1, start: "00:00", end: "23:59" },  // Monday
    { day: 2, start: "00:00", end: "23:59" },  // Tuesday
    { day: 3, start: "00:00", end: "23:59" },  // Wednesday
    { day: 4, start: "00:00", end: "23:59" },  // Thursday
    { day: 5, start: "00:00", end: "23:59" },  // Friday
    { day: 6, start: "00:00", end: "23:59" },  // Saturday
  ];

  // Step 1: Delete all existing subscriptions
  console.log("Deleting all existing subscriptions...");
  const { error: deleteError } = await supabase
    .from("user_subscriptions")
    .delete()
    .neq("id", 0); // Delete all rows (neq id 0 matches everything)

  if (deleteError) {
    console.error("Failed to delete subscriptions:", deleteError.message);
    process.exit(1);
  }
  console.log("All subscriptions deleted.");

  // Step 2: Fetch all users with valid Resy credentials
  console.log("\nFetching all users with Resy credentials...");
  const { data: users, error: userError } = await supabase
    .from("users")
    .select("id, discord_username")
    .not("resy_auth_token", "is", null)
    .not("resy_payment_method_id", "is", null);

  if (userError) {
    console.error("Failed to fetch users:", userError.message);
    process.exit(1);
  }

  if (!users || users.length === 0) {
    console.log("No users with Resy credentials found.");
    process.exit(1);
  }

  console.log(`Found ${users.length} users with Resy credentials`);

  // Step 3: Fetch active restaurants
  console.log("\nFetching active restaurants...");
  const { data: restaurants, error: fetchError } = await supabase
    .from("restaurants")
    .select("id, name")
    .eq("enabled", true);

  if (fetchError) {
    console.error("Failed to fetch restaurants:", fetchError.message);
    process.exit(1);
  }

  if (!restaurants || restaurants.length === 0) {
    console.log("No active restaurants found. Run seed-restaurants.ts first.");
    process.exit(1);
  }

  console.log(`Found ${restaurants.length} active restaurants`);

  // Step 4: Create subscriptions for each user and restaurant
  const subscriptions: Array<{
    user_id: number;
    restaurant_id: number;
    party_size: number;
    day_configs: DayConfig[];
    enabled: boolean;
  }> = [];

  for (const user of users) {
    for (const r of restaurants) {
      const isAnyTime = ANY_TIME_RESTAURANT_IDS.includes(r.id);
      subscriptions.push({
        user_id: user.id,
        restaurant_id: r.id,
        party_size: partySize,
        day_configs: isAnyTime ? anyTimeDayConfigs : defaultDayConfigs,
        enabled: true,
      });
    }
  }

  console.log(`\nCreating ${subscriptions.length} subscriptions (${users.length} users × ${restaurants.length} restaurants)...`);

  const { error: insertError } = await supabase
    .from("user_subscriptions")
    .insert(subscriptions);

  if (insertError) {
    console.error("Failed to insert subscriptions:", insertError.message);
    process.exit(1);
  }

  const anyTimeRestaurants = restaurants.filter(r => ANY_TIME_RESTAURANT_IDS.includes(r.id));
  const defaultRestaurants = restaurants.filter(r => !ANY_TIME_RESTAURANT_IDS.includes(r.id));

  console.log("\nSubscriptions created successfully!");
  console.log(`  Users: ${users.length}`);
  console.log(`  Party size: ${partySize}`);
  console.log(`  Total subscriptions: ${subscriptions.length}`);

  console.log(`\n  Default restaurants (${defaultRestaurants.length}):`);
  console.log(`    - Friday: 7:00 PM - 11:00 PM`);
  console.log(`    - Saturday: any time`);
  console.log(`    - Sunday: any time`);
  for (const r of defaultRestaurants) {
    console.log(`    - ${r.name} (id: ${r.id})`);
  }

  console.log(`\n  Any time/any day restaurants (${anyTimeRestaurants.length}):`);
  for (const r of anyTimeRestaurants) {
    console.log(`    - ${r.name} (id: ${r.id})`);
  }

  console.log("\nUsers subscribed:");
  for (const u of users) {
    console.log(`  - ${u.discord_username ?? `User #${u.id}`}`);
  }
}

seedSubscriptions().catch(console.error);
