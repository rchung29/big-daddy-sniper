/**
 * Seed proxies into the database
 *
 * Wipes all existing proxies and replaces with new list.
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
];

const ISP_PROXIES = [
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-booking-ip-85.28.49.146:nustt43ofgg4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-booking-ip-158.46.159.227:nustt43ofgg4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-booking-ip-89.184.29.47:nustt43ofgg4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-booking-ip-158.46.203.154:nustt43ofgg4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-booking-ip-176.100.132.147:nustt43ofgg4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-booking-ip-93.177.92.111:nustt43ofgg4",
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

  // Step 1: Delete ALL proxies
  logger.info("Deleting all existing proxies...");
  const { error: deleteError } = await supabase
    .from("proxies")
    .delete()
    .neq("id", 0); // Delete all rows

  if (deleteError) {
    logger.error({ error: deleteError.message }, "Failed to delete proxies");
    process.exit(1);
  }
  logger.info("All proxies deleted.");

  // Step 2: Build proxy list
  const proxies: Array<{ url: string; type: "datacenter" | "isp"; enabled: boolean }> = [];

  // Add datacenter proxies
  for (const str of DATACENTER_PROXIES) {
    proxies.push({
      url: parseBrightDataProxy(str),
      type: "datacenter",
      enabled: true,
    });
  }

  // Add ISP proxies
  for (const str of ISP_PROXIES) {
    proxies.push({
      url: parseBrightDataProxy(str),
      type: "isp",
      enabled: true,
    });
  }

  logger.info({ datacenter: DATACENTER_PROXIES.length, isp: ISP_PROXIES.length }, "Inserting proxies...");

  // Step 3: Insert all proxies
  const { error: insertError } = await supabase.from("proxies").insert(proxies);

  if (insertError) {
    logger.error({ error: insertError.message }, "Failed to insert proxies");
    process.exit(1);
  }

  logger.info("Proxies seeded successfully");

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
