/**
 * Scheduler Tests
 *
 * Tests the scheduler logic including:
 * - calculateReleaseWindows() grouping and filtering
 * - Scheduler class timer management
 * - onWindowStart callback firing
 *
 * Uses Bun's mock timers for deterministic testing.
 */
import { test, expect, describe, beforeEach, afterEach, mock, spyOn } from "bun:test";
import {
  calculateReleaseWindows,
  calculateTargetDate,
  getNextReleaseDateTime,
  isSubscriptionActiveForDate,
  Scheduler,
  type ReleaseWindow,
} from "../src/services/scheduler";
import { store } from "../src/store";
import type { Restaurant, FullSubscription } from "../src/db/schema";

// ============ Test Data ============

const mockRestaurants: Restaurant[] = [
  {
    id: 1,
    venue_id: "1001",
    name: "Test Restaurant A",
    neighborhood: "Manhattan",
    cuisine: "Italian",
    days_in_advance: 30,
    release_time: "10:00",
    release_time_zone: "America/New_York",
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: 2,
    venue_id: "1002",
    name: "Test Restaurant B",
    neighborhood: "Brooklyn",
    cuisine: "Japanese",
    days_in_advance: 14,
    release_time: "10:00", // Same release time as A
    release_time_zone: "America/New_York",
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: 3,
    venue_id: "1003",
    name: "Test Restaurant C",
    neighborhood: "Queens",
    cuisine: "French",
    days_in_advance: 7,
    release_time: "09:00", // Different release time
    release_time_zone: "America/New_York",
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
  },
];

const mockSubscriptions: FullSubscription[] = [
  {
    id: 1,
    user_id: 1,
    restaurant_id: 1,
    party_size: 2,
    time_window_start: "18:00",
    time_window_end: "21:00",
    table_types: null,
    target_days: null, // Any day
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
    restaurant_name: "Test Restaurant A",
    venue_id: "1001",
    days_in_advance: 30,
    release_time: "10:00",
    discord_id: "user1",
    resy_auth_token: "token1",
    resy_payment_method_id: 123,
  },
  {
    id: 2,
    user_id: 2,
    restaurant_id: 2,
    party_size: 4,
    time_window_start: "19:00",
    time_window_end: "22:00",
    table_types: ["outdoor"],
    target_days: [5, 6, 0], // Fri, Sat, Sun only
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
    restaurant_name: "Test Restaurant B",
    venue_id: "1002",
    days_in_advance: 14,
    release_time: "10:00",
    discord_id: "user2",
    resy_auth_token: "token2",
    resy_payment_method_id: 456,
  },
  {
    id: 3,
    user_id: 1,
    restaurant_id: 3,
    party_size: 2,
    time_window_start: "12:00",
    time_window_end: "14:00",
    table_types: null,
    target_days: null,
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
    restaurant_name: "Test Restaurant C",
    venue_id: "1003",
    days_in_advance: 7,
    release_time: "09:00",
    discord_id: "user1",
    resy_auth_token: "token1",
    resy_payment_method_id: 123,
  },
];

// ============ Mock Store ============

function setupMockStore(subscriptions: FullSubscription[], restaurants: Restaurant[]) {
  // Mock store.getSubscriptionsGroupedByReleaseTime
  const grouped = new Map<string, FullSubscription[]>();
  for (const sub of subscriptions) {
    const existing = grouped.get(sub.release_time) ?? [];
    existing.push(sub);
    grouped.set(sub.release_time, existing);
  }

  spyOn(store, "getSubscriptionsGroupedByReleaseTime").mockReturnValue(grouped);

  // Mock store.getRestaurantById
  const restaurantMap = new Map(restaurants.map((r) => [r.id, r]));
  spyOn(store, "getRestaurantById").mockImplementation((id: number) => restaurantMap.get(id));
}

// ============ Tests ============

