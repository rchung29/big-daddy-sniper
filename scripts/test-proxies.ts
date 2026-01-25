/**
 * Test proxy latency to Resy API
 *
 * Run with: bun scripts/test-proxies.ts
 */


const USERNAME = "testing_ArnUq";
const PASSWORD = "FNZx8nW5+cfPJ9";
const COUNTRY = "US";

const PROXIES = [
  { host: "dc.oxylabs.io", port: 8001, ip: "93.115.200.159" },
  { host: "dc.oxylabs.io", port: 8002, ip: "93.115.200.158" },
  { host: "dc.oxylabs.io", port: 8003, ip: "93.115.200.157" },
  { host: "dc.oxylabs.io", port: 8004, ip: "93.115.200.156" },
  { host: "dc.oxylabs.io", port: 8005, ip: "93.115.200.155" },
];

const RESY_API_KEY = process.env.RESY_API_KEY || "VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5";

async function ping(label: string, proxyUrl?: string): Promise<number | null> {
  const start = performance.now();

  try {
    const response = await fetch(
      "https://api.resy.com/3/venue?url_slug=carbone&location=ny",
      {
        headers: {
          Authorization: `ResyAPI api_key="${RESY_API_KEY}"`,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
        ...(proxyUrl ? { proxy: proxyUrl } : {}),
      } as any
    );

    const elapsed = Math.round(performance.now() - start);

    if (response.ok) {
      return elapsed;
    } else {
      console.log(`  ${label}: ✗ ${response.status} (${elapsed}ms)`);
      return null;
    }
  } catch (error) {
    console.log(`  ${label}: ✗ Error - ${error}`);
    return null;
  }
}

async function main() {
  console.log("=".repeat(50));
  console.log("PROXY LATENCY TEST - Resy API");
  console.log("=".repeat(50));
  console.log("");

  const results: { label: string; pings: number[] }[] = [];

  // Test direct connection
  console.log("Direct (no proxy):");
  const directPings: number[] = [];
  for (let i = 0; i < 3; i++) {
    const ms = await ping("Direct");
    if (ms) directPings.push(ms);
  }
  if (directPings.length > 0) {
    const avg = Math.round(directPings.reduce((a, b) => a + b, 0) / directPings.length);
    console.log(`  ${directPings.map(p => p + "ms").join(", ")} → avg: ${avg}ms`);
    results.push({ label: "Direct", pings: directPings });
  }

  // Test each proxy
  for (const proxy of PROXIES) {
    const username = `user-${USERNAME}-country-${COUNTRY}`;
    const proxyUrl = `http://${username}:${encodeURIComponent(PASSWORD)}@${proxy.host}:${proxy.port}`;

    console.log(`\nProxy :${proxy.port} (${proxy.ip}):`);
    const pings: number[] = [];
    for (let i = 0; i < 3; i++) {
      const ms = await ping(`:${proxy.port}`, proxyUrl);
      if (ms) pings.push(ms);
    }
    if (pings.length > 0) {
      const avg = Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
      console.log(`  ${pings.map(p => p + "ms").join(", ")} → avg: ${avg}ms`);
      results.push({ label: `:${proxy.port}`, pings });
    }
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("SUMMARY");
  console.log("=".repeat(50));

  results.sort((a, b) => {
    const avgA = a.pings.reduce((x, y) => x + y, 0) / a.pings.length;
    const avgB = b.pings.reduce((x, y) => x + y, 0) / b.pings.length;
    return avgA - avgB;
  });

  for (const r of results) {
    const avg = Math.round(r.pings.reduce((a, b) => a + b, 0) / r.pings.length);
    const min = Math.min(...r.pings);
    const max = Math.max(...r.pings);
    console.log(`${r.label.padEnd(10)} avg: ${avg}ms  (min: ${min}ms, max: ${max}ms)`);
  }
}

main();
