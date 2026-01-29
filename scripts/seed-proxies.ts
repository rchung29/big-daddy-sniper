/**
 * Seed proxies into the database
 *
 * Adds new proxies without deleting existing ones (skips duplicates).
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
const DATACENTER_PROXIES = [
  // datacenter_proxy4 zone (45 proxies)
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-193.31.124.147:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-83.229.110.212:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-95.215.36.16:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-213.255.207.219:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-178.171.109.146:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-45.148.106.0:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-89.104.111.55:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-185.255.164.36:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-83.229.107.10:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-178.171.64.126:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-77.81.110.114:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-45.90.60.152:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-91.92.178.76:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-45.134.114.18:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-110.239.210.91:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-109.198.43.61:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-91.92.17.100:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-92.255.81.54:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-185.66.136.174:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-194.31.177.123:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-66.251.136.110:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-119.13.209.21:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-89.34.78.196:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-161.123.190.91:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-119.13.208.217:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-162.43.238.169:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-89.104.100.102:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-89.184.204.205:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-104.200.71.218:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-62.241.57.84:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-167.160.98.49:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-92.255.80.221:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-91.92.22.122:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-152.39.157.92:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-154.17.138.233:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-207.230.121.163:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-43.252.28.3:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-85.208.149.33:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-206.204.13.21:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-89.184.223.43:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-110.239.209.18:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-193.151.162.144:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-188.215.76.128:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-80.240.99.55:wer8g4gwwa0z",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy4-ip-31.98.63.69:wer8g4gwwa0z",
];

const ISP_PROXIES: string[] = [
  // No ISP proxies to add
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

  // Step 1: Get existing proxy URLs to avoid duplicates
  logger.info("Fetching existing proxies...");
  const { data: existingProxies, error: fetchError } = await supabase
    .from("proxies")
    .select("url");

  if (fetchError) {
    logger.error({ error: fetchError.message }, "Failed to fetch existing proxies");
    process.exit(1);
  }

  const existingUrls = new Set(existingProxies?.map((p) => p.url) ?? []);
  logger.info({ existingCount: existingUrls.size }, "Found existing proxies");

  // Step 2: Build proxy list (only new ones)
  const newProxies: Array<{ url: string; type: "datacenter" | "isp"; enabled: boolean }> = [];

  // Add datacenter proxies (skip existing)
  for (const str of DATACENTER_PROXIES) {
    const proxyUrl = parseBrightDataProxy(str);
    if (!existingUrls.has(proxyUrl)) {
      newProxies.push({
        url: proxyUrl,
        type: "datacenter",
        enabled: true,
      });
    }
  }

  // Add ISP proxies (skip existing)
  for (const str of ISP_PROXIES) {
    const proxyUrl = parseBrightDataProxy(str);
    if (!existingUrls.has(proxyUrl)) {
      newProxies.push({
        url: proxyUrl,
        type: "isp",
        enabled: true,
      });
    }
  }

  if (newProxies.length === 0) {
    logger.info("No new proxies to add - all already exist");
  } else {
    const newDatacenter = newProxies.filter((p) => p.type === "datacenter").length;
    const newIsp = newProxies.filter((p) => p.type === "isp").length;
    logger.info({ newDatacenter, newIsp, total: newProxies.length }, "Inserting new proxies...");

    // Step 3: Insert new proxies
    const { error: insertError } = await supabase.from("proxies").insert(newProxies);

    if (insertError) {
      logger.error({ error: insertError.message }, "Failed to insert proxies");
      process.exit(1);
    }

    logger.info("New proxies added successfully");
  }

  // Verify final state
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