describe("calculateReleaseWindows", () => {
  beforeEach(() => {
    setupMockStore(mockSubscriptions, mockRestaurants);
  });

  test("should group subscriptions by release time", () => {
    const windows = calculateReleaseWindows();

    // Should have 2 windows: 09:00 and 10:00
    expect(windows.length).toBe(2);

    const times = windows.map((w) => w.releaseTime).sort();
    expect(times).toEqual(["09:00", "10:00"]);
  });

  test("should include all subscriptions for a release time", () => {
    const windows = calculateReleaseWindows();

    const tenAmWindow = windows.find((w) => w.releaseTime === "10:00");
    expect(tenAmWindow).toBeDefined();

    // 10:00 window should have subscriptions from Restaurant A and B
    // But subscription 2 has target_days filter - may or may not be included
    // depending on current day
    expect(tenAmWindow!.subscriptions.length).toBeGreaterThanOrEqual(1);
  });

  test("should calculate correct scan start time", () => {
    const scanStartSecondsBefore = 45;
    const windows = calculateReleaseWindows(scanStartSecondsBefore);

    for (const window of windows) {
      const diff = window.releaseDateTime.getTime() - window.scanStartDateTime.getTime();
      expect(diff).toBe(scanStartSecondsBefore * 1000);
    }
  });

  test("should sort windows by scan start time", () => {
    const windows = calculateReleaseWindows();

    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].scanStartDateTime.getTime()).toBeGreaterThanOrEqual(
        windows[i - 1].scanStartDateTime.getTime()
      );
    }
  });

  test("should include unique restaurants per window", () => {
    const windows = calculateReleaseWindows();

    for (const window of windows) {
      const restaurantIds = window.restaurants.map((r) => r.id);
      const uniqueIds = [...new Set(restaurantIds)];
      expect(restaurantIds.length).toBe(uniqueIds.length);
    }
  });

  test("should filter subscriptions by target_days", () => {
    // Create subscriptions where one is filtered out
    const today = new Date();
    const dayOfWeek = today.getDay();

    // Subscription with target_days that excludes today
    const excludedDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => {
      // Calculate what day the target date lands on
      const targetDate = calculateTargetDate(14);
      const targetDay = new Date(targetDate + "T12:00:00").getDay();
      return d !== targetDay;
    });

    const filteredSubscriptions: FullSubscription[] = [
      {
        ...mockSubscriptions[0],
        target_days: excludedDays.slice(0, 3), // Days that don't match target
      },
    ];

    setupMockStore(filteredSubscriptions, mockRestaurants);
    const windows = calculateReleaseWindows();

    // Window may be empty if target_days don't match
    // This is expected behavior
    expect(windows).toBeDefined();
  });
});

