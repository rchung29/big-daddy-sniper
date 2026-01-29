/**
 * Proxy Endurance Test
 *
 * Pings the Resy Find endpoint on a fixed cadence until the proxy gets banned.
 * Tracks: successful requests, time elapsed, and ban type (429/502/500-empty)
 *
 * Run with: bun scripts/proxy-endurance-test.ts
 */
import { ResyClient, ResyAPIError } from "../src/sdk";

// Test configuration
const PING_INTERVAL_MS = 1000; // 3 seconds
const VENUE_ID = 834; // Test venue
const PARTY_SIZE = 2;

// Proxy from command line or hardcoded
const PROXY_RAW = "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy3-ip-188.213.250.217:gw46xfhfn332";

// Parse proxy: host:port:username:password -> http://username:password@host:port
function parseProxy(raw: string): string {
  const parts = raw.split(":");
  if (parts.length === 4) {
    const [host, port, username, password] = parts;
    return `http://${username}:${password}@${host}:${port}`;
  }
  // Assume it's already a URL
  return raw;
}

const proxyUrl = parseProxy(PROXY_RAW);

const testDay = "2026-02-16";

interface TestStats {
  successCount: number;
  errorCount: number;
  startTime: number;
  lastStatus: number;
  banType?: "429" | "502" | "500-waf" | "500-other" | "timeout" | "unknown";
}

const stats: TestStats = {
  successCount: 0,
  errorCount: 0,
  startTime: Date.now(),
  lastStatus: 0,
};

async function ping(client: ResyClient): Promise<boolean> {
  const pingStart = Date.now();

  try {
    const result = await client.findSlots({
      venue_id: VENUE_ID,
      day: testDay,
      party_size: PARTY_SIZE,
    });

    const latency = Date.now() - pingStart;
    stats.successCount++;
    stats.lastStatus = 200;

    const slotCount = result.results?.venues?.[0]?.slots?.length ?? 0;
    console.log(
      `[${stats.successCount}] OK (200) - ${latency}ms - ${slotCount} slots`
    );

    return true;
  } catch (error) {
    const latency = Date.now() - pingStart;
    stats.errorCount++;

    if (error instanceof ResyAPIError) {
      stats.lastStatus = error.status;
      const isWaf = error.status === 500 && (!error.rawBody || error.rawBody === "");

      console.log(`[${stats.successCount + stats.errorCount}] ERROR (${error.status}) - ${latency}ms`);
      console.log(`Full response body:`);
      console.log(error.rawBody || "(empty)");
      console.log("");

      if (error.status === 429) {
        stats.banType = "429";
        return false;
      } else if (error.status === 502) {
        stats.banType = "502";
        return false;
      } else if (isWaf) {
        stats.banType = "500-waf";
        return false;
      } else {
        stats.banType = "500-other";
        return false;
      }
    }

    // Network/timeout error
    stats.banType = "timeout";
    console.log(
      `[${stats.successCount + stats.errorCount}] ERROR - ${latency}ms - ${error}`
    );
    return false;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("PROXY ENDURANCE TEST");
  console.log("=".repeat(60));
  console.log(`Proxy: ${PROXY_RAW.split(":").slice(0, 2).join(":")}`);
  console.log(`Venue: ${VENUE_ID}`);
  console.log(`Interval: ${PING_INTERVAL_MS}ms`);
  console.log(`Date: ${testDay}`);
  console.log("=".repeat(60));
  console.log("");

  const client = new ResyClient({ proxyUrl });

  // Keep pinging until banned
  let running = true;

  // Handle Ctrl+C gracefully
  process.on("SIGINT", () => {
    running = false;
    console.log("\n\nInterrupted by user");
  });

  while (running) {
    const ok = await ping(client);

    if (!ok) {
      // Got banned - stop
      break;
    }

    // Wait for next ping
    await new Promise((resolve) => setTimeout(resolve, PING_INTERVAL_MS));
  }

  // Print summary
  const elapsed = Date.now() - stats.startTime;
  const elapsedMinutes = (elapsed / 1000 / 60).toFixed(2);

  console.log("");
  console.log("=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));
  console.log(`Successful requests: ${stats.successCount}`);
  console.log(`Failed requests: ${stats.errorCount}`);
  console.log(`Total time: ${elapsedMinutes} minutes (${elapsed}ms)`);
  console.log(`Ban type: ${stats.banType ?? "none"}`);
  console.log(`Requests per minute: ${(stats.successCount / (elapsed / 1000 / 60)).toFixed(1)}`);
  console.log("=".repeat(60));
}

main().catch(console.error);
