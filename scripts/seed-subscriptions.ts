/**
 * Seed subscriptions for ALL accounts
 *
 * DELETES ALL EXISTING SUBSCRIPTIONS first, then creates fresh ones:
 * - Every user subscribed to every active restaurant
 * - Party size: 4
 * - Per-day time windows using day_configs:
 *   - Friday (5): 6:00 PM - 10:00 PM
 *   - Saturday (6): 11:30 AM - 10:00 PM
 *   - Sunday (0): 11:30 AM - 10:00 PM
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

async function seedSubscriptions() {
  const partySize = 4;

  // Per-day time windows
  const dayConfigs: DayConfig[] = [
    { day: 5, start: "18:00", end: "22:00" },  // Friday: 6:00 PM - 10:00 PM
    { day: 6, start: "11:30", end: "22:00" },  // Saturday: 11:30 AM - 10:00 PM
    { day: 0, start: "11:30", end: "22:00" },  // Sunday: 11:30 AM - 10:00 PM
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
      subscriptions.push({
        user_id: user.id,
        restaurant_id: r.id,
        party_size: partySize,
        day_configs: dayConfigs,
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

  console.log("\nSubscriptions created successfully!");
  console.log(`  Users: ${users.length}`);
  console.log(`  Party size: ${partySize}`);
  console.log(`  Per-day time windows:`);
  console.log(`    - Friday: 6:00 PM - 10:00 PM`);
  console.log(`    - Saturday: 11:30 AM - 10:00 PM`);
  console.log(`    - Sunday: 11:30 AM - 10:00 PM`);
  console.log(`  Restaurants: ${restaurants.length}`);
  console.log(`  Total subscriptions: ${subscriptions.length}`);

  console.log("\nUsers subscribed:");
  for (const u of users) {
    console.log(`  - ${u.discord_username ?? `User #${u.id}`}`);
  }

  console.log("\nRestaurants subscribed:");
  for (const r of restaurants) {
    console.log(`  - ${r.name}`);
  }
}

seedSubscriptions().catch(console.error);
