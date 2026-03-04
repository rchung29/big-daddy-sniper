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

// Proxy format: host:port:username:password
const MONITORING_PROXIES = [
  "151.246.71.52:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.53:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.54:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.55:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.56:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.57:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.58:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.59:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.60:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.61:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.62:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.63:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.64:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.65:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.66:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.67:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.68:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.69:3128:xyz7777:yp1q60na7nnl6sna",
];

const CHECKOUT_PROXIES: string[] = [
  "151.246.71.70:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.71:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.72:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.73:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.74:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.75:3128:xyz7777:yp1q60na7nnl6sna",
  "151.246.71.76:3128:xyz7777:yp1q60na7nnl6sna",
];

function parseProxy(proxyStr: string): string {
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
  const newProxies: Array<{ url: string; type: "monitoring" | "checkout"; enabled: boolean }> = [];

  // Add monitoring proxies
  for (const str of MONITORING_PROXIES) {
    const proxyUrl = parseProxy(str);
    newProxies.push({
      url: proxyUrl,
      type: "monitoring",
      enabled: true,
    });
  }

  // Add checkout proxies
  for (const str of CHECKOUT_PROXIES) {
    const proxyUrl = parseProxy(str);
    newProxies.push({
      url: proxyUrl,
      type: "checkout",
      enabled: true,
    });
  }

  const newMonitoring = newProxies.filter((p) => p.type === "monitoring").length;
  const newCheckout = newProxies.filter((p) => p.type === "checkout").length;
  logger.info({ newMonitoring, newCheckout, total: newProxies.length }, "Inserting new proxies...");

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

  const monitoring = allProxies?.filter((p) => p.type === "monitoring") ?? [];
  const checkout = allProxies?.filter((p) => p.type === "checkout") ?? [];

  console.log("\nProxy summary:");
  console.log(`  Monitoring: ${monitoring.length}`);
  console.log(`  Checkout: ${checkout.length}`);
  console.log(`  Total: ${allProxies?.length ?? 0}`);
}

main().catch((error) => {
  logger.error({ error: String(error) }, "Seed failed");
  process.exit(1);
});
