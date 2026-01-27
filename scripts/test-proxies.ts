/**
 * Test all proxies against Resy API
 *
 * Makes a legitimate find request to venue 79460 using the SDK client.
 * Expected: 200 = WORKING, error = BLOCKED by WAF
 *
 * Run with: bun scripts/test-proxies.ts
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

// Legitimate find request to venue 79460
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const day = tomorrow.toISOString().split("T")[0];

async function testProxy(proxyId: number, proxyUrl: string): Promise<{
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
      venue_id: 79460,
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
    .select("id, url, enabled")
    .eq("enabled", true)
    .eq("type", "datacenter");

  if (error) {
    console.error("Failed to fetch proxies:", error.message);
    process.exit(1);
  }

  if (!proxies || proxies.length === 0) {
    console.log("No enabled proxies found.");
    process.exit(0);
  }

  console.log(`Testing ${proxies.length} proxies against Resy API (venue 79460)...\n`);
  console.log("Expected: 200 = WORKING, 500 empty = BLOCKED (WAF)\n");

  const results: Array<{
    id: number;
    ip: string;
    status: number;
    latencyMs: number;
    blocked: boolean;
    body: string;
    error?: string;
  }> = [];

  for (const proxy of proxies) {
    process.stdout.write(`[${proxy.id}] `);

    const result = await testProxy(proxy.id, proxy.url);
    results.push(result);

    // Log full result to file
    logData.push({
      id: result.id,
      ip: result.ip,
      status: result.status,
      latencyMs: result.latencyMs,
      blocked: result.blocked,
      error: result.error,
      rawBody: result.body,
    });

    if (result.error) {
      console.log(`${result.ip} ... ERROR: ${result.error}`);
    } else if (result.blocked) {
      console.log(`${result.ip} ... BLOCKED (${result.status}) - ${result.latencyMs}ms`);
    } else {
      console.log(`${result.ip} ... OK (${result.status}) - ${result.latencyMs}ms`);
    }
  }

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
