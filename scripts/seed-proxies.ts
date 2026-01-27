/**
 * Seed datacenter proxies into the database
 *
 * Deletes all existing datacenter proxies and replaces with new list.
 * ISP proxies are preserved.
 *
 * Run with: bun scripts/seed-proxies.ts
 */
import { createClient } from "@supabase/supabase-js";
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

// Bright Data proxy format: host:port:username:password
const BRIGHT_DATA_PROXIES = [
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-180.149.13.171:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-185.246.174.193:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-161.123.239.167:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-213.188.90.180:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-119.13.216.205:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-213.188.74.238:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-206.204.6.49:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-206.204.26.234:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-161.123.110.32:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-45.95.74.26:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-213.188.89.118:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-152.39.211.26:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-152.39.230.236:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-2.57.78.199:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-204.44.98.190:4qg8exdwbnz4",
];

// Oxylabs datacenter proxies
const OXYLABS_USERNAME = "user-testing_tEg3T-country-US";
const OXYLABS_PASSWORD = "1cYiVgX+skg+sEL9";
const OXYLABS_PROXIES = [
  { host: "dc.oxylabs.io", port: 8001, ip: "93.115.200.159" },
  { host: "dc.oxylabs.io", port: 8002, ip: "93.115.200.158" },
  { host: "dc.oxylabs.io", port: 8003, ip: "93.115.200.157" },
  { host: "dc.oxylabs.io", port: 8004, ip: "93.115.200.156" },
  { host: "dc.oxylabs.io", port: 8005, ip: "93.115.200.155" },
];

function parseBrightDataProxy(proxyStr: string): string {
  // Format: host:port:username:password
  const parts = proxyStr.split(":");
  const host = parts[0];
  const port = parts[1];
  const username = parts[2];
  const password = parts[3];

  const encodedPassword = encodeURIComponent(password);
  return `http://${username}:${encodedPassword}@${host}:${port}`;
}

function buildOxylabsProxyUrl(host: string, port: number): string {
  const encodedPassword = encodeURIComponent(OXYLABS_PASSWORD);
  return `http://${OXYLABS_USERNAME}:${encodedPassword}@${host}:${port}`;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    logger.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Step 1: Delete all datacenter proxies (preserve ISP proxies)
  logger.info("Deleting all existing datacenter proxies...");
  const { error: deleteError } = await supabase
    .from("proxies")
    .delete()
    .eq("type", "datacenter");

  if (deleteError) {
    logger.error({ error: deleteError.message }, "Failed to delete datacenter proxies");
    process.exit(1);
  }
  logger.info("Datacenter proxies deleted.");

  // Step 2: Build proxy list
  const proxies: Array<{ url: string; type: "datacenter"; enabled: boolean }> = [];

  // Add Bright Data proxies
  for (const str of BRIGHT_DATA_PROXIES) {
    proxies.push({
      url: parseBrightDataProxy(str),
      type: "datacenter",
      enabled: true,
    });
  }

  // Add Oxylabs proxies
  for (const ox of OXYLABS_PROXIES) {
    proxies.push({
      url: buildOxylabsProxyUrl(ox.host, ox.port),
      type: "datacenter",
      enabled: true,
    });
  }

  logger.info({ count: proxies.length }, "Inserting datacenter proxies...");

  // Step 3: Insert all proxies
  const { error: insertError } = await supabase.from("proxies").insert(proxies);

  if (insertError) {
    logger.error({ error: insertError.message }, "Failed to insert proxies");
    process.exit(1);
  }

  logger.info({ count: proxies.length }, "Datacenter proxies seeded successfully");

  // Verify
  const { data: allProxies } = await supabase
    .from("proxies")
    .select("id, type, enabled")
    .order("id");

  const datacenter = allProxies?.filter((p) => p.type === "datacenter") ?? [];
  const isp = allProxies?.filter((p) => p.type === "isp") ?? [];

  console.log("\nProxy summary:");
  console.log(`  Datacenter: ${datacenter.length}`);
  console.log(`  ISP: ${isp.length}`);
  console.log(`  Total: ${allProxies?.length ?? 0}`);
}

main().catch((error) => {
  logger.error({ error: String(error) }, "Seed failed");
  process.exit(1);
});
