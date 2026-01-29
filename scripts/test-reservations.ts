/**
 * Test User Reservations Endpoint
 *
 * Fetches upcoming reservations for a user to verify the API response structure.
 *
 * Run with: bun scripts/test-reservations.ts <auth_token>
 */
import { ResyClient } from "../src/sdk";

async function main() {
  const authToken = process.argv[2];

  if (!authToken) {
    console.error("Usage: bun scripts/test-reservations.ts <auth_token>");
    console.error("\nYou can get your auth token from:");
    console.error("  - Your database: SELECT resy_auth_token FROM users WHERE id = <your_id>");
    console.error("  - Browser dev tools: Look for X-Resy-Auth-Token header");
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("USER RESERVATIONS TEST");
  console.log("=".repeat(60));
  console.log(`Token: ${authToken.slice(0, 20)}...`);
  console.log("");

  const client = new ResyClient({ authToken });

  try {
    console.log("Fetching upcoming reservations...\n");
    const response = await client.getUserReservations("upcoming");

    console.log("=".repeat(60));
    console.log("RESPONSE");
    console.log("=".repeat(60));

    if (response.reservations.length === 0) {
      console.log("No upcoming reservations found.");
    } else {
      console.log(`Found ${response.reservations.length} reservation(s):\n`);

      for (const res of response.reservations) {
        const venueName = response.venues?.[String(res.venue.id)]?.name ?? res.venue.name ?? "Unknown";
        console.log(`  Restaurant: ${venueName}`);
        console.log(`  Venue ID: ${res.venue.id}`);
        console.log(`  Date: ${res.day}`);
        console.log(`  Time: ${res.time_slot}`);
        console.log(`  Party Size: ${res.num_seats}`);
        console.log(`  Resy Token: ${res.resy_token}`);
        if (res.cancellation?.date_refund_cut_off) {
          console.log(`  Cancellation Cutoff: ${res.cancellation.date_refund_cut_off}`);
        }
        console.log("");
      }
    }

    console.log("=".repeat(60));
    console.log("RAW RESPONSE");
    console.log("=".repeat(60));
    console.log(JSON.stringify(response, null, 2));

  } catch (error) {
    console.error("Error fetching reservations:", error);
    process.exit(1);
  }
}

main();
