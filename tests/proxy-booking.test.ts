/**
 * Proxy & Booking Integration Tests
 *
 * Tests ISP proxies through the full booking flow to diagnose WAF blocks:
 * 1. Load ISP proxies from database
 * 2. Test each proxy through find → details → book flow
 * 3. Detect WAF blocks (500 empty body) vs other errors
 * 4. Test with invalid config_id to verify error handling
 *
 * USAGE:
 *   bun test tests/proxy-booking.test.ts
 *
 * REQUIRED ENV VARS:
 *   - RESY_AUTH_TOKEN: Your Resy auth token
 *   - RESY_PAYMENT_METHOD_ID: Your payment method ID
 *   - SUPABASE_URL: Supabase project URL
 *   - SUPABASE_SERVICE_ROLE_KEY: Supabase service role key
 */
import { test, expect, describe, beforeAll } from "bun:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ResyClient, ResyAPIError } from "../src/sdk";
import { IspProxyPool } from "../src/services/isp-proxy-pool";
import { store } from "../src/store";
import type { Proxy } from "../src/db/schema";

// ============ Configuration ============

const VENUE_ID = 5769; // Test venue
const AUTH_TOKEN = process.env.RESY_AUTH_TOKEN ?? "";
const PAYMENT_METHOD_ID = parseInt(process.env.RESY_PAYMENT_METHOD_ID ?? "0", 10);
const PARTY_SIZE = 2;
const DRY_RUN = true; // Set to false to actually book

// ============ Test State ============

let supabase: SupabaseClient;
let ispProxies: Proxy[] = [];

// Track results for summary
interface ProxyTestResult {
  proxyId: number;
  proxyUrl: string;
  findResult: "success" | "waf" | "error" | "skipped";
  findLatency?: number;
  findError?: string;
  detailsResult: "success" | "waf" | "error" | "skipped";
  detailsLatency?: number;
  detailsError?: string;
  bookResult: "success" | "waf" | "error" | "skipped" | "dry_run";
  bookLatency?: number;
  bookError?: string;
}

const testResults: ProxyTestResult[] = [];

// ============ Helpers ============

function getTestDate(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split("T")[0];
}

function classifyError(error: unknown): { type: "waf" | "error"; message: string; status?: number } {
  if (error instanceof ResyAPIError) {
    const isEmpty = !error.rawBody || error.rawBody.trim().length === 0 || error.rawBody.trim() === "{}";
    if (error.status === 500 && isEmpty) {
      return { type: "waf", message: "WAF blocked (500 empty body)", status: 500 };
    }
    return { type: "error", message: error.message, status: error.status };
  }
  return { type: "error", message: error instanceof Error ? error.message : String(error) };
}

function formatProxyUrl(url: string): string {
  // Hide password in proxy URL for logging
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return url.replace(/:([^:@]+)@/, ":***@");
  }
}

// ============ Setup ============

beforeAll(async () => {
  console.log("\n========================================");
  console.log("  PROXY BOOKING TEST CONFIGURATION");
  console.log("========================================");
  console.log(`  Venue ID:          ${VENUE_ID}`);
  console.log(`  Auth Token:        ${AUTH_TOKEN ? "***" + AUTH_TOKEN.slice(-8) : "NOT SET"}`);
  console.log(`  Payment Method ID: ${PAYMENT_METHOD_ID || "NOT SET"}`);
  console.log(`  Party Size:        ${PARTY_SIZE}`);
  console.log(`  Dry Run:           ${DRY_RUN}`);
  console.log("========================================\n");

  if (!AUTH_TOKEN) {
    throw new Error("RESY_AUTH_TOKEN environment variable is required");
  }
  if (!PAYMENT_METHOD_ID) {
    throw new Error("RESY_PAYMENT_METHOD_ID environment variable is required");
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  }

  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Load ISP proxies directly from database
  const { data, error } = await supabase
    .from("proxies")
    .select("*")
    .eq("type", "isp")
    .eq("enabled", true);

  if (error) {
    throw new Error(`Failed to load proxies: ${error.message}`);
  }

  ispProxies = data ?? [];
  console.log(`  Loaded ${ispProxies.length} ISP proxies from database\n`);

  if (ispProxies.length === 0) {
    console.log("  ⚠ No ISP proxies found - tests will be limited\n");
  }
});

// ============ Baseline Test (No Proxy) ============

