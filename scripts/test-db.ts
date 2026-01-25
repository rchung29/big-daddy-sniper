/**
 * Test Supabase database connection
 * Run with: bun scripts/test-db.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("Testing Supabase connection...");
console.log("URL:", url ? url.slice(0, 40) + "..." : "NOT SET");
console.log("Key:", key ? key.slice(0, 20) + "..." : "NOT SET");

if (!url || !key) {
  console.error("\nMissing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(url, key);

// Test connection by querying restaurants table
const { count, error } = await supabase
  .from("restaurants")
  .select("*", { count: "exact", head: true });

if (error) {
  console.error("\nConnection failed:", error.message);
  if (error.message.includes("does not exist") || error.code === "42P01") {
    console.log("\nTable does not exist yet. Run the migration first:");
    console.log("  1. Run: bun scripts/migrate-supabase.ts");
    console.log("  2. Copy the SQL output to Supabase SQL Editor");
    console.log("  3. Run this test again");
  }
  process.exit(1);
} else {
  console.log("\nConnection successful!");
  console.log(`Restaurants in database: ${count ?? 0}`);

  // Check other tables
  const tables = ["users", "user_subscriptions", "proxies", "booking_attempts"];
  for (const table of tables) {
    const { count: c, error: e } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    if (e) {
      console.log(`  ${table}: ERROR - ${e.message}`);
    } else {
      console.log(`  ${table}: ${c ?? 0} rows`);
    }
  }
}
