/**
 * Event Bridge
 *
 * Hooks into scanner/coordinator events without modifying hot paths.
 * Debounces rapid events and logs to ring buffer.
 */

import type { DiscoveredSlot } from "../services/scanner";
import type { Restaurant } from "../db/schema";
import type { UserBookingResult } from "../services/booking-coordinator";
import type { ReleaseWindow } from "../services/scheduler";
import type { ScanStats } from "../services/scanner";

/**
 * Log entry levels
 */
export type LogLevel = "info" | "success" | "warn" | "error";

/**
 * Log entry structure
 */
export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Dashboard state updated by events
 */
export interface DashboardState {
  // Current scan window
  activeScanWindow: ReleaseWindow | null;
  scanStartedAt: Date | null;

  // Stats
  totalSlotsFound: number;
  totalBookingAttempts: number;
  successfulBookings: number;
  failedBookings: number;
  wafBlocks: number;
  rateLimits: number;

  // Passive monitor state
  passiveMonitor: {
    enabled: boolean;
    running: boolean;
    lastPollAt: Date | null;
    pollErrors: number;
    datesFound: number;
  };

  // Log entries (ring buffer)
  logEntries: LogEntry[];
}

/**
 * Event bridge configuration
 */
export interface EventBridgeConfig {
  maxLogEntries?: number;
  debounceMs?: number;
  onStateChange?: () => void;
}

/**
 * Ring buffer for log entries
 */
class RingBuffer<T> {
  private buffer: T[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  push(item: T): void {
    this.buffer.push(item);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  getAll(): T[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer = [];
  }

  get length(): number {
    return this.buffer.length;
  }
}

/**
 * Event bridge class
 */
export class EventBridge {
  private state: DashboardState;
  private logBuffer: RingBuffer<LogEntry>;
  private onStateChange?: () => void;
  private debounceMs: number;
  private debounceTimer: Timer | null = null;
  private pendingStateChange = false;

  constructor(config: EventBridgeConfig = {}) {
    this.debounceMs = config.debounceMs ?? 16; // ~60fps
    this.onStateChange = config.onStateChange;
    this.logBuffer = new RingBuffer(config.maxLogEntries ?? 200);

    this.state = {
      activeScanWindow: null,
      scanStartedAt: null,
      totalSlotsFound: 0,
      totalBookingAttempts: 0,
      successfulBookings: 0,
      failedBookings: 0,
      wafBlocks: 0,
      rateLimits: 0,
      passiveMonitor: {
        enabled: false,
        running: false,
        lastPollAt: null,
        pollErrors: 0,
        datesFound: 0,
      },
      logEntries: [],
    };
  }

  /**
   * Get current state
   */
  getState(): DashboardState {
    return {
      ...this.state,
      logEntries: this.logBuffer.getAll(),
    };
  }

  /**
   * Add a log entry
   */
  log(level: LogLevel, message: string, details?: Record<string, unknown>): void {
    this.logBuffer.push({
      timestamp: new Date(),
      level,
      message,
      details,
    });
    this.notifyStateChange();
  }

  /**
   * Trigger state change notification (debounced)
   */
  private notifyStateChange(): void {
    if (this.pendingStateChange) return;

    this.pendingStateChange = true;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.pendingStateChange = false;
      this.state.logEntries = this.logBuffer.getAll();
      this.onStateChange?.();
    }, this.debounceMs);
  }

  /**
   * Reset state for new scan window
   */
  reset(): void {
    // Preserve passive monitor state across resets
    const passiveMonitorState = this.state.passiveMonitor;

    this.state = {
      activeScanWindow: null,
      scanStartedAt: null,
      totalSlotsFound: 0,
      totalBookingAttempts: 0,
      successfulBookings: 0,
      failedBookings: 0,
      wafBlocks: 0,
      rateLimits: 0,
      passiveMonitor: passiveMonitorState,
      logEntries: [],
    };
    // Keep log buffer for continuity
    this.notifyStateChange();
  }