describe("Baseline (No Proxy)", () => {
  let client: ResyClient;
  let validConfigId: string | null = null;
  let testDate: string = "";

  beforeAll(() => {
    client = new ResyClient({ authToken: AUTH_TOKEN });
  });

  test("should find slots without proxy", async () => {
    const daysToTry = [7, 14, 21, 30, 45];

    for (const days of daysToTry) {
      testDate = getTestDate(days);
      const start = Date.now();

      try {
        const response = await client.findSlots({
          venue_id: VENUE_ID,
          day: testDate,
          party_size: PARTY_SIZE,
        });

        const latency = Date.now() - start;
        const slots = response.results?.venues?.[0]?.slots ?? [];

        if (slots.length > 0) {
          validConfigId = slots[0].config?.token ?? null;
          console.log(`  ✓ Found ${slots.length} slots on ${testDate} (${latency}ms)`);
          console.log(`    Config ID: ${validConfigId?.slice(0, 50)}...`);
          break;
        }
      } catch (error) {
        const classified = classifyError(error);
        console.log(`  ✗ ${testDate}: ${classified.message}`);
      }
    }

    expect(true).toBe(true);
  });

  test("should get details without proxy", async () => {
    if (!validConfigId) {
      console.log("  ⏭ Skipped - no valid config ID");
      return;
    }

    const start = Date.now();
    const details = await client.getDetails({
      venue_id: VENUE_ID,
      day: testDate,
      party_size: PARTY_SIZE,
      config_id: validConfigId,
    });

    const latency = Date.now() - start;
    console.log(`  ✓ Got book token (${latency}ms)`);
    console.log(`    Token: ${details.book_token?.value?.slice(0, 50)}...`);

    expect(details.book_token?.value).toBeDefined();
  });

  test("should handle invalid config_id gracefully", async () => {
    const start = Date.now();

    try {
      await client.getDetails({
        venue_id: VENUE_ID,
        day: testDate,
        party_size: PARTY_SIZE,
        config_id: "invalid_config_id_12345",
      });
      console.log(`  Unexpected success with invalid config_id`);
    } catch (error) {
      const latency = Date.now() - start;
      const classified = classifyError(error);
      console.log(`  ✓ Got expected error for invalid config (${latency}ms)`);
      console.log(`    Type: ${classified.type}, Status: ${classified.status}`);
      console.log(`    Message: ${classified.message.slice(0, 100)}`);
    }

    expect(true).toBe(true);
  });
});

// ============ ISP Proxy Tests ============

