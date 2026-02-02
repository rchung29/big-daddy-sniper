/**
 * Seed proxies into the database
 *
 * DELETES all existing proxies and adds new ones.
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

// Oxylabs proxy format: host:port:username:password
const DATACENTER_PROXIES = [
  // Account 1: testing_ArnUq
  "dc.oxylabs.io:8001:user-testing_ArnUq-country-US:KFI4Vtl9QD9+5aa",
  "dc.oxylabs.io:8002:user-testing_ArnUq-country-US:KFI4Vtl9QD9+5aa",
  "dc.oxylabs.io:8003:user-testing_ArnUq-country-US:KFI4Vtl9QD9+5aa",
  "dc.oxylabs.io:8004:user-testing_ArnUq-country-US:KFI4Vtl9QD9+5aa",
  "dc.oxylabs.io:8005:user-testing_ArnUq-country-US:KFI4Vtl9QD9+5aa",
  // Account 2: testing_tEg3T
  "dc.oxylabs.io:8001:user-testing_tEg3T-country-US:qp=PuJxRWUz_4j5",
  "dc.oxylabs.io:8002:user-testing_tEg3T-country-US:qp=PuJxRWUz_4j5",
  "dc.oxylabs.io:8003:user-testing_tEg3T-country-US:qp=PuJxRWUz_4j5",
  "dc.oxylabs.io:8004:user-testing_tEg3T-country-US:qp=PuJxRWUz_4j5",
  "dc.oxylabs.io:8005:user-testing_tEg3T-country-US:qp=PuJxRWUz_4j5",
];

const ISP_PROXIES: string[] = [
  // No ISP proxies to add
];

function parseOxylabsProxy(proxyStr: string): string {
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

  // Step 1: Delete all existing proxies
  logger.info("Deleting all existing proxies...");
  const { error: deleteError } = await supabase
    .from("proxies")
    .delete()
    .gte("id", 0); // Delete all rows

  if (deleteError) {
    logger.error({ error: deleteError.message }, "Failed to delete existing proxies");
    process.exit(1);
  }

  logger.info("All existing proxies deleted");

  // Step 2: Build proxy list
  const newProxies: Array<{ url: string; type: "datacenter" | "isp"; enabled: boolean }> = [];

  // Add datacenter proxies
  for (const str of DATACENTER_PROXIES) {
    const proxyUrl = parseOxylabsProxy(str);
    newProxies.push({
      url: proxyUrl,
      type: "datacenter",
      enabled: true,
    });
  }

  // Add ISP proxies
  for (const str of ISP_PROXIES) {
    const proxyUrl = parseOxylabsProxy(str);
    newProxies.push({
      url: proxyUrl,
      type: "isp",
      enabled: true,
    });
  }

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
