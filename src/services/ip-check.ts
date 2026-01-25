/**
 * IP Health Check
 * Verifies the current IP is not banned/rate-limited by Resy
 */
import { ResyClient } from "../sdk";
import { ResyAPIError } from "../sdk/errors";
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

// Known venue for testing (Carbone NYC)
const TEST_VENUE_ID = 6194;

export interface IPCheckResult {
  success: boolean;
  status?: number;
  error?: string;
  latencyMs: number;
}

/**
 * Check if the current IP can reach Resy API
 * Uses findSlots endpoint which doesn't require user auth
 */
export async function checkResyIP(): Promise<IPCheckResult> {
  const client = new ResyClient();
  const startTime = Date.now();

  // Use tomorrow's date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = tomorrow.toISOString().split("T")[0];

  try {
    await client.findSlots({
      venue_id: TEST_VENUE_ID,
      day,
      party_size: 2,
    });

    const latencyMs = Date.now() - startTime;
    logger.info({ latencyMs }, "IP check passed - Resy API accessible");

    return {
      success: true,
      status: 200,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    if (error instanceof ResyAPIError) {
      if (error.status === 429) {
        logger.error({ status: 429, latencyMs }, "IP is rate limited by Resy");
        return {
          success: false,
          status: 429,
          error: "Rate limited (429)",
          latencyMs,
        };
      }

      if (error.status === 403) {
        logger.error({ status: 403, latencyMs }, "IP is banned by Resy");
        return {
          success: false,
          status: 403,
          error: "Banned (403)",
          latencyMs,
        };
      }

      logger.warn(
        { status: error.status, latencyMs, message: error.message },
        "Unexpected API error"
      );
      return {
        success: false,
        status: error.status,
        error: error.message,
        latencyMs,
      };
    }

    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg, latencyMs }, "Failed to reach Resy API");

    return {
      success: false,
      error: errorMsg,
      latencyMs,
    };
  }
}

/**
 * Check IP and exit if banned
 * Call this on startup to fail fast if IP is blocked
 */
export async function checkResyIPOrExit(): Promise<void> {
  logger.info("Checking Resy API accessibility...");

  const result = await checkResyIP();

  if (!result.success) {
    logger.error(
      {
        error: result.error,
        status: result.status,
        latencyMs: result.latencyMs,
      },
      "FATAL: Cannot reach Resy API - IP may be banned or rate limited"
    );
    process.exit(1);
  }

  logger.info({ latencyMs: result.latencyMs }, "Resy API check passed");
}
