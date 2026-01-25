/**
 * Big Daddy Sniper - Entry Point
 *
 * Multi-user reservation sniper with Discord bot interface and Supabase backend.
 */
import { config, validateConfig } from "./config";
import { initializeSupabase, closeSupabase } from "./db/supabase";
import { store } from "./store";
import { getDiscordBot } from "./discord/bot";
import { initializeNotifier, getNotifier } from "./discord/notifications";
import { getScheduler, type ReleaseWindow } from "./services/scheduler";
import { getScanner, type ScanResult } from "./services/scanner";
import { getExecutor } from "./services/executor";
import { checkResyIPOrExit } from "./services/ip-check";
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

/**
 * Main entry point
 */
async function main(): Promise<void> {
  logger.info("Starting Big Daddy Sniper...");

  // Validate configuration
  validateConfig();

  // Check if IP is banned by Resy (fail fast)
  await checkResyIPOrExit();

  // Initialize Supabase connection
  initializeSupabase();
  logger.info("Supabase connection initialized");

  // Bootstrap in-memory store from database
  await store.initialize();
  logger.info(
    {
      restaurants: store.getStatus().counts.restaurants,
      users: store.getStatus().counts.users,
      subscriptions: store.getStatus().counts.subscriptions,
      proxies: store.getStatus().counts.proxies,
    },
    "In-memory store initialized from Supabase"
  );

  // Initialize Discord bot
  const discordBot = getDiscordBot({
    token: config.DISCORD_BOT_TOKEN,
    clientId: config.DISCORD_CLIENT_ID,
  });

  await discordBot.start();

  // Initialize notifier with Discord client
  initializeNotifier(discordBot.getClient(), config.DISCORD_ADMIN_ID);

  // Initialize executor with callbacks
  const executor = getExecutor({
    apiKey: config.RESY_API_KEY,
    dryRun: config.DRY_RUN,
    onBookingSuccess: async (result) => {
      const notifier = getNotifier();
      if (notifier) {
        await notifier.notifyBookingSuccess(result);
      }
    },
    onBookingFailed: async (result) => {
      const notifier = getNotifier();
      if (notifier) {
        await notifier.notifyBookingFailed(result);
      }
    },
  });

  // Initialize scanner
  const scanner = getScanner({
    scanIntervalMs: config.SCAN_INTERVAL_MS,
    scanTimeoutSeconds: config.SCAN_TIMEOUT_SECONDS,
    apiKey: config.RESY_API_KEY,
    onSlotsFound: async (result: ScanResult) => {
      logger.info(
        {
          releaseTime: result.window.releaseTime,
          targetDate: result.window.targetDate,
          slotsFound: result.slots.length,
        },
        "Slots found - executing bookings"
      );

      // Execute bookings for all subscribed users
      const bookingResults = await executor.execute(result);

      // Notify admin of cycle summary
      const notifier = getNotifier();
      if (notifier) {
        await notifier.notifyBookingCycleSummary(bookingResults);
      }
    },
  });

  // Initialize scheduler
  const scheduler = getScheduler({
    scanStartSecondsBefore: config.SCAN_START_SECONDS_BEFORE,
    onWindowStart: async (window: ReleaseWindow) => {
      logger.info(
        {
          releaseTime: window.releaseTime,
          targetDate: window.targetDate,
          restaurants: window.restaurants.map((r) => r.name),
        },
        "Window starting - beginning scan"
      );

      // Notify users that scanning started
      const notifier = getNotifier();
      if (notifier) {
        const userDiscordIds = new Set(
          window.subscriptions.map((s) => s.discord_id)
        );
        for (const discordId of userDiscordIds) {
          const userSubs = window.subscriptions.filter(
            (s) => s.discord_id === discordId
          );
          const restaurantNames = [
            ...new Set(userSubs.map((s) => s.restaurant_name)),
          ];
          await notifier.notifyScanStarted(
            discordId,
            restaurantNames,
            window.targetDate,
            window.releaseTime
          );
        }
      }

      // Start scanning
      await scanner.startScan(window);
    },
  });

  scheduler.start();

  logger.info(
    {
      dryRun: config.DRY_RUN,
      scanInterval: config.SCAN_INTERVAL_MS,
      scanTimeout: config.SCAN_TIMEOUT_SECONDS,
      scanStartBefore: config.SCAN_START_SECONDS_BEFORE,
    },
    "Big Daddy Sniper started successfully"
  );

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Received shutdown signal");
    scheduler.stop();
    scanner.stopAllScans();
    store.stopPeriodicSync();
    await discordBot.stop();
    await closeSupabase();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error({ error: String(error) }, "Fatal error starting bot");
  process.exit(1);
});