  // ============ Event Wrapper Functions ============

  /**
   * Wrap onWindowStart callback
   */
  wrapWindowStart<T extends (window: ReleaseWindow) => void | Promise<void>>(
    originalCallback: T
  ): T {
    return (async (window: ReleaseWindow) => {
      this.state.activeScanWindow = window;
      this.state.scanStartedAt = new Date();

      const restaurantNames = window.restaurants.map((r) => r.name).slice(0, 3);
      const moreCount = Math.max(0, window.restaurants.length - 3);
      const restaurantStr =
        restaurantNames.join(", ") + (moreCount > 0 ? ` +${moreCount} more` : "");

      this.log("info", `SCAN STARTED: ${window.releaseTime} - ${restaurantStr}`, {
        releaseTime: window.releaseTime,
        targetDate: window.targetDate,
        restaurantCount: window.restaurants.length,
      });

      this.notifyStateChange();

      return originalCallback(window);
    }) as T;
  }

  /**
   * Wrap onSlotsDiscovered callback
   */
  wrapSlotsDiscovered<T extends (slots: DiscoveredSlot[], restaurant: Restaurant) => void>(
    originalCallback: T
  ): T {
    return ((slots: DiscoveredSlot[], restaurant: Restaurant) => {
      this.state.totalSlotsFound += slots.length;

      const times = slots.slice(0, 3).map((s) => s.slot.time);
      const moreCount = Math.max(0, slots.length - 3);
      const timeStr = times.join(", ") + (moreCount > 0 ? ` +${moreCount} more` : "");

      this.log("success", `SLOTS: ${restaurant.name} - ${slots.length} found (${timeStr})`, {
        restaurant: restaurant.name,
        slotCount: slots.length,
        times: slots.map((s) => s.slot.time),
      });

      this.notifyStateChange();

      return originalCallback(slots, restaurant);
    }) as T;
  }

  /**
   * Wrap onScanComplete callback
   */
  wrapScanComplete<T extends (window: ReleaseWindow, stats: ScanStats) => void | Promise<void>>(
    originalCallback: T
  ): T {
    return (async (window: ReleaseWindow, stats: ScanStats) => {
      this.log(
        "info",
        `SCAN COMPLETE: ${stats.totalSlotsFound} slots, ${stats.restaurantsWithSlots}/${window.restaurants.length} restaurants`,
        {
          totalIterations: stats.totalIterations,
          totalSlotsFound: stats.totalSlotsFound,
          elapsedMs: stats.elapsedMs,
        }
      );

      this.state.activeScanWindow = null;
      this.notifyStateChange();

      return originalCallback(window, stats);
    }) as T;
  }

  /**
   * Wrap onBookingSuccess callback
   */
  wrapSuccess<T extends (result: UserBookingResult) => void | Promise<void>>(
    originalCallback: T
  ): T {
    return (async (result: UserBookingResult) => {
      this.state.successfulBookings++;
      this.state.totalBookingAttempts++;

      const time = result.bookedSlot?.slot.time ?? "unknown";
      const restaurant = result.bookedSlot?.restaurant.name ?? "unknown";

      this.log(
        "success",
        `BOOKED: ${restaurant} @ ${time} - Res #${result.reservationId}`,
        {
          userId: result.userId,
          restaurant,
          time,
          reservationId: result.reservationId,
        }
      );

      this.notifyStateChange();

      return originalCallback(result);
    }) as T;
  }

