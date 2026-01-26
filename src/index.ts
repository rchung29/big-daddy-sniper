/**
 * Big Daddy Sniper - Entry Point
 *
 * Multi-user reservation sniper with Discord bot interface and Supabase backend.
 *
 * Architecture (Push-based):
 * - Scheduler triggers scan windows 45s before release
 * - Scanner polls restaurants in parallel, emits slots immediately when found
 * - BookingCoordinator receives slots, deduplicates, fires booking attempts
 * - Scanner continues scanning non-completed restaurants for full 2-minute window
 */
import { config, validateConfig } from "./config";
import { initializeSupabase, closeSupabase } from "./db/supabase";
import { store } from "./store";
import { getDiscordBot } from "./discord/bot";
import { initializeNotifier, getNotifier } from "./discord/notifications";
import { getScheduler, type ReleaseWindow } from "./services/scheduler";
import { getScanner, type ScanStats } from "./services/scanner";
import { getBookingCoordinator } from "./services/booking-coordinator";
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

  // Initialize booking coordinator (push-based architecture)
  const coordinator = getBookingCoordinator({
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

  // Initialize scanner with push-based callbacks
  const scanner = getScanner({
    scanIntervalMs: config.SCAN_INTERVAL_MS,
    scanTimeoutSeconds: config.SCAN_TIMEOUT_SECONDS,
    apiKey: config.RESY_API_KEY,

    // Push model: slots are emitted immediately to coordinator
    onSlotsDiscovered: (slots, restaurant) => {
      logger.info(
        {
          restaurant: restaurant.name,
          slotsFound: slots.length,
        },
        "Slots discovered - forwarding to coordinator"
      );
      coordinator.onSlotsDiscovered(slots, restaurant);
    },

    // Called when scan window completes
    onScanComplete: async (window: ReleaseWindow, stats: ScanStats) => {
      logger.info(
        {
          releaseTime: window.releaseTime,
          targetDate: window.targetDate,
          totalIterations: stats.totalIterations,
          totalSlotsFound: stats.totalSlotsFound,
          restaurantsWithSlots: stats.restaurantsWithSlots,
          restaurantsWithoutSlots: stats.restaurantsWithoutSlots,
          elapsedMs: stats.elapsedMs,
          coordinatorStats: coordinator.getStats(),
        },
        "Scan window complete"
      );

      // Notify admin of scan summary
      const notifier = getNotifier();
      if (notifier && config.DISCORD_ADMIN_ID) {
        const summary = [
          `**Scan Complete** - ${window.releaseTime}`,
          `Target date: ${window.targetDate}`,
          `Duration: ${(stats.elapsedMs / 1000).toFixed(1)}s`,
          `Iterations: ${stats.totalIterations}`,
          `Slots found: ${stats.totalSlotsFound}`,
          `Restaurants with slots: ${stats.restaurantsWithSlots}/${window.restaurants.length}`,
          `Bookings attempted: ${coordinator.getStats().inFlightCount + coordinator.getStats().successfulBookings}`,
          `Successful bookings: ${coordinator.getStats().successfulBookings}`,
        ].join("\n");

        try {
          const adminUser = await discordBot.getClient().users.fetch(config.DISCORD_ADMIN_ID);
          await adminUser.send(summary);
        } catch (error) {
          logger.error({ error: String(error) }, "Failed to send admin summary");
        }
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

      // Reset coordinator state for new window
      coordinator.reset();

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

      // Start scanning - runs in background, emits slots via callback
      scanner.startScan(window);
    },
  });

  scheduler.start();

  logger.info(
    {
      dryRun: config.DRY_RUN,
      scanInterval: config.SCAN_INTERVAL_MS,
      scanTimeout: config.SCAN_TIMEOUT_SECONDS,
      scanStartBefore: config.SCAN_START_SECONDS_BEFORE,
      architecture: "push-based",
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
