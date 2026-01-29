/**
 * Test all proxies against Resy API (in parallel)
 *
 * Makes a legitimate find request using the SDK client.
 * Expected: 200 = WORKING, error = BLOCKED by WAF
 *
 * Usage:
 *   bun scripts/test-proxies.ts                    # Test Default venue
 *   bun scripts/test-proxies.ts "i Sodi"           # Test i Sodi only
 *   bun scripts/test-proxies.ts "i Sodi,Thai Diner" # Test multiple venues
 *
 * Available venues: i Sodi, Thai Diner, Carbone, Default
 */
import { createClient } from "@supabase/supabase-js";
import { ResyClient, ResyAPIError } from "../src/sdk";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Venue IDs - competitive venues for testing
const VENUES: Record<string, number> = {
  "i Sodi": 443,
  "Thai Diner": 57905,
  "Carbone": 6194,
  "Default": 1263,
};

// Parse venue argument
const venueArg = process.argv[2];
const selectedVenues = venueArg
  ? venueArg.split(",").map((v) => v.trim())
  : ["Default"];

// Validate venues
for (const v of selectedVenues) {
  if (!VENUES[v]) {
    console.error(`Unknown venue: ${v}`);
    console.error(`Available: ${Object.keys(VENUES).join(", ")}`);
    process.exit(1);
  }
}

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const day = tomorrow.toISOString().split("T")[0];

async function testProxy(proxyId: number, proxyUrl: string, venueId: number = VENUES["Default"]): Promise<{
  id: number;
  ip: string;
  status: number;
  latencyMs: number;
  blocked: boolean;
  body: string;
  error?: string;
}> {
  const start = Date.now();

  // Extract IP for display
  const ipMatch = proxyUrl.match(/ip-([0-9.]+)/);
  const ip = ipMatch ? ipMatch[1] : "unknown";

  try {
    const client = new ResyClient({ proxyUrl });
    const result = await client.findSlots({
      venue_id: venueId,
      day,
      party_size: 2,
    });

    const latencyMs = Date.now() - start;
    const body = JSON.stringify(result).substring(0, 500);

    return {
      id: proxyId,
      ip,
      status: 200,
      latencyMs,
      blocked: false,
      body,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;

    if (error instanceof ResyAPIError) {
      // 500 with empty body = WAF blocked
      const blocked = error.status === 500 && (!error.rawBody || error.rawBody === "");
      return {
        id: proxyId,
        ip,
        status: error.status,
        latencyMs,
        blocked,
        body: error.rawBody || "",
        error: error.message,
      };
    }

    return {
      id: proxyId,
      ip,
      status: 0,
      latencyMs,
      blocked: true,
      body: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const logFile = `proxy-test-${Date.now()}.json`;
  const logData: any[] = [];

  console.log("Fetching proxies from database...\n");

  const { data: proxies, error } = await supabase
    .from("proxies")
    .select("id, url, type, enabled")
    .eq("enabled", true);

  if (error) {
    console.error("Failed to fetch proxies:", error.message);
    process.exit(1);
  }

  if (!proxies || proxies.length === 0) {
    console.log("No enabled proxies found.");
    process.exit(0);
  }

  const dcCount = proxies.filter(p => p.type === "datacenter").length;
  const ispCount = proxies.filter(p => p.type === "isp").length;
  console.log(`Found ${proxies.length} proxies (${dcCount} datacenter, ${ispCount} ISP)\n`);

  console.log(`Testing ${proxies.length} proxies against: ${selectedVenues.join(", ")}\n`);
  console.log("Expected: 200 = WORKING, 500 empty = BLOCKED (WAF)\n");

  // Test each venue
  const allResults: Record<string, typeof results> = {};

  for (const venueName of selectedVenues) {
    const venueId = VENUES[venueName];
    console.log(`\n${"=".repeat(50)}`);
    console.log(`Testing ${venueName} (venue_id: ${venueId})`);
    console.log("=".repeat(50) + "\n");

    // Run all tests in parallel for this venue
    const startTime = Date.now();
    const results = await Promise.all(
      proxies.map((proxy) => testProxy(proxy.id, proxy.url, venueId))
    );
    const totalTime = Date.now() - startTime;

    // Sort by ID for consistent output
    results.sort((a, b) => a.id - b.id);
    allResults[venueName] = results;

    // Log results
    for (const result of results) {
      logData.push({
        venue: venueName,
        id: result.id,
        ip: result.ip,
        status: result.status,
        latencyMs: result.latencyMs,
        blocked: result.blocked,
        error: result.error,
        rawBody: result.body,
      });

      if (result.error) {
        console.log(`[${result.id}] ${result.ip} ... ERROR: ${result.error}`);
      } else if (result.blocked) {
        console.log(`[${result.id}] ${result.ip} ... BLOCKED (${result.status}) - ${result.latencyMs}ms`);
      } else {
        console.log(`[${result.id}] ${result.ip} ... OK (${result.status}) - ${result.latencyMs}ms`);
      }
    }

    console.log(`\n${venueName}: ${proxies.length} proxies tested in ${totalTime}ms`);

    // Venue summary
    const working = results.filter(r => !r.blocked);
    const blocked = results.filter(r => r.blocked);
    console.log(`  ✅ Working: ${working.length}  🚫 Blocked: ${blocked.length}`);

    // Delay between venues to avoid hammering
    if (selectedVenues.indexOf(venueName) < selectedVenues.length - 1) {
      console.log("\nWaiting 2s before next venue...");
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // If multiple venues, show comparison
  if (selectedVenues.length > 1) {
    console.log(`\n${"=".repeat(50)}`);
    console.log("COMPARISON BY PROXY");
    console.log("=".repeat(50) + "\n");

    const header = "Proxy | " + selectedVenues.map(v => v.padEnd(12)).join(" | ");
    console.log(header);
    console.log("-".repeat(header.length));

    for (const proxy of proxies) {
      const cols = selectedVenues.map(venueName => {
        const result = allResults[venueName].find(r => r.id === proxy.id);
        if (!result) return "???".padEnd(12);
        if (result.blocked) return "🚫 BLOCKED".padEnd(12);
        return `✅ ${result.latencyMs}ms`.padEnd(12);
      });
      console.log(`#${proxy.id.toString().padStart(3)} | ${cols.join(" | ")}`);
    }
  }

  const results = Object.values(allResults).flat();

  // Write log file
  await Bun.write(logFile, JSON.stringify(logData, null, 2));
  console.log(`\nRaw responses written to: ${logFile}`);

  // Summary
  const working = results.filter(r => !r.blocked);
  const blocked = results.filter(r => r.blocked);

  console.log("\n" + "=".repeat(50));
  console.log("SUMMARY");
  console.log("=".repeat(50));
  console.log(`Working: ${working.length}`);
  console.log(`Blocked: ${blocked.length}`);

  if (working.length > 0) {
    console.log("\nWorking proxies:");
    for (const r of working) {
      console.log(`  [${r.id}] ${r.ip} - ${r.status} - ${r.latencyMs}ms`);
    }
  }

  if (blocked.length > 0) {
    console.log("\nBlocked proxies to prune:");
    for (const r of blocked) {
      console.log(`  [${r.id}] ${r.ip} - ${r.status} - ${r.error || "WAF blocked"}`);
    }

    console.log("\nTo disable blocked proxies:");
    console.log(`  bun -e "
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
await supabase.from('proxies').update({ enabled: false }).in('id', [${blocked.map(r => r.id).join(", ")}]);
console.log('Disabled ${blocked.length} proxies');
"`);
  }
}

main().catch(console.error);
