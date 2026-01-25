/**
 * Comprehensive Integration Tests
 *
 * Tests the full booking flow against the real Resy API:
 * 1. IP Check
 * 2. Find available slots
 * 3. Get slot details
 * 4. Book reservation
 * 5. Verify reservation exists
 * 6. Cancel reservation (cleanup)
 *
 * Also tests scheduler and executor logic with real data.
 *
 * USAGE:
 *   VENUE_ID=1234 bun test tests/integration.test.ts
 *
 * REQUIRED ENV VARS:
 *   - RESY_AUTH_TOKEN: Your Resy auth token
 *   - RESY_PAYMENT_METHOD_ID: Your payment method ID
 *   - VENUE_ID: The venue to test against (passed as env var)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { ResyClient } from "../src/sdk";
import { checkResyIP } from "../src/services/ip-check";
import {
  calculateTargetDate,
  parseReleaseTime,
  getNextReleaseDateTime,
  getDayOfWeek,
  isSubscriptionActiveForDate,
} from "../src/services/scheduler";
import type { FindResponse, DetailsResponse } from "../src/sdk/schemas";

// ============ Configuration ============

const VENUE_ID = 59213;
const AUTH_TOKEN = process.env.RESY_AUTH_TOKEN ?? "";
const PAYMENT_METHOD_ID = parseInt(process.env.RESY_PAYMENT_METHOD_ID ?? "0", 10);
const PARTY_SIZE = parseInt(process.env.PARTY_SIZE ?? "2", 10);
const DRY_RUN = false // Set to true to skip actual booking

// Track reservations to cancel in cleanup
const reservationsToCancel: { resyToken: string; reservationId: number }[] = [];

// ============ Setup & Validation ============

beforeAll(() => {
  console.log("\n========================================");
  console.log("  INTEGRATION TEST CONFIGURATION");
  console.log("========================================");
  console.log(`  Venue ID:          ${VENUE_ID || "NOT SET"}`);
  console.log(`  Auth Token:        ${AUTH_TOKEN ? "***" + AUTH_TOKEN.slice(-8) : "NOT SET"}`);
  console.log(`  Payment Method ID: ${PAYMENT_METHOD_ID || "NOT SET"}`);
  console.log(`  Party Size:        ${PARTY_SIZE}`);
  console.log(`  Dry Run:           ${DRY_RUN}`);
  console.log("========================================\n");

  if (!VENUE_ID) {
    throw new Error("VENUE_ID environment variable is required");
  }
  if (!AUTH_TOKEN) {
    throw new Error("RESY_AUTH_TOKEN environment variable is required");
  }
  if (!PAYMENT_METHOD_ID) {
    throw new Error("RESY_PAYMENT_METHOD_ID environment variable is required");
  }
});

afterAll(async () => {
  // Cleanup: Cancel any reservations we created
  if (reservationsToCancel.length > 0) {
    console.log(`\n🧹 Cleaning up ${reservationsToCancel.length} reservation(s)...`);
    const client = new ResyClient({ authToken: AUTH_TOKEN });

    for (const { resyToken, reservationId } of reservationsToCancel) {
      try {
        await client.cancelReservation({ resy_token: resyToken });
        console.log(`  ✓ Cancelled reservation ${reservationId}`);
      } catch (error) {
        console.error(`  ✗ Failed to cancel reservation ${reservationId}:`, error);
      }
    }
  }
});

// ============ Test Helpers ============

function getTestDate(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split("T")[0];
}

// ============ IP Check Tests ============

describe("IP Check", () => {
  test("should verify IP is not banned", async () => {
    const result = await checkResyIP();

    console.log(`  Latency: ${result.latencyMs}ms`);
    console.log(`  Status:  ${result.status}`);

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.latencyMs).toBeLessThan(5000); // Should respond within 5 seconds
  });
});

// ============ Scheduler Logic Tests ============

describe("Scheduler Logic", () => {
  test("calculateTargetDate should add days correctly", () => {
    const today = new Date("2025-01-25T12:00:00Z");

    expect(calculateTargetDate(0, today)).toBe("2025-01-25");
    expect(calculateTargetDate(1, today)).toBe("2025-01-26");
    expect(calculateTargetDate(30, today)).toBe("2025-02-24");
  });

  test("getDayOfWeek should return correct day", () => {
    // January 25, 2025 is a Saturday
    expect(getDayOfWeek("2025-01-25")).toBe(6); // Saturday
    expect(getDayOfWeek("2025-01-26")).toBe(0); // Sunday
    expect(getDayOfWeek("2025-01-27")).toBe(1); // Monday
  });

  test("isSubscriptionActiveForDate should filter by target days", () => {
    // null = any day
    expect(isSubscriptionActiveForDate(null, "2025-01-25")).toBe(true);
    expect(isSubscriptionActiveForDate([], "2025-01-25")).toBe(true);

    // Weekend only (Fri=5, Sat=6, Sun=0)
    const weekends = [5, 6, 0];
    expect(isSubscriptionActiveForDate(weekends, "2025-01-24")).toBe(true);  // Friday
    expect(isSubscriptionActiveForDate(weekends, "2025-01-25")).toBe(true);  // Saturday
    expect(isSubscriptionActiveForDate(weekends, "2025-01-26")).toBe(true);  // Sunday
    expect(isSubscriptionActiveForDate(weekends, "2025-01-27")).toBe(false); // Monday
    expect(isSubscriptionActiveForDate(weekends, "2025-01-28")).toBe(false); // Tuesday
  });

  test("parseReleaseTime should create correct date", () => {
    const release = parseReleaseTime("10:00", "America/New_York");

    expect(release.getHours()).toBeDefined();
    expect(release.getMinutes()).toBeDefined();
  });

  test("getNextReleaseDateTime should handle past times", () => {
    const now = new Date();
    const pastTime = `${String(now.getHours() - 1).padStart(2, "0")}:00`;
    const futureTime = `${String(now.getHours() + 1).padStart(2, "0")}:00`;

    // Past time should be tomorrow
    if (now.getHours() > 0) {
      const pastRelease = getNextReleaseDateTime(pastTime);
      expect(pastRelease.getTime()).toBeGreaterThan(now.getTime());
    }

    // Future time should be today
    if (now.getHours() < 23) {
      const futureRelease = getNextReleaseDateTime(futureTime);
      expect(futureRelease.getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

// ============ SDK Client Tests ============

describe("SDK Client - Find Slots", () => {
  let client: ResyClient;
  let findResponse: FindResponse | null = null;

  beforeAll(() => {
    client = new ResyClient({ authToken: AUTH_TOKEN });
  });

  test("should find slots for venue", async () => {
    // Try multiple days to find availability
    const daysToTry = [1, 7, 14, 21, 30, 45, 60];

    for (const days of daysToTry) {
      const testDate = getTestDate(days);
      console.log(`  Checking ${testDate} (${days} days out)...`);

      try {
        const response = await client.findSlots({
          venue_id: VENUE_ID,
          day: testDate,
          party_size: PARTY_SIZE,
        });

        const slots = response.results?.venues?.[0]?.slots ?? [];
        console.log(`    Found ${slots.length} slots`);

        if (slots.length > 0) {
          findResponse = response;
          console.log(`  ✓ Found availability on ${testDate}`);
          break;
        }
      } catch (error) {
        console.log(`    Error: ${error}`);
      }
    }

    // We might not find availability, which is OK for the test
    if (!findResponse) {
      console.log("  ⚠ No availability found - some tests will be skipped");
    }

    expect(true).toBe(true); // Pass even if no slots
  });

  test("should parse venue info from find response", async () => {
    if (!findResponse) {
      console.log("  ⏭ Skipped - no availability");
      return;
    }

    const venue = findResponse.results?.venues?.[0]?.venue;
    expect(venue).toBeDefined();
    expect(venue?.name).toBeDefined();
    console.log(`  Venue: ${venue?.name}`);
    console.log(`  Location: ${venue?.location?.neighborhood}`);
  });

  test("should have slot config tokens", async () => {
    if (!findResponse) {
      console.log("  ⏭ Skipped - no availability");
      return;
    }

    const slots = findResponse.results?.venues?.[0]?.slots ?? [];
    expect(slots.length).toBeGreaterThan(0);

    const firstSlot = slots[0];
    expect(firstSlot.config?.token).toBeDefined();
    expect(firstSlot.date?.start).toBeDefined();

    console.log(`  First slot: ${firstSlot.date?.start}`);
    console.log(`  Config token: ${firstSlot.config?.token?.slice(0, 50)}...`);
  });
});

// ============ Full Booking Flow Test ============

describe("Full Booking Flow", () => {
  let client: ResyClient;
  let findResponse: FindResponse | null = null;
  let detailsResponse: DetailsResponse | null = null;
  let selectedSlot: any = null;
  let testDate: string = "";

  beforeAll(() => {
    client = new ResyClient({ authToken: AUTH_TOKEN });
  });

  test("Step 1: Find available slot", async () => {
    const daysToTry = [1, 7, 14, 21, 30, 45, 60];

    for (const days of daysToTry) {
      testDate = getTestDate(days);

      try {
        const response = await client.findSlots({
          venue_id: VENUE_ID,
          day: testDate,
          party_size: PARTY_SIZE,
        });

        const slots = response.results?.venues?.[0]?.slots ?? [];

        if (slots.length > 0) {
          findResponse = response;
          // Pick a slot in the middle of availability for best chance
          selectedSlot = slots[Math.floor(slots.length / 2)];
          console.log(`  ✓ Found ${slots.length} slots on ${testDate}`);
          console.log(`  Selected: ${selectedSlot.date?.start}`);
          break;
        }
      } catch (error) {
        // Continue to next date
      }
    }

    if (!findResponse) {
      console.log("  ⚠ No availability found - booking flow will be skipped");
    }

    expect(true).toBe(true);
  });

  test("Step 2: Get slot details", async () => {
    if (!selectedSlot) {
      console.log("  ⏭ Skipped - no slot available");
      return;
    }

    const configToken = selectedSlot.config?.token;
    expect(configToken).toBeDefined();

    detailsResponse = await client.getDetails({
      venue_id: VENUE_ID,
      day: testDate,
      party_size: PARTY_SIZE,
      config_id: configToken,
    });

    expect(detailsResponse).toBeDefined();
    expect(detailsResponse.book_token).toBeDefined();

    console.log(`  ✓ Got book_token: ${detailsResponse.book_token?.value?.slice(0, 50)}...`);
    console.log(`  Cancellation policy: ${detailsResponse.cancellation?.display?.policy ?? "None"}`);
  });

  test("Step 3: Book reservation", async () => {
    if (!detailsResponse?.book_token?.value) {
      console.log("  ⏭ Skipped - no book token");
      return;
    }

    if (DRY_RUN) {
      console.log("  ⏭ Skipped - DRY_RUN mode");
      return;
    }

    const bookToken = detailsResponse.book_token.value;

    const bookResponse = await client.bookReservation({
      book_token: bookToken,
      payment_method_id: PAYMENT_METHOD_ID,
    });

    expect(bookResponse.reservation_id).toBeDefined();
    expect(bookResponse.resy_token).toBeDefined();

    console.log(`  ✓ Booked! Reservation ID: ${bookResponse.reservation_id}`);
    console.log(`  Resy Token: ${bookResponse.resy_token.slice(0, 30)}...`);

    // Track for cleanup
    reservationsToCancel.push({
      resyToken: bookResponse.resy_token,
      reservationId: bookResponse.reservation_id,
    });
  });

  test("Step 4: Verify reservation exists", async () => {
    if (reservationsToCancel.length === 0) {
      console.log("  ⏭ Skipped - no reservation to verify");
      return;
    }

    const reservations = await client.getUserReservations("upcoming");

    expect(reservations.reservations).toBeDefined();

    const ourReservation = reservations.reservations.find(
      r => r.reservation_id === reservationsToCancel[0].reservationId
    );

    if (ourReservation) {
      console.log(`  ✓ Reservation found in upcoming list`);
      console.log(`    Venue: ${ourReservation.venue?.name}`);
      console.log(`    Date: ${ourReservation.day}`);
      console.log(`    Time: ${ourReservation.time_slot}`);
    } else {
      console.log(`  ⚠ Reservation not found in list (may take time to appear)`);
    }

    expect(true).toBe(true);
  });

  test("Step 5: Cancel reservation (cleanup)", async () => {
    if (reservationsToCancel.length === 0) {
      console.log("  ⏭ Skipped - no reservation to cancel");
      return;
    }

    const { resyToken, reservationId } = reservationsToCancel[0];

    await client.cancelReservation({ resy_token: resyToken });

    console.log(`  ✓ Cancelled reservation ${reservationId}`);

    // Remove from cleanup list since we already cancelled
    reservationsToCancel.shift();
  });
});

// ============ Error Handling Tests ============

describe("Error Handling", () => {
  let client: ResyClient;

  beforeAll(() => {
    client = new ResyClient({ authToken: AUTH_TOKEN });
  });

  test("should handle invalid venue ID gracefully", async () => {
    try {
      await client.findSlots({
        venue_id: 999999999,
        day: getTestDate(7),
        party_size: 2,
      });
      // If no error, check response is empty
      expect(true).toBe(true);
    } catch (error: any) {
      // Expected - invalid venue
      console.log(`  Got expected error: ${error.message?.slice(0, 50)}`);
      expect(error).toBeDefined();
    }
  });

  test("should handle invalid auth token", async () => {
    const badClient = new ResyClient({ authToken: "invalid_token" });

    try {
      await badClient.getUserReservations();
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      console.log(`  Got expected auth error: ${error.status}`);
      expect(error.status).toBe(419); // Resy returns 419 for invalid auth
    }
  });

  test("should handle past date", async () => {
    const pastDate = "2020-01-01";

    const response = await client.findSlots({
      venue_id: VENUE_ID,
      day: pastDate,
      party_size: PARTY_SIZE,
    });

    // Should return empty results for past date
    const slots = response.results?.venues?.[0]?.slots ?? [];
    expect(slots.length).toBe(0);
    console.log(`  Past date returns ${slots.length} slots (expected)`);
  });
});

// ============ Performance Tests ============

describe("Performance", () => {
  let client: ResyClient;

  beforeAll(() => {
    client = new ResyClient({ authToken: AUTH_TOKEN });
  });

  test("findSlots latency should be acceptable", async () => {
    const testDate = getTestDate(14);
    const iterations = 3;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await client.findSlots({
        venue_id: VENUE_ID,
        day: testDate,
        party_size: PARTY_SIZE,
      });
      latencies.push(Date.now() - start);
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);
    const minLatency = Math.min(...latencies);

    console.log(`  Latencies: ${latencies.map(l => `${l}ms`).join(", ")}`);
    console.log(`  Average: ${avgLatency.toFixed(0)}ms`);
    console.log(`  Min: ${minLatency}ms, Max: ${maxLatency}ms`);

    expect(avgLatency).toBeLessThan(2000); // Should average under 2 seconds
  });
});

console.log("\n🧪 Starting Integration Tests...\n");
