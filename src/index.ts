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
import { getAccountReservationChecker } from "./services/account-reservation-checker";
import { getProxyManager } from "./services/proxy-manager";
import { checkResyIPOrExit } from "./services/ip-check";
import { createDashboard } from "./dashboard";
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

  // Initialize dashboard (before other services to capture early events)
  const dashboard = createDashboard({ enabled: config.DASHBOARD_ENABLED });
  const eventBridge = dashboard.getEventBridge();

  // Initialize Discord bot
  const discordBot = getDiscordBot({
    token: config.DISCORD_BOT_TOKEN,
    clientId: config.DISCORD_CLIENT_ID,
  });

  await discordBot.start();

  // Initialize notifier with webhook URL
  initializeNotifier(config.DISCORD_WEBHOOK_URL);

  // Initialize booking coordinator (push-based architecture)
  // Wrap callbacks with event bridge for dashboard logging
  const coordinator = getBookingCoordinator({
    apiKey: config.RESY_API_KEY,
    dryRun: config.DRY_RUN,
    onBookingSuccess: eventBridge.wrapSuccess(async (result) => {
      const notifier = getNotifier();
      if (notifier) {
        await notifier.notifyBookingSuccess(result);
      }
    }),
    onBookingFailed: eventBridge.wrapFailed(async (result) => {
      const notifier = getNotifier();
      if (notifier) {
        await notifier.notifyBookingFailed(result);
      }
    }),
  });

  // Initialize coordinator (sets up ISP proxy pool)
  coordinator.initialize();

  // Initialize scanner with push-based callbacks
  // Wrap callbacks with event bridge for dashboard logging
  const scanner = getScanner({
    scanIntervalMs: config.SCAN_INTERVAL_MS,
    scanTimeoutSeconds: config.SCAN_TIMEOUT_SECONDS,
    apiKey: config.RESY_API_KEY,

    // Push model: slots are emitted immediately to coordinator
    onSlotsDiscovered: eventBridge.wrapSlotsDiscovered((slots, restaurant) => {
      logger.info(
        {
          restaurant: restaurant.name,
          slotsFound: slots.length,
        },
        "Slots discovered - forwarding to coordinator"
      );
      coordinator.onSlotsDiscovered(slots, restaurant);
    }),

    // Called when scan window completes
    onScanComplete: eventBridge.wrapScanComplete(async (window: ReleaseWindow, stats: ScanStats) => {
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

      // Notify via webhook of scan summary
      const notifier = getNotifier();
      if (notifier) {
        const summary = [
          `**Scan Complete** - ${window.releaseTime}`,
          `Target date: ${window.targetDate}`,
          `Duration: ${(stats.elapsedMs / 1000).toFixed(1)}s`,
          `Iterations: ${stats.totalIterations}`,
          `Slots found: ${stats.totalSlotsFound}`,
          `Restaurants with slots: ${stats.restaurantsWithSlots}/${window.restaurants.length}`,
          `Active processors: ${coordinator.getStats().activeProcessors}`,
          `Successful bookings: ${coordinator.getStats().successfulBookings}`,
        ].join("\n");

        await notifier.notifyAdmin("Scan Complete", summary);
      }
    }),
  });

  // Initialize account reservation checker (uses datacenter proxies)
  const proxyManager = getProxyManager();
  const reservationChecker = getAccountReservationChecker(proxyManager);

  // Initialize scheduler
  // Wrap onWindowStart with event bridge for dashboard logging
  const scheduler = getScheduler({
    scanStartSecondsBefore: config.SCAN_START_SECONDS_BEFORE,
    onWindowStart: eventBridge.wrapWindowStart(async (window: ReleaseWindow) => {
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

      // Prefetch existing reservations to exclude accounts with conflicts
      try {
        const exclusions = await reservationChecker.prefetchReservations(
          window.subscriptions,
          window.targetDate
        );
        coordinator.setAccountExclusions(exclusions);

        // Count how many users will be excluded
        let excludedCount = 0;
        for (const [userId] of exclusions.reservationsByUser) {
          if (reservationChecker.shouldExcludeUser(exclusions, userId, window.targetDate)) {
            excludedCount++;
          }
        }

        logger.info(
          {
            totalAccounts: exclusions.totalAccounts,
            excludedCount,
            successfulFetches: exclusions.successfulFetches,
            failedFetches: exclusions.failedFetches,
          },
          "Account reservation prefetch complete"
        );
      } catch (error) {
        logger.error(
          { error: String(error) },
          "Prefetch failed - continuing without exclusions (fail-open)"
        );
      }

      // Notify via webhook that scanning started
      const notifier = getNotifier();
      if (notifier) {
        const restaurantNames = [...new Set(window.subscriptions.map((s) => s.restaurant_name))];
        await notifier.notifyScanStarted(
          "",
          restaurantNames,
          window.targetDate,
          window.releaseTime
        );
      }

      // Start scanning - runs in background, emits slots via callback
      scanner.startScan(window);
    }),
  });

  scheduler.start();

  // Start dashboard (if enabled)
  dashboard.start();

  logger.info(
    {
      dryRun: config.DRY_RUN,
      scanInterval: config.SCAN_INTERVAL_MS,
      scanTimeout: config.SCAN_TIMEOUT_SECONDS,
      scanStartBefore: config.SCAN_START_SECONDS_BEFORE,
      architecture: "push-based",
      dashboardEnabled: dashboard.isEnabled(),
    },
    "Big Daddy Sniper started successfully"
  );

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Received shutdown signal");
    dashboard.stop();
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
