/**
 * Resy Account Generator
 *
 * Creates new Resy accounts using CapMonster for CAPTCHA solving.
 * Stores accounts in the database users table.
 *
 * Run with: bun scripts/generate-account.ts
 */

import { createClient } from "@supabase/supabase-js";

// CapMonster config
const CAPMONSTER_API_KEY = "becbfdd317f252f7e94bab86efc3d66a";
const RESY_SITE_KEY = "6Lfw-dIZAAAAAESRBH4JwdgfTXj5LlS1ewlvvCYe";
const RESY_API_KEY = "VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5";

// Supabase config
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface AccountInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  discordId: string;
  discordUsername?: string;
}

interface CardInput {
  cardNumber: string;
  expMonth: string;
  expYear: string;
  cvc: string;
}

/**
 * Generate a random phone number with 703 area code
 */
function generatePhoneNumber(): string {
  const areaCode = "703";
  const exchange = String(Math.floor(Math.random() * 900) + 100); // 100-999
  const subscriber = String(Math.floor(Math.random() * 9000) + 1000); // 1000-9999
  return `${areaCode}${exchange}${subscriber}`;
}

/**
 * Solve reCAPTCHA v2 using CapMonster
 */
async function solveCaptcha(): Promise<string> {
  console.log("Creating CAPTCHA task...");

  // Create task
  const createResponse = await fetch("https://api.capmonster.cloud/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: CAPMONSTER_API_KEY,
      task: {
        type: "RecaptchaV2TaskProxyless",
        websiteURL: "https://resy.com",
        websiteKey: RESY_SITE_KEY,
      },
    }),
  });

  const createResult = await createResponse.json();

  if (createResult.errorId !== 0) {
    throw new Error(`CapMonster create error: ${createResult.errorDescription}`);
  }

  const taskId = createResult.taskId;
  console.log(`Task created: ${taskId}`);

  // Poll for result
  console.log("Solving CAPTCHA (this may take 30-60 seconds)...");

  while (true) {
    await new Promise((r) => setTimeout(r, 3000)); // Wait 3 seconds

    const resultResponse = await fetch("https://api.capmonster.cloud/getTaskResult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientKey: CAPMONSTER_API_KEY,
        taskId: taskId,
      }),
    });

    const result = await resultResponse.json();

    if (result.errorId !== 0) {
      throw new Error(`CapMonster result error: ${result.errorDescription}`);
    }

    if (result.status === "ready") {
      console.log("CAPTCHA solved!");
      return result.solution.gRecaptchaResponse;
    }

    process.stdout.write(".");
  }
}

/**
 * Register a new Resy account
 */
