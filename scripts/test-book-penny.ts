/**
 * Test booking at Penny (venue_id=79460) with ISP proxy
 *
 * Run with: bun scripts/test-book-penny.ts
 */
import { createClient } from "@supabase/supabase-js";
import { ResyClient, ResyAPIError } from "../src/sdk";

const VENUE_ID = 79460; // Penny
const AUTH_TOKEN = process.env.RESY_AUTH_TOKEN!;
const PAYMENT_METHOD_ID = parseInt(process.env.RESY_PAYMENT_METHOD_ID!, 10);
const PARTY_SIZE = 2;

async function main() {
  console.log("=".repeat(60));
  console.log("TEST BOOKING AT PENNY (venue_id=79460) WITH ISP PROXY");
  console.log("=".repeat(60));

  // Load ISP proxy from database
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: proxies } = await supabase
    .from("proxies")
    .select("*")
    .eq("type", "isp")
    .eq("enabled", true)
    .limit(1);

  if (!proxies || proxies.length === 0) {
    console.error("No ISP proxies found");
    process.exit(1);
  }

  const proxy = proxies[0];
  const proxyDisplay = proxy.url.replace(/:([^:@]+)@/, ":***@");
  console.log(`\nUsing proxy: ${proxyDisplay}\n`);

  const client = new ResyClient({
    authToken: AUTH_TOKEN,
    proxyUrl: proxy.url,
  });

  // Find available dates
  const daysToTry = [7, 14, 21, 30, 45];
  let testDate = "";
  let slots: any[] = [];

  console.log("STEP 1: Finding available slots at Penny...\n");

  for (const days of daysToTry) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    testDate = date.toISOString().split("T")[0];

    console.log(`  Checking ${testDate}...`);

    try {
      const response = await client.findSlots({
        venue_id: VENUE_ID,
        day: testDate,
        party_size: PARTY_SIZE,
      });

      slots = response.results?.venues?.[0]?.slots ?? [];
      console.log(`    Found ${slots.length} slots`);

      if (slots.length > 0) {
        console.log(`\n  ✓ Found availability on ${testDate}`);
        break;
      }
    } catch (error) {
      console.log(`    Error: ${error}`);
    }
  }

  if (slots.length === 0) {
    console.log("\n  ✗ No availability found");
    process.exit(0);
  }

  // Pick first slot
  const slot = slots[0];
  const configId = slot.config?.token;
  const slotTime = slot.date?.start;

  console.log(`\n  Selected slot:`);
  console.log(`    Time: ${slotTime}`);
  console.log(`    Config ID: ${configId?.slice(0, 60)}...`);

  // Get details
  console.log("\nSTEP 2: Getting details and book_token...\n");

  let bookToken: string | undefined;
  try {
    const details = await client.getDetails({
      venue_id: VENUE_ID,
      day: testDate,
      party_size: PARTY_SIZE,
      config_id: configId,
    });

    bookToken = details.book_token?.value;
    console.log(`  ✓ Got book_token: ${bookToken?.slice(0, 60)}...`);
    console.log(`\n  Full details response:`);
    console.log(JSON.stringify(details, null, 2).slice(0, 2000));
  } catch (error) {
    console.log(`  ✗ Failed to get details: ${error}`);
    if (error instanceof ResyAPIError) {
      console.log(`    Status: ${error.status}`);
      console.log(`    Raw body: ${error.rawBody}`);
    }
    process.exit(1);
  }

  if (!bookToken) {
    console.log("  ✗ No book_token received");
    process.exit(1);
  }

  // Book it!
  console.log("\nSTEP 3: BOOKING THE RESERVATION...\n");
  console.log(`  venue_id: ${VENUE_ID}`);
  console.log(`  date: ${testDate}`);
  console.log(`  payment_method_id: ${PAYMENT_METHOD_ID}`);

  try {
    const response = await client.bookReservation({
      book_token: bookToken,
      payment_method_id: PAYMENT_METHOD_ID,
    });

    console.log(`\n  ✓ BOOKING RESPONSE:`);
    console.log(JSON.stringify(response, null, 2));

    // Check if the venue matches
    if ((response as any).venue?.id !== VENUE_ID) {
      console.log(`\n  ⚠ WARNING: Response venue ID (${(response as any).venue?.id}) doesn't match requested venue (${VENUE_ID})!`);
    }

    // Cancel it
    console.log("\nSTEP 4: Cancelling reservation...\n");
    try {
      await client.cancelReservation({ resy_token: response.resy_token });
      console.log("  ✓ Cancelled");
    } catch (cancelError) {
      console.log(`  ✗ Failed to cancel: ${cancelError}`);
    }
  } catch (error) {
    console.log(`  ✗ BOOKING FAILED`);
    if (error instanceof ResyAPIError) {
      console.log(`    Status: ${error.status}`);
      console.log(`    Code: ${error.code}`);
      console.log(`    Raw body: ${error.rawBody}`);
    } else {
      console.log(`    Error: ${error}`);
    }
  }

  console.log("\n" + "=".repeat(60));
}

main().catch(console.error);
