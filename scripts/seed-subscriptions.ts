/**
 * Seed subscriptions for user_id=1
 * Creates a subscription for every active restaurant
 * - Party size: 4
 * - Time window: 7:00 PM - 10:00 PM EST
 * - Target days: Friday, Saturday, Sunday
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
  const userId = 2;
  const partySize = 4;
  const timeWindowStart = "19:00"; // 7:00 PM
  const timeWindowEnd = "22:00";   // 10:00 PM
  const targetDays = [5, 6, 0];    // Friday, Saturday, Sunday

  console.log("Fetching active restaurants...");

  // Get all active restaurants
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

  // Create subscriptions for each restaurant
  const subscriptions = restaurants.map((r) => ({
    user_id: userId,
    restaurant_id: r.id,
    party_size: partySize,
    time_window_start: timeWindowStart,
    time_window_end: timeWindowEnd,
    target_days: targetDays,
    enabled: true,
  }));

  console.log(`Creating ${subscriptions.length} subscriptions for user_id=${userId}...`);

  // Upsert to handle existing subscriptions
  const { error: insertError } = await supabase
    .from("user_subscriptions")
    .upsert(subscriptions, {
      onConflict: "user_id,restaurant_id,party_size",
      ignoreDuplicates: false,
    });

  if (insertError) {
    console.error("Failed to insert subscriptions:", insertError.message);
    process.exit(1);
  }

  console.log("\nSubscriptions created successfully!");
  console.log(`  User ID: ${userId}`);
  console.log(`  Party size: ${partySize}`);
  console.log(`  Time window: ${timeWindowStart} - ${timeWindowEnd} EST`);
  console.log(`  Target days: Fri, Sat, Sun`);
  console.log(`  Restaurants: ${restaurants.length}`);

  // List all subscriptions
  console.log("\nRestaurants subscribed:");
  for (const r of restaurants) {
    console.log(`  - ${r.name}`);
  }
}

seedSubscriptions().catch(console.error);
