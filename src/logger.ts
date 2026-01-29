/**
 * Centralized Logger
 *
 * Provides a shared pino logger that can be configured based on dashboard state.
 * When dashboard is enabled, logs are written to a file instead of stdout
 * to avoid breaking the ANSI-based UI.
 */
import pino from "pino";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

// Log file location
const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "sniper.log");

/**
 * Check if dashboard should be enabled
 * Dashboard is enabled by default if TTY, unless explicitly disabled
 */
function shouldEnableDashboard(): boolean {
  const envValue = process.env.DASHBOARD_ENABLED?.toLowerCase();
  if (envValue === "false") return false;
  return process.stdout.isTTY ?? false;
}

/**
 * Create the appropriate logger based on dashboard state
 */
function createLogger(): pino.Logger {
  const dashboardEnabled = shouldEnableDashboard();

  if (dashboardEnabled) {
    // Dashboard is enabled - write logs to file to avoid breaking UI
    // Ensure log directory exists
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }

    return pino(
      {
        level: process.env.LOG_LEVEL || "info",
      },
      pino.destination({
        dest: LOG_FILE,
        sync: false, // Async for performance
      })
    );
  } else {
    // Dashboard is disabled - use pretty console output
    return pino({
      level: process.env.LOG_LEVEL || "info",
      transport: {
        target: "pino-pretty",
        options: { colorize: true },
      },
    });
  }
}

// Create and export the singleton logger
export const logger = createLogger();

/**
 * Get the log file path (useful for telling users where logs are)
 */
export function getLogFilePath(): string {
  return LOG_FILE;
}

/**
 * Check if logging to file (dashboard mode)
 */
export function isLoggingToFile(): boolean {
  return shouldEnableDashboard();
}