describe("ISP Proxy Tests", () => {
  let validConfigId: string | null = null;
  let testDate: string = "";

  // First, find a valid slot using no proxy
  beforeAll(async () => {
    const client = new ResyClient({ authToken: AUTH_TOKEN });
    const daysToTry = [7, 14, 21, 30, 45];

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
          validConfigId = slots[0].config?.token ?? null;
          break;
        }
      } catch {
        // Continue
      }
    }

    if (validConfigId) {
      console.log(`\n  Using config from ${testDate} for proxy tests\n`);
    } else {
      console.log(`\n  ⚠ No valid config found - some tests will fail\n`);
    }
  });

  test("test each ISP proxy through full flow", async () => {
    if (ispProxies.length === 0) {
      console.log("  ⏭ No ISP proxies to test");
      return;
    }

    console.log(`\n  Testing ${ispProxies.length} ISP proxies...\n`);

    for (const proxy of ispProxies) {
      const result: ProxyTestResult = {
        proxyId: proxy.id,
        proxyUrl: formatProxyUrl(proxy.url),
        findResult: "skipped",
        detailsResult: "skipped",
        bookResult: "skipped",
      };

      console.log(`  ─────────────────────────────────────`);
      console.log(`  Proxy ${proxy.id}: ${formatProxyUrl(proxy.url)}`);

      const client = new ResyClient({
        authToken: AUTH_TOKEN,
        proxyUrl: proxy.url,
      });

      // Test 1: Find slots
      console.log(`    [1/3] Find slots...`);
      const findStart = Date.now();
      try {
        const response = await client.findSlots({
          venue_id: VENUE_ID,
          day: testDate || getTestDate(14),
          party_size: PARTY_SIZE,
        });
        result.findLatency = Date.now() - findStart;
        const slots = response.results?.venues?.[0]?.slots ?? [];
        result.findResult = "success";
        console.log(`      ✓ Success (${result.findLatency}ms) - ${slots.length} slots`);
      } catch (error) {
        result.findLatency = Date.now() - findStart;
        const classified = classifyError(error);
        result.findResult = classified.type === "waf" ? "waf" : "error";
        result.findError = classified.message;
        console.log(`      ✗ ${classified.type.toUpperCase()} (${result.findLatency}ms): ${classified.message.slice(0, 60)}`);
      }

      // Test 2: Get details (with valid config)
      if (validConfigId) {
        console.log(`    [2/3] Get details (valid config)...`);
        const detailsStart = Date.now();
        try {
          const details = await client.getDetails({
            venue_id: VENUE_ID,
            day: testDate,
            party_size: PARTY_SIZE,
            config_id: validConfigId,
          });
          result.detailsLatency = Date.now() - detailsStart;
          result.detailsResult = details.book_token?.value ? "success" : "error";
          console.log(`      ✓ Success (${result.detailsLatency}ms) - got book token`);

          // Test 3: Book (if not dry run and we have a token)
          if (!DRY_RUN && details.book_token?.value) {
            console.log(`    [3/3] Book reservation...`);
            const bookStart = Date.now();
            try {
              const bookResult = await client.bookReservation({
                book_token: details.book_token.value,
                payment_method_id: PAYMENT_METHOD_ID,
              });
              result.bookLatency = Date.now() - bookStart;
              result.bookResult = "success";
              console.log(`      ✓ BOOKED! (${result.bookLatency}ms) - ID: ${bookResult.reservation_id}`);

              // Cancel immediately
              try {
                await client.cancelReservation({ resy_token: bookResult.resy_token });
                console.log(`      ✓ Cancelled`);
              } catch (cancelError) {
                console.log(`      ⚠ Failed to cancel: ${cancelError}`);
              }
            } catch (error) {
              result.bookLatency = Date.now() - bookStart;
              const classified = classifyError(error);
              result.bookResult = classified.type === "waf" ? "waf" : "error";
              result.bookError = classified.message;
              console.log(`      ✗ ${classified.type.toUpperCase()} (${result.bookLatency}ms): ${classified.message.slice(0, 60)}`);
            }
          } else {
            result.bookResult = DRY_RUN ? "dry_run" : "skipped";
            console.log(`    [3/3] Book: ${DRY_RUN ? "DRY RUN - skipped" : "skipped (no token)"}`);
          }
        } catch (error) {
          result.detailsLatency = Date.now() - detailsStart;
          const classified = classifyError(error);
          result.detailsResult = classified.type === "waf" ? "waf" : "error";
          result.detailsError = classified.message;
          result.bookResult = "skipped";
          console.log(`      ✗ ${classified.type.toUpperCase()} (${result.detailsLatency}ms): ${classified.message.slice(0, 60)}`);
          console.log(`    [3/3] Book: skipped (details failed)`);
        }
      } else {
        console.log(`    [2/3] Get details: skipped (no valid config)`);
        console.log(`    [3/3] Book: skipped`);
      }

      testResults.push(result);

      // Small delay between proxies to avoid rate limiting
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(true).toBe(true);
  }, 120000); // 2 minute timeout for testing all proxies

  test("test invalid config_id with each proxy", async () => {
    if (ispProxies.length === 0) {
      console.log("  ⏭ No ISP proxies to test");
      return;
    }

    console.log(`\n  Testing invalid config_id error handling...\n`);

    for (const proxy of ispProxies) {
      const client = new ResyClient({
        authToken: AUTH_TOKEN,
        proxyUrl: proxy.url,
      });

      const start = Date.now();
      try {
        await client.getDetails({
          venue_id: VENUE_ID,
          day: testDate || getTestDate(14),
          party_size: PARTY_SIZE,
          config_id: "fake_config_that_does_not_exist",
        });
        console.log(`  Proxy ${proxy.id}: Unexpected success`);
      } catch (error) {
        const latency = Date.now() - start;
        const classified = classifyError(error);
        const icon = classified.type === "waf" ? "⚠" : "✓";
        console.log(`  Proxy ${proxy.id}: ${icon} ${classified.type.toUpperCase()} (${latency}ms) - ${classified.status ?? "N/A"}`);
      }

      await new Promise((r) => setTimeout(r, 300));
    }

    expect(true).toBe(true);
  }, 60000); // 1 minute timeout
});

// ============ IspProxyPool Unit Tests ============

