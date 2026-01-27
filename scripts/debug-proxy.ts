/**
 * Debug proxy connectivity with Bun
 *
 * Tests different approaches to see what works
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const RESY_API_KEY = "VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5";

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const day = tomorrow.toISOString().split("T")[0];
const TEST_URL = `https://api.resy.com/4/find?venue_id=79460&day=${day}&party_size=2&lat=0&long=0`;

async function main() {
  // Get one Bright Data proxy
  const { data: proxies } = await supabase
    .from("proxies")
    .select("id, url")
    .like("url", "%brd.superproxy.io%")
    .limit(1);

  if (!proxies || proxies.length === 0) {
    console.log("No Bright Data proxies found");
    return;
  }

  const proxyUrl = proxies[0].url;
  console.log("Testing proxy (http):", proxyUrl);

  // Try https:// version
  const httpsProxyUrl = proxyUrl.replace("http://", "https://");
  console.log("Testing proxy (https):", httpsProxyUrl);
  console.log("Target URL:", TEST_URL);
  console.log("");

  // Test 1: Bun fetch with http:// proxy
  console.log("=== Test 1: Bun fetch with http:// proxy ===");
  try {
    const start = Date.now();
    const resp = await fetch(TEST_URL, {
      method: "GET",
      headers: {
        "Authorization": `ResyAPI api_key="${RESY_API_KEY}"`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      proxy: proxyUrl,
    } as RequestInit);

    const text = await resp.text();
    console.log(`Status: ${resp.status} (${Date.now() - start}ms)`);
    console.log(`Body length: ${text.length}`);
    console.log(`Body preview: ${text.substring(0, 200)}`);
  } catch (e) {
    console.log("Error:", e);
  }

  console.log("");

  // Test 2: Bun fetch with https:// proxy
  console.log("=== Test 2: Bun fetch with https:// proxy ===");
  try {
    const start = Date.now();
    const resp = await fetch(TEST_URL, {
      method: "GET",
      headers: {
        "Authorization": `ResyAPI api_key="${RESY_API_KEY}"`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      proxy: httpsProxyUrl,
    } as RequestInit);

    const text = await resp.text();
    console.log(`Status: ${resp.status} (${Date.now() - start}ms)`);
    console.log(`Body length: ${text.length}`);
    console.log(`Body preview: ${text.substring(0, 200)}`);
  } catch (e) {
    console.log("Error:", e);
  }

  console.log("");

  // Test 3: Bun fetch with proxy object format + explicit auth header
  console.log("=== Test 3: Bun fetch with proxy object format ===");
  try {
    // Extract credentials from URL
    const urlObj = new URL(proxyUrl);
    const username = urlObj.username;
    const password = decodeURIComponent(urlObj.password);
    const proxyHost = `${urlObj.protocol}//${urlObj.host}`;
    const basicAuth = Buffer.from(`${username}:${password}`).toString("base64");

    console.log(`Proxy host: ${proxyHost}`);
    console.log(`Username: ${username}`);

    const start = Date.now();
    const resp = await fetch(TEST_URL, {
      method: "GET",
      headers: {
        "Authorization": `ResyAPI api_key="${RESY_API_KEY}"`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      proxy: {
        url: proxyHost,
        headers: {
          "Proxy-Authorization": `Basic ${basicAuth}`,
        },
      },
    } as RequestInit);

    const text = await resp.text();
    console.log(`Status: ${resp.status} (${Date.now() - start}ms)`);
    console.log(`Body length: ${text.length}`);
    console.log(`Body preview: ${text.substring(0, 200)}`);
  } catch (e) {
    console.log("Error:", e);
  }

  console.log("");

  // Test 4: Curl for reference
  console.log("=== Test 4: Curl via Bun.$ ===");
  try {
    const start = Date.now();
    const result = await Bun.$`curl -s -x ${proxyUrl} ${TEST_URL} -H ${"Authorization: ResyAPI api_key=\"" + RESY_API_KEY + "\""} -H "User-Agent: Mozilla/5.0"`.text();
    console.log(`Time: ${Date.now() - start}ms`);
    console.log(`Body length: ${result.length}`);
    console.log(`Body preview: ${result.substring(0, 200)}`);
  } catch (e) {
    console.log("Error:", e);
  }
}

main().catch(console.error);