async function registerAccount(input: AccountInput): Promise<string> {
  const phoneNumber = generatePhoneNumber();
  const deviceToken = crypto.randomUUID();

  console.log(`\nGenerating account for: ${input.email}`);
  console.log(`Phone number: +1${phoneNumber}`);

  // Solve CAPTCHA
  const captchaToken = await solveCaptcha();

  // Prepare registration data
  const formData = new URLSearchParams({
    first_name: input.firstName,
    last_name: input.lastName,
    mobile_number: `+1${phoneNumber}`,
    em_address: input.email,
    password: input.password,
    policies_accept: "1",
    complete: "1",
    device_type_id: "3",
    device_token: deviceToken,
    marketing_opt_in: "0",
    isNonUS: "0",
    captcha_token: captchaToken,
  });

  console.log("Registering with Resy...");

  const response = await fetch("https://api.resy.com/2/user/registration", {
    method: "POST",
    headers: {
      "Host": "api.resy.com",
      "X-Origin": "https://resy.com",
      "Authorization": `ResyAPI api_key="${RESY_API_KEY}"`,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Cache-Control": "no-cache",
      "Referer": "https://resy.com/",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Registration failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const authToken = data.user?.token;

  if (!authToken) {
    throw new Error(`No auth token in response: ${JSON.stringify(data)}`);
  }

  console.log(`Registration successful! Token: ${authToken.slice(0, 20)}...`);

  return authToken;
}

/**
 * Setup payment method using Stripe
 * Returns the Resy payment method ID
 */
async function setupPaymentMethod(authToken: string, card: CardInput): Promise<number> {
  console.log("\nSetting up payment method...");

  // Step 1: Get setup intent from Resy
  const setupIntentResponse = await fetch("https://api.resy.com/3/stripe/setup_intent", {
    method: "POST",
    headers: {
      "Authorization": `ResyAPI api_key="${RESY_API_KEY}"`,
      "X-Resy-Auth-Token": authToken,
      "X-Resy-Universal-Auth": authToken,
      "X-Origin": "https://resy.com",
      "Origin": "https://resy.com",
      "Referer": "https://resy.com/",
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!setupIntentResponse.ok) {
    throw new Error(`Setup intent failed: ${await setupIntentResponse.text()}`);
  }

  const setupIntent = await setupIntentResponse.json();
  const clientSecret = setupIntent.client_secret;
  console.log(`Got setup intent: ${clientSecret.slice(0, 30)}...`);

  // Step 2: Create payment method with Stripe
  // Extract the setup intent ID from client_secret (format: seti_xxx_secret_yyy)
  const setupIntentId = clientSecret.split("_secret_")[0];

  // First create a payment method
  const stripePublishableKey = "pk_live_51BwrmXLEpLHBkIYuflcQ07lQeqFMpY4aKhfk8Yt7oJ8gwJM6SdVzjWQUeQHLLPNx4NNPBq1pAi9H7oPv0e7mYdXC00XOJFnc3Z"; // Resy's Stripe publishable key

  // Create payment method
  const pmFormData = new URLSearchParams({
    "type": "card",
    "card[number]": card.cardNumber,
    "card[exp_month]": card.expMonth,
    "card[exp_year]": card.expYear,
    "card[cvc]": card.cvc,
  });

  const pmResponse = await fetch("https://api.stripe.com/v1/payment_methods", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripePublishableKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: pmFormData.toString(),
  });

  if (!pmResponse.ok) {
    const errText = await pmResponse.text();
    throw new Error(`Stripe payment method creation failed: ${errText}`);
  }

  const pmData = await pmResponse.json();
  const stripePaymentMethodId = pmData.id;
  console.log(`Created Stripe payment method: ${stripePaymentMethodId}`);

  // Step 3: Confirm the setup intent with the payment method
  const confirmFormData = new URLSearchParams({
    "payment_method": stripePaymentMethodId,
    "client_secret": clientSecret,
  });

  const confirmResponse = await fetch(`https://api.stripe.com/v1/setup_intents/${setupIntentId}/confirm`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripePublishableKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: confirmFormData.toString(),
  });

  if (!confirmResponse.ok) {
    const errText = await confirmResponse.text();
    throw new Error(`Stripe setup confirm failed: ${errText}`);
  }

  console.log("Setup intent confirmed with Stripe");

  // Step 4: Save payment method to Resy
  const saveFormData = new URLSearchParams({
    "stripe_payment_method_id": stripePaymentMethodId,
  });

  const saveResponse = await fetch("https://api.resy.com/3/stripe/payment_method", {
    method: "POST",
    headers: {
      "Authorization": `ResyAPI api_key="${RESY_API_KEY}"`,
      "X-Resy-Auth-Token": authToken,
      "X-Resy-Universal-Auth": authToken,
      "X-Origin": "https://resy.com",
      "Origin": "https://resy.com",
      "Referer": "https://resy.com/",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: saveFormData.toString(),
  });

  if (!saveResponse.ok) {
    const errText = await saveResponse.text();
    throw new Error(`Save payment method failed: ${errText}`);
  }

  const saveData = await saveResponse.json();
  console.log("Payment method saved to Resy:", saveData);

  // The response should contain the Resy payment method ID
  const resyPaymentMethodId = saveData.id || saveData.payment_method_id;

  if (!resyPaymentMethodId) {
    console.log("Warning: Could not extract Resy payment method ID from response");
    console.log("Full response:", JSON.stringify(saveData, null, 2));
    return 0;
  }

  return resyPaymentMethodId;
}

/**
 * Save account to database with payment method
 */
async function saveToDatabaseWithPayment(
  discordId: string,
  discordUsername: string | undefined,
  authToken: string,
  paymentMethodId: number
): Promise<number> {
  const { data, error } = await supabase
    .from("users")
    .insert({
      discord_id: discordId,
      discord_username: discordUsername,
      resy_auth_token: authToken,
      resy_payment_method_id: paymentMethodId || null,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Database insert failed: ${error.message}`);
  }

  return data.id;
}

/**
 * Interactive CLI prompt
 */
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log("=".repeat(60));
  console.log("RESY ACCOUNT GENERATOR");
  console.log("=".repeat(60));
  console.log("");

  // Gather input
  const firstName = await prompt("First name: ");
  const lastName = await prompt("Last name: ");
  const email = await prompt("Email: ");
  const password = await prompt("Password: ");
  const discordId = await prompt("Discord ID (for database): ");
  const discordUsername = await prompt("Discord username (optional): ");

  console.log("\n-- Payment Card Details --");
  const cardNumber = await prompt("Card number: ");
  const expMonth = await prompt("Exp month (MM): ");
  const expYear = await prompt("Exp year (YY): ");
  const cvc = await prompt("CVC: ");

  console.log("");

  try {
    // Register account
    const authToken = await registerAccount({
      firstName,
      lastName,
      email,
      password,
      discordId,
      discordUsername: discordUsername || undefined,
    });

    // Wait a bit before payment setup
    await new Promise((r) => setTimeout(r, 2000));

    // Setup payment method
    const paymentMethodId = await setupPaymentMethod(authToken, {
      cardNumber,
      expMonth,
      expYear,
      cvc,
    });

    // Save to database
    const userId = await saveToDatabaseWithPayment(
      discordId,
      discordUsername || undefined,
      authToken,
      paymentMethodId
    );

    console.log("");
    console.log("=".repeat(60));
    console.log("SUCCESS!");
    console.log("=".repeat(60));
    console.log(`User ID: ${userId}`);
    console.log(`Discord ID: ${discordId}`);
    console.log(`Auth Token: ${authToken}`);
    console.log(`Payment Method ID: ${paymentMethodId}`);
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\nError:", error);
    rl.close();
    process.exit(1);
  }

  rl.close();
}

main();