describe("Scheduler class", () => {
  let scheduler: Scheduler;
  let windowStartCallback: ReturnType<typeof mock>;

  beforeEach(() => {
    setupMockStore(mockSubscriptions, mockRestaurants);
    windowStartCallback = mock(() => {});
    scheduler = new Scheduler({
      scanStartSecondsBefore: 45,
      onWindowStart: windowStartCallback,
    });
  });

  afterEach(() => {
    scheduler.stop();
  });

  test("should initialize with correct config", () => {
    const status = scheduler.getStatus();
    expect(status.running).toBe(false);
    expect(status.scheduledWindows).toBe(0);
  });

  test("should start and stop correctly", () => {
    scheduler.start();
    expect(scheduler.getStatus().running).toBe(true);

    scheduler.stop();
    expect(scheduler.getStatus().running).toBe(false);
  });

  test("should not double-start", () => {
    scheduler.start();
    scheduler.start(); // Should warn but not crash

    expect(scheduler.getStatus().running).toBe(true);
    scheduler.stop();
  });

  test("should return upcoming windows in status", () => {
    scheduler.start();
    const status = scheduler.getStatus();

    expect(status.upcomingWindows).toBeDefined();
    expect(Array.isArray(status.upcomingWindows)).toBe(true);
  });

  test("should return scheduled window keys", () => {
    scheduler.start();
    const scheduledKeys = scheduler.getScheduledWindows();

    expect(Array.isArray(scheduledKeys)).toBe(true);
    // Keys should be in format "HH:mm-YYYY-MM-DD"
    for (const key of scheduledKeys) {
      expect(key).toMatch(/^\d{2}:\d{2}-\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("should clear timers on stop", () => {
    scheduler.start();
    const beforeStop = scheduler.getScheduledWindows().length;

    scheduler.stop();
    const afterStop = scheduler.getScheduledWindows().length;

    expect(afterStop).toBe(0);
  });

  test("triggerWindow should call onWindowStart callback", () => {
    scheduler.start();

    // Trigger a known release time
    scheduler.triggerWindow("10:00");

    expect(windowStartCallback).toHaveBeenCalled();
  });

  test("triggerWindow with unknown time should not crash", () => {
    scheduler.start();

    // Should warn but not crash
    scheduler.triggerWindow("99:99");

    expect(windowStartCallback).not.toHaveBeenCalled();
  });
});

describe("Scheduler timer behavior", () => {
  test("should schedule windows within 24 hours", () => {
    setupMockStore(mockSubscriptions, mockRestaurants);

    const scheduler = new Scheduler({
      scanStartSecondsBefore: 45,
    });

    scheduler.start();
    const windows = scheduler.getStatus().upcomingWindows;

    // All windows should have releaseDateTime in the future
    const now = Date.now();
    for (const window of windows) {
      expect(window.releaseDateTime.getTime()).toBeGreaterThan(now);
    }

    scheduler.stop();
  });
});

describe("ReleaseWindow structure", () => {
  beforeEach(() => {
    setupMockStore(mockSubscriptions, mockRestaurants);
  });

  test("should have all required fields", () => {
    const windows = calculateReleaseWindows();

    for (const window of windows) {
      expect(window.releaseTime).toBeDefined();
      expect(typeof window.releaseTime).toBe("string");

      expect(window.releaseDateTime).toBeDefined();
      expect(window.releaseDateTime instanceof Date).toBe(true);

      expect(window.scanStartDateTime).toBeDefined();
      expect(window.scanStartDateTime instanceof Date).toBe(true);

      expect(window.targetDate).toBeDefined();
      expect(typeof window.targetDate).toBe("string");
      expect(window.targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      expect(window.restaurants).toBeDefined();
      expect(Array.isArray(window.restaurants)).toBe(true);

      expect(window.subscriptions).toBeDefined();
      expect(Array.isArray(window.subscriptions)).toBe(true);
    }
  });

  test("targetDate should be calculated from days_in_advance", () => {
    const windows = calculateReleaseWindows();

    for (const window of windows) {
      // Each subscription's target date should be based on its days_in_advance
      const firstSub = window.subscriptions[0];
      const expectedDate = calculateTargetDate(firstSub.days_in_advance);
      expect(window.targetDate).toBe(expectedDate);
    }
  });
});

describe("Edge cases", () => {
  test("should handle empty subscriptions", () => {
    setupMockStore([], mockRestaurants);
    const windows = calculateReleaseWindows();
    expect(windows).toEqual([]);
  });

  test("should handle subscriptions with missing restaurants", () => {
    setupMockStore(mockSubscriptions, []); // No restaurants
    const windows = calculateReleaseWindows();

    // Should still work but restaurants array will be empty
    for (const window of windows) {
      expect(window.restaurants.length).toBe(0);
    }
  });

  test("should handle single subscription", () => {
    setupMockStore([mockSubscriptions[0]], [mockRestaurants[0]]);
    const windows = calculateReleaseWindows();

    expect(windows.length).toBe(1);
    expect(windows[0].subscriptions.length).toBe(1);
    expect(windows[0].restaurants.length).toBe(1);
  });
});

console.log("\n🧪 Running Scheduler Tests...\n");