  /**
   * Wrap onBookingFailed callback
   */
  wrapFailed<T extends (result: UserBookingResult) => void | Promise<void>>(
    originalCallback: T
  ): T {
    return (async (result: UserBookingResult) => {
      this.state.failedBookings++;
      this.state.totalBookingAttempts++;

      const restaurant = result.bookedSlot?.restaurant.name ?? "unknown";
      const error = result.errorMessage ?? "unknown error";

      // Detect specific failure types
      if (error.toLowerCase().includes("waf")) {
        this.state.wafBlocks++;
        this.log("warn", `WAF BLOCK: ${restaurant} - retrying`, {
          userId: result.userId,
          restaurant,
          error,
        });
      } else if (error.toLowerCase().includes("rate")) {
        this.state.rateLimits++;
        this.log("warn", `RATE LIMIT: User ${result.userId} stopped`, {
          userId: result.userId,
          restaurant,
          error,
        });
      } else {
        this.log("error", `FAILED: ${restaurant} - ${error}`, {
          userId: result.userId,
          restaurant,
          error,
        });
      }

      this.notifyStateChange();

      return originalCallback(result);
    }) as T;
  }

  /**
   * Log ISP proxy events
   */
  logProxyAcquired(proxyId: number, available: number): void {
    this.log("info", `ISP: Acquired #${proxyId} (${available} avail)`, {
      proxyId,
      available,
    });
  }

  logProxyCooldown(proxyId: number, durationMin: number): void {
    this.state.wafBlocks++;
    this.log("warn", `ISP: #${proxyId} cooldown ${durationMin}min`, {
      proxyId,
      durationMin,
    });
    this.notifyStateChange();
  }

  logProxyRestored(proxyId: number): void {
    this.log("info", `ISP: #${proxyId} restored from cooldown`, { proxyId });
  }

  /**
   * Log generic info message
   */
  info(message: string, details?: Record<string, unknown>): void {
    this.log("info", message, details);
  }

  /**
   * Log warning message
   */
  warn(message: string, details?: Record<string, unknown>): void {
    this.log("warn", message, details);
  }

  /**
   * Log error message
   */
  error(message: string, details?: Record<string, unknown>): void {
    this.log("error", message, details);
  }

  // ============ Passive Monitor Events ============

  /**
   * Set passive monitor enabled state
   */
  setPassiveMonitorEnabled(enabled: boolean): void {
    this.state.passiveMonitor.enabled = enabled;
    this.notifyStateChange();
  }

  /**
   * Update passive monitor running state
   */
  setPassiveMonitorRunning(running: boolean): void {
    this.state.passiveMonitor.running = running;
    if (running) {
      this.log("info", "PASSIVE: Monitor started");
    } else {
      this.log("info", "PASSIVE: Monitor stopped");
    }
    this.notifyStateChange();
  }

  /**
   * Log passive monitor poll
   */
  logPassivePoll(targetsPolled: number): void {
    this.state.passiveMonitor.lastPollAt = new Date();
    this.notifyStateChange();
  }

  /**
   * Log passive monitor availability found
   */
  logPassiveAvailability(restaurant: string, date: string, slotsCount: number): void {
    this.state.passiveMonitor.datesFound++;
    this.log("success", `PASSIVE: ${restaurant} - ${slotsCount} slots on ${date}`, {
      restaurant,
      date,
      slotsCount,
    });
    this.notifyStateChange();
  }

  /**
   * Log passive monitor error
   */
  logPassiveError(restaurant: string, error: string): void {
    this.state.passiveMonitor.pollErrors++;
    this.log("warn", `PASSIVE: ${restaurant} - ${error}`, {
      restaurant,
      error,
    });
    this.notifyStateChange();
  }

  /**
   * Log passive monitor blackout
   */
  logPassiveBlackout(): void {
    this.log("info", "PASSIVE: Paused for release window");
  }
}

// Singleton instance
let eventBridge: EventBridge | null = null;

/**
 * Get event bridge singleton
 */
export function getEventBridge(config?: EventBridgeConfig): EventBridge {
  if (!eventBridge) {
    eventBridge = new EventBridge(config);
  }
  return eventBridge;
}

/**
 * Create a new event bridge (for testing)
 */
export function createEventBridge(config?: EventBridgeConfig): EventBridge {
  return new EventBridge(config);
}
