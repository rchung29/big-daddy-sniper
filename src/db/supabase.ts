/**
 * Supabase client using @supabase/supabase-js
 *
 * Only used for:
 * - Bootstrap: Load all data into memory
 * - Periodic sync: Refresh memory every 5 minutes (outside blackout windows)
 * - Write-through: Persist changes (fire-and-forget)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

let supabase: SupabaseClient | null = null;

/**
 * Initialize the Supabase client
 */
export function initializeSupabase(): SupabaseClient {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("SUPABASE_URL environment variable is required");
  }
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY environment variable is required");
  }

  supabase = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  logger.info("Supabase client initialized");
  return supabase;
}

/**
 * Get the Supabase client (must be initialized first)
 */
export function getSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error("Supabase not initialized - call initializeSupabase() first");
  }
  return supabase;
}

/**
 * Close the connection (no-op for Supabase JS client, but keeps interface consistent)
 */
export async function closeSupabase(): Promise<void> {
  if (supabase) {
    supabase = null;
    logger.info("Supabase client closed");
  }
}

/**
 * Execute a query with error logging (for write-through operations)
 * Errors are logged but not thrown - fire and forget
 */
export async function executeWriteThrough<T>(
  operation: string,
  query: () => Promise<T>
): Promise<T | null> {
  try {
    return await query();
  } catch (error) {
    logger.error({ operation, error: String(error) }, "Write-through failed");
    return null;
  }
}
