import { z } from "zod";

/**
 * Application configuration for Big Daddy Sniper
 */
export const AppConfigSchema = z.object({
  // Core Resy API
  RESY_API_KEY: z.string().min(1),

  // Discord Bot
  DISCORD_BOT_TOKEN: z.string().min(1).describe("Discord bot token"),
  DISCORD_CLIENT_ID: z.string().min(1).describe("Discord application client ID"),
  DISCORD_ADMIN_ID: z
    .string()
    .optional()
    .describe("Discord user ID for admin notifications"),
  DISCORD_WEBHOOK_URL: z
    .string()
    .optional()
    .describe("Discord webhook URL for booking notifications"),

  // Database (Supabase)
  SUPABASE_URL: z.string().min(1).describe("Supabase project URL"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1)
    .describe("Supabase service role key (for server-side access)"),

  // Scheduler Configuration
  SCAN_START_SECONDS_BEFORE: z.coerce
    .number()
    .int()
    .default(45)
    .describe("Seconds before release time to start scanning"),
  SCAN_INTERVAL_MS: z.coerce
    .number()
    .int()
    .default(1000)
    .describe("Milliseconds between scan attempts"),
  SCAN_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .default(120)
    .describe("Seconds after release to stop scanning"),

  // Runtime options
  DRY_RUN: z
    .string()
    .optional()
    .transform((val) => val?.toLowerCase() === "true")
    .describe("Skip actual booking (for testing)"),

  // Proxy settings
  USE_PROXIES: z
    .string()
    .optional()
    .transform((val) => val?.toLowerCase() === "true")
    .describe("Enable proxy rotation (adds ~600ms latency)"),

  // Dashboard settings
  DASHBOARD_ENABLED: z
    .string()
    .optional()
    .transform((val) => val?.toLowerCase() !== "false")
    .describe("Enable CLI dashboard (default: true if TTY)"),

  // Passive Monitor settings
  PASSIVE_MONITOR_ENABLED: z
    .string()
    .optional()
    .transform((val) => val?.toLowerCase() === "true")
    .describe("Enable passive calendar monitoring for availability"),
  PASSIVE_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .default(60000)
    .describe("Milliseconds between passive calendar polls"),
  PASSIVE_BLACKOUT_MINUTES: z.coerce
    .number()
    .int()
    .default(5)
    .describe("Minutes around release times to pause passive monitoring"),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// Load and validate
export const config = AppConfigSchema.parse(process.env);

/**
 * Validate all required config is present
 */
export function validateConfig(): void {
  // Zod already validates required fields, but we can add extra checks here
  if (!config.DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN is required");
  }
  if (!config.DISCORD_CLIENT_ID) {
    throw new Error("DISCORD_CLIENT_ID is required");
  }
  if (!config.SUPABASE_URL) {
    throw new Error("SUPABASE_URL is required");
  }
  if (!config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }
}
