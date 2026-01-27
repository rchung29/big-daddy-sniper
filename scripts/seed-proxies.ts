/**
 * Seed Bright Data proxies into the database
 *
 * Appends new proxies (skips duplicates).
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
const PROXY_STRINGS = [
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-180.149.13.171:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-185.246.174.193:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-213.188.90.180:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-119.13.216.205:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-213.188.74.238:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-206.204.6.49:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-161.123.110.32:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-152.39.211.26:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-204.44.98.190:4qg8exdwbnz4",
  "brd.superproxy.io:33335:brd-customer-hl_f0e0c345-zone-datacenter_proxy1-ip-213.188.67.188:4qg8exdwbnz4",
];

function parseProxyString(proxyStr: string): string {
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

  logger.info({ count: PROXY_STRINGS.length }, "Seeding Bright Data proxies...");

  const proxies = PROXY_STRINGS.map((str) => ({
    url: parseProxyString(str),
    type: "datacenter" as const,
    enabled: true,
  }));

  // Insert each proxy, skip if already exists
  let created = 0;
  let skipped = 0;

  for (const proxy of proxies) {
    // Check if already exists
    const { data: existing } = await supabase
      .from("proxies")
      .select("id")
      .eq("url", proxy.url)
      .single();

    if (existing) {
      skipped++;
      continue;
    }

    const { error } = await supabase.from("proxies").insert(proxy);
    if (error) {
      logger.error({ error: error.message }, "Failed to insert proxy");
    } else {
      created++;
    }
  }

  logger.info({ created, skipped }, "Proxy seeding complete");

  // Verify
  const { data: inserted } = await supabase
    .from("proxies")
    .select("id, url, enabled")
    .eq("enabled", true);

  logger.info(`Total enabled proxies: ${inserted?.length ?? 0}`);

  console.log("\nProxies added:");
  for (const p of inserted ?? []) {
    // Extract IP from URL for display
    const ipMatch = p.url.match(/ip-([0-9.]+)/);
    const ip = ipMatch ? ipMatch[1] : "unknown";
    console.log(`  [${p.id}] ${ip}`);
  }
}

main().catch((error) => {
  logger.error({ error: String(error) }, "Seed failed");
  process.exit(1);
});
