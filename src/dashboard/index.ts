/**
 * CLI Dashboard for Resy Sniper Bot
 *
 * Read-only dashboard displaying:
 * - Upcoming schedule groups with restaurants
 * - Account list
 * - Proxy status (datacenter + ISP)
 * - Live action log
 *
 * Uses raw ANSI escape codes for maximum performance.
 * Double-buffered rendering with diff-based updates.
 */

import { ScreenBuffer } from "./buffer";
import {
  calculateLayout,
  getTerminalSize,
  isTerminalSufficient,
  type DashboardLayout,
} from "./layout";
import { cursor, screen, colors, writeLine } from "./renderer";
import {
  EventBridge,
  createEventBridge,
  type DashboardState,
} from "./event-bridge";

// Components
import { renderHeader } from "./components/header";
import { renderSchedule, type ScheduleData } from "./components/schedule";
import { renderAccounts, type AccountsData } from "./components/accounts";
import { renderProxies, type ProxiesData } from "./components/proxies";
import { renderStats, type StatsData } from "./components/stats";
import { renderLog, type LogData } from "./components/log";

// Data sources
import { store } from "../store";
import { calculateReleaseWindows } from "../services/scheduler";
import { getProxyManager } from "../services/proxy-manager";
import { getIspProxyPool } from "../services/isp-proxy-pool";
import { getBookingCoordinator } from "../services/booking-coordinator";

/**
 * Dashboard configuration
 */
export interface DashboardConfig {
  enabled?: boolean;
  refreshIntervalMs?: number;
}

/**
 * Dashboard class
 */
export class Dashboard {
  private buffer: ScreenBuffer;
  private layout: DashboardLayout;
  private eventBridge: EventBridge;
  private refreshTimer: Timer | null = null;
  private running = false;
  private enabled: boolean;
  private refreshIntervalMs: number;

  constructor(config: DashboardConfig = {}) {
    // Default: enabled if TTY and not explicitly disabled
    this.enabled = config.enabled ?? (process.stdout.isTTY ?? false);
    this.refreshIntervalMs = config.refreshIntervalMs ?? 1000;

    const { width, height } = getTerminalSize();
    this.layout = calculateLayout(width, height);
    this.buffer = new ScreenBuffer(width, height);

    // Create event bridge with state change callback
    this.eventBridge = createEventBridge({
      onStateChange: () => this.scheduleRender(),
    });
  }

  /**
   * Get the event bridge for wrapping callbacks
   */
  getEventBridge(): EventBridge {
    return this.eventBridge;
  }

  /**
   * Check if dashboard is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Start the dashboard
   */
  start(): void {
    if (!this.enabled) {
      return;
    }

    if (!isTerminalSufficient()) {
      writeLine(colors.yellow("Terminal too small for dashboard. Minimum: 60x20"));
      this.enabled = false;
      return;
    }

    this.running = true;

    // Enter alternate screen buffer
    screen.alternateBuffer();
    cursor.hide();
    screen.clear();

    // Handle terminal resize
    process.stdout.on("resize", () => this.handleResize());

    // Handle cleanup on exit
    process.on("exit", () => this.cleanup());
    process.on("SIGINT", () => {
      this.stop();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      this.stop();
      process.exit(0);
    });

    // Initial render
    this.render();

    // Start refresh timer for time updates
    this.refreshTimer = setInterval(() => {
      if (this.running) {
        this.render();
      }
    }, this.refreshIntervalMs);

    this.eventBridge.info("Dashboard started");
  }

  /**
   * Stop the dashboard
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    this.cleanup();
  }

  /**
   * Clean up terminal state
   */
  private cleanup(): void {
    cursor.show();
    screen.mainBuffer();
    screen.clear();
    cursor.moveToOrigin();
  }

  /**
   * Handle terminal resize
   */
  private handleResize(): void {
    const { width, height } = getTerminalSize();
    this.layout = calculateLayout(width, height);
    this.buffer.resize(width, height);
    screen.clear();
    this.buffer.forceRedraw();
    this.render();
  }

  /**
   * Schedule a render (debounced by event bridge)
   */
  private scheduleRender(): void {
    if (this.running) {
      // Use setTimeout to avoid blocking
      setTimeout(() => this.render(), 0);
    }
  }

  /**
   * Render the dashboard
   */
  private render(): void {
    if (!this.running) return;

    this.buffer.clear();

    // Gather data
    const scheduleData = this.getScheduleData();
    const accountsData = this.getAccountsData();
    const proxiesData = this.getProxiesData();
    const statsData = this.getStatsData();
    const logData = this.getLogData();

    // Render components
    renderHeader(this.buffer, this.layout.header);
    renderSchedule(this.buffer, this.layout.schedule, scheduleData);
    renderProxies(this.buffer, this.layout.proxies, proxiesData);
    renderAccounts(this.buffer, this.layout.accounts, accountsData);
    renderStats(this.buffer, this.layout.stats, statsData);
    renderLog(this.buffer, this.layout.log, logData);

    // Flush to terminal
    this.buffer.flush();
  }

  /**
   * Get schedule data
   */
  private getScheduleData(): ScheduleData {
    const state = this.eventBridge.getState();
    const upcomingWindows = calculateReleaseWindows();

    return {
      upcomingWindows,
      activeWindow: state.activeScanWindow,
    };
  }

  /**
   * Get accounts data
   */
  private getAccountsData(): AccountsData {
    return {
      users: store.getAllUsers(),
    };
  }

  /**
   * Get proxies data
   */
  private getProxiesData(): ProxiesData {
    const proxyManager = getProxyManager();
    const ispPool = getIspProxyPool();

    return {
      datacenter: proxyManager.getStatus(),
      isp: ispPool.getStatus(),
    };
  }

  /**
   * Get stats data
   */
  private getStatsData(): StatsData {
    const state = this.eventBridge.getState();
    const coordinator = getBookingCoordinator();
    const coordStats = coordinator.getStats();

    return {
      activeProcessors: coordStats.activeProcessors,
      successfulBookings: state.successfulBookings,
      failedBookings: state.failedBookings,
      totalSlotsFound: state.totalSlotsFound,
      wafBlocks: state.wafBlocks,
      rateLimits: state.rateLimits,
    };
  }

  /**
   * Get log data
   */
  private getLogData(): LogData {
    const state = this.eventBridge.getState();
    return {
      entries: state.logEntries,
    };
  }
}

// Singleton instance
let dashboard: Dashboard | null = null;

/**
 * Create and get the dashboard singleton
 */
export function createDashboard(config?: DashboardConfig): Dashboard {
  if (!dashboard) {
    dashboard = new Dashboard(config);
  }
  return dashboard;
}

/**
 * Get the dashboard singleton (must be created first)
 */
export function getDashboard(): Dashboard | null {
  return dashboard;
}

// Re-export event bridge types for external use
export type { EventBridge, DashboardState, LogEntry, LogLevel } from "./event-bridge";