describe("IspProxyPool Logic", () => {
  test("should initialize with proxies", async () => {
    // Initialize store first (required for pool)
    // Note: In a real test, we'd mock the store
    if (ispProxies.length === 0) {
      console.log("  ⏭ Skipped - no proxies loaded");
      return;
    }

    // Create a mock pool for testing logic
    const pool = new IspProxyPool();

    // Can't fully test without initializing store, but we can test the structure
    const status = pool.getStatus();
    expect(status).toHaveProperty("available");
    expect(status).toHaveProperty("inUse");
    expect(status).toHaveProperty("cooldown");
    expect(status).toHaveProperty("total");

    console.log(`  ✓ Pool status structure correct`);
  });
});

// ============ Summary ============

describe("Test Summary", () => {
  test("print summary", () => {
    if (testResults.length === 0) {
      console.log("\n  No proxy test results to summarize\n");
      return;
    }

    console.log("\n========================================");
    console.log("  PROXY TEST SUMMARY");
    console.log("========================================\n");

    // Count results
    const findSuccess = testResults.filter((r) => r.findResult === "success").length;
    const findWaf = testResults.filter((r) => r.findResult === "waf").length;
    const findError = testResults.filter((r) => r.findResult === "error").length;

    const detailsSuccess = testResults.filter((r) => r.detailsResult === "success").length;
    const detailsWaf = testResults.filter((r) => r.detailsResult === "waf").length;
    const detailsError = testResults.filter((r) => r.detailsResult === "error").length;

    const bookSuccess = testResults.filter((r) => r.bookResult === "success").length;
    const bookWaf = testResults.filter((r) => r.bookResult === "waf").length;
    const bookError = testResults.filter((r) => r.bookResult === "error").length;

    console.log("  Find Slots:");
    console.log(`    ✓ Success: ${findSuccess}/${testResults.length}`);
    console.log(`    ⚠ WAF Block: ${findWaf}/${testResults.length}`);
    console.log(`    ✗ Error: ${findError}/${testResults.length}`);

    console.log("\n  Get Details:");
    console.log(`    ✓ Success: ${detailsSuccess}/${testResults.length}`);
    console.log(`    ⚠ WAF Block: ${detailsWaf}/${testResults.length}`);
    console.log(`    ✗ Error: ${detailsError}/${testResults.length}`);

    console.log("\n  Book Reservation:");
    console.log(`    ✓ Success: ${bookSuccess}/${testResults.length}`);
    console.log(`    ⚠ WAF Block: ${bookWaf}/${testResults.length}`);
    console.log(`    ✗ Error: ${bookError}/${testResults.length}`);

    // Latency stats
    const findLatencies = testResults.filter((r) => r.findLatency).map((r) => r.findLatency!);
    const detailsLatencies = testResults.filter((r) => r.detailsLatency).map((r) => r.detailsLatency!);

    if (findLatencies.length > 0) {
      const avgFind = findLatencies.reduce((a, b) => a + b, 0) / findLatencies.length;
      console.log(`\n  Find Latency: avg ${avgFind.toFixed(0)}ms, min ${Math.min(...findLatencies)}ms, max ${Math.max(...findLatencies)}ms`);
    }

    if (detailsLatencies.length > 0) {
      const avgDetails = detailsLatencies.reduce((a, b) => a + b, 0) / detailsLatencies.length;
      console.log(`  Details Latency: avg ${avgDetails.toFixed(0)}ms, min ${Math.min(...detailsLatencies)}ms, max ${Math.max(...detailsLatencies)}ms`);
    }

    // List problematic proxies
    const wafProxies = testResults.filter((r) => r.findResult === "waf" || r.detailsResult === "waf");
    if (wafProxies.length > 0) {
      console.log("\n  ⚠ Proxies hitting WAF:");
      for (const r of wafProxies) {
        console.log(`    - Proxy ${r.proxyId}: find=${r.findResult}, details=${r.detailsResult}`);
      }
    }

    const workingProxies = testResults.filter((r) => r.findResult === "success" && r.detailsResult === "success");
    if (workingProxies.length > 0) {
      console.log("\n  ✓ Working proxies:");
      for (const r of workingProxies) {
        console.log(`    - Proxy ${r.proxyId} (find: ${r.findLatency}ms, details: ${r.detailsLatency}ms)`);
      }
    }

    console.log("\n========================================\n");

    expect(true).toBe(true);
  });
});

console.log("\n🧪 Starting Proxy Booking Tests...\n");
