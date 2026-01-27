/**
 * Seed subscriptions for user_id=2
 *
 * DELETES ALL EXISTING SUBSCRIPTIONS first, then creates fresh ones for every active restaurant.
 * - Party size: 4
 * - Time window: 7:00 PM - 10:00 PM
 * - Target days: null (any day)
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seedSubscriptions() {
  const userIds = [1, 2];
  const partySize = 4;
  const timeWindowStart = "19:00"; // 7:00 PM
  const timeWindowEnd = "22:00";   // 10:00 PM

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

  // Step 2: Fetch active restaurants
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

  // Step 3: Create subscriptions for each user and restaurant
  const subscriptions: Array<{
    user_id: number;
    restaurant_id: number;
    party_size: number;
    time_window_start: string;
    time_window_end: string;
    target_days: null;
    enabled: boolean;
  }> = [];

  for (const userId of userIds) {
    for (const r of restaurants) {
      subscriptions.push({
        user_id: userId,
        restaurant_id: r.id,
        party_size: partySize,
        time_window_start: timeWindowStart,
        time_window_end: timeWindowEnd,
        target_days: null, // Any day of week
        enabled: true,
      });
    }
  }

  console.log(`\nCreating ${subscriptions.length} subscriptions for users ${userIds.join(", ")}...`);

  const { error: insertError } = await supabase
    .from("user_subscriptions")
    .insert(subscriptions);

  if (insertError) {
    console.error("Failed to insert subscriptions:", insertError.message);
    process.exit(1);
  }

  console.log("\nSubscriptions created successfully!");
  console.log(`  User IDs: ${userIds.join(", ")}`);
  console.log(`  Party size: ${partySize}`);
  console.log(`  Time window: ${timeWindowStart} - ${timeWindowEnd}`);
  console.log(`  Target days: Any`);
  console.log(`  Restaurants: ${restaurants.length}`);
  console.log(`  Total subscriptions: ${subscriptions.length}`);

  console.log("\nRestaurants subscribed:");
  for (const r of restaurants) {
    console.log(`  - ${r.name}`);
  }
}

seedSubscriptions().catch(console.error);
