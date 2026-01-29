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
  // dc_monitoring zone
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-109.70.67.131:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-185.182.21.115:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-94.46.2.194:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-185.90.243.118:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-109.198.32.206:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-161.129.172.82:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-77.83.69.115:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-161.123.98.173:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-180.149.15.51:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-209.99.170.254:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-92.119.169.12:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-193.111.184.204:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-152.39.250.37:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-2.58.79.134:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-185.134.221.85:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-178.171.40.13:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-188.95.153.93:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-94.176.119.185:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-204.3.16.127:t4wvz8ydjte4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-dc_monitoring-ip-85.89.196.3:t4wvz8ydjte4",
  // monitoring_2 zone
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-monitoring_2-ip-2.59.0.102:44t846rthn4u",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-monitoring_2-ip-45.143.173.119:44t846rthn4u",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-monitoring_2-ip-92.255.35.237:44t846rthn4u",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-monitoring_2-ip-45.134.115.248:44t846rthn4u",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-monitoring_2-ip-80.240.118.27:44t846rthn4u",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-monitoring_2-ip-95.215.36.209:44t846rthn4u",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-monitoring_2-ip-167.160.41.77:44t846rthn4u",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-monitoring_2-ip-161.123.42.220:44t846rthn4u",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-monitoring_2-ip-161.123.29.132:44t846rthn4u",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-monitoring_2-ip-131.103.34.217:44t846rthn4u",
];

const ISP_PROXIES = [
  // booking zone
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-booking-ip-85.28.49.146:nustt43ofgg4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-booking-ip-158.46.159.227:nustt43ofgg4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-booking-ip-89.184.29.47:nustt43ofgg4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-booking-ip-158.46.203.154:nustt43ofgg4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-booking-ip-176.100.132.147:nustt43ofgg4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-booking-ip-93.177.92.111:nustt43ofgg4",
  // isp2 zone
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-isp2-ip-31.204.4.189:fkh82lesgo4l",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-isp2-ip-158.46.152.158:fkh82lesgo4l",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-isp2-ip-213.109.189.101:fkh82lesgo4l",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-isp2-ip-66.17.229.131:fkh82lesgo4l",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-isp2-ip-178.171.74.184:fkh82lesgo4l",
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
