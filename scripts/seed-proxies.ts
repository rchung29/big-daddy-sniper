/**
 * Seed Oxylabs proxies into the database
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

// Oxylabs credentials
const USERNAME = "testing_ArnUq";
const PASSWORD = "FNZx8nW5+cfPJ9";
const COUNTRY = "US";

// Datacenter proxy endpoints
const PROXIES = [
  { host: "dc.oxylabs.io", port: 8001, ip: "93.115.200.159" },
  { host: "dc.oxylabs.io", port: 8002, ip: "93.115.200.158" },
  { host: "dc.oxylabs.io", port: 8003, ip: "93.115.200.157" },
  { host: "dc.oxylabs.io", port: 8004, ip: "93.115.200.156" },
  { host: "dc.oxylabs.io", port: 8005, ip: "93.115.200.155" },
];

function buildProxyUrl(host: string, port: number): string {
  const username = `user-${USERNAME}-country-${COUNTRY}`;
  const encodedPassword = encodeURIComponent(PASSWORD);
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

  logger.info({ count: PROXIES.length }, "Seeding Oxylabs proxies...");

  let created = 0;
  let updated = 0;

  for (const proxy of PROXIES) {
    const proxyUrl = buildProxyUrl(proxy.host, proxy.port);

    try {
      const { data: existing } = await supabase
        .from("proxies")
        .select("id")
        .eq("url", proxyUrl)
        .single();

      if (existing) {
        await supabase
          .from("proxies")
          .update({ enabled: true, rate_limited_until: null })
          .eq("id", existing.id);
        updated++;
        logger.debug({ port: proxy.port, ip: proxy.ip }, "Updated proxy");
      } else {
        const { error } = await supabase.from("proxies").insert({
          url: proxyUrl,
          type: "datacenter",
          enabled: true,
        });
        if (error) throw error;
        created++;
        logger.debug({ port: proxy.port, ip: proxy.ip }, "Created proxy");
      }
    } catch (error) {
      logger.error({ port: proxy.port, error: String(error) }, "Failed");
    }
  }

  logger.info({ created, updated }, "Proxy seeding complete");

  // Verify
  const { count } = await supabase
    .from("proxies")
    .select("*", { count: "exact", head: true })
    .eq("enabled", true);

  logger.info(`Total enabled proxies: ${count}`);
}

main().catch((error) => {
  logger.error({ error: String(error) }, "Seed failed");
  process.exit(1);
});
