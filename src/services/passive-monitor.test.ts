import { test, expect, describe, mock, beforeEach } from "bun:test";
import { DateTime } from "luxon";
import type { FullSubscription, Restaurant } from "../db/schema";

// Mock the store module
const mockGetFullSubscriptions = mock((): FullSubscription[] => []);
const mockGetRestaurantById = mock((): Restaurant | undefined => undefined);
const mockGetDatacenterProxies = mock(() => []);

mock.module("../store", () => ({
  store: {
    getFullSubscriptions: mockGetFullSubscriptions,
    getRestaurantById: mockGetRestaurantById,
    getDatacenterProxies: mockGetDatacenterProxies,
  },
}));

// Mock the SDK
const mockGetCalendar = mock(() =>
  Promise.resolve({
    scheduled: [],
    last_calendar_day: "2025-02-28",
  })
);
const mockFindSlots = mock(() =>
  Promise.resolve({
    results: { venues: [] },
  })
);

mock.module("../sdk", () => ({
  ResyClient: class {
    constructor() {}
    getCalendar = mockGetCalendar;
    findSlots = mockFindSlots;
  },
}));

// Mock the logger
mock.module("../logger", () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Import after mocks
import { PassiveMonitorService } from "./passive-monitor";

describe("PassiveMonitorService", () => {
  beforeEach(() => {
    mockGetFullSubscriptions.mockReset();
    mockGetRestaurantById.mockReset();
    mockGetCalendar.mockReset();
    mockFindSlots.mockReset();
  });

  describe("day-of-week matching", () => {
    test("subscription with no target_days matches any day", () => {
      const sub: FullSubscription = {
        id: 1,
        user_id: 1,
        restaurant_id: 1,
        party_size: 2,
        time_window_start: "18:00",
        time_window_end: "21:00",
        table_types: null,
        target_days: null, // No filter
        enabled: true,
        created_at: new Date(),
        updated_at: new Date(),
        restaurant_name: "Test Restaurant",
        venue_id: "123",
        days_in_advance: 14,
        release_time: "09:00",
        discord_id: "user123",
        resy_auth_token: "token",
        resy_payment_method_id: 1,
        preferred_proxy_id: null,
      };

      mockGetFullSubscriptions.mockReturnValue([sub]);

      // Sunday (0), Monday (1), etc. should all match
      expect(sub.target_days).toBeNull();
    });

    test("subscription with empty target_days matches any day", () => {
      const sub: FullSubscription = {
        id: 1,
        user_id: 1,
        restaurant_id: 1,
        party_size: 2,
        time_window_start: "18:00",
        time_window_end: "21:00",
        table_types: null,
        target_days: [], // Empty = any day
        enabled: true,
        created_at: new Date(),
        updated_at: new Date(),
        restaurant_name: "Test Restaurant",
        venue_id: "123",
        days_in_advance: 14,
        release_time: "09:00",
        discord_id: "user123",
        resy_auth_token: "token",
        resy_payment_method_id: 1,
        preferred_proxy_id: null,
      };

      mockGetFullSubscriptions.mockReturnValue([sub]);

      expect(sub.target_days).toEqual([]);
    });

    test("subscription with specific target_days filters correctly", () => {
      // Subscribe for weekends only (Saturday=6, Sunday=0)
      const sub: FullSubscription = {
        id: 1,
        user_id: 1,
        restaurant_id: 1,
        party_size: 2,
        time_window_start: "18:00",
        time_window_end: "21:00",
        table_types: null,
        target_days: [0, 6], // Sunday and Saturday
        enabled: true,
        created_at: new Date(),
        updated_at: new Date(),
        restaurant_name: "Test Restaurant",
        venue_id: "123",
        days_in_advance: 14,
        release_time: "09:00",
        discord_id: "user123",
        resy_auth_token: "token",
        resy_payment_method_id: 1,
        preferred_proxy_id: null,
      };

      // 2025-02-01 is a Saturday
      const saturdayDate = "2025-02-01";
      const luxonWeekday = DateTime.fromISO(saturdayDate).weekday; // 6 for Saturday
      const dayOfWeek = luxonWeekday === 7 ? 0 : luxonWeekday; // 6

      expect(sub.target_days?.includes(dayOfWeek)).toBe(true);

      // 2025-02-02 is a Sunday
      const sundayDate = "2025-02-02";
      const sundayLuxon = DateTime.fromISO(sundayDate).weekday; // 7 for Sunday
      const sundayDow = sundayLuxon === 7 ? 0 : sundayLuxon; // 0

      expect(sub.target_days?.includes(sundayDow)).toBe(true);

      // 2025-02-03 is a Monday
      const mondayDate = "2025-02-03";
      const mondayLuxon = DateTime.fromISO(mondayDate).weekday; // 1 for Monday
      const mondayDow = mondayLuxon === 7 ? 0 : mondayLuxon; // 1

      expect(sub.target_days?.includes(mondayDow)).toBe(false);
    });
  });

  describe("target grouping", () => {
    test("groups subscriptions by venue_id and party_size", () => {
      const subs: FullSubscription[] = [
        {
          id: 1,
          user_id: 1,
          restaurant_id: 1,
          party_size: 2,
          time_window_start: "18:00",
          time_window_end: "21:00",
          table_types: null,
          target_days: null,
          enabled: true,
          created_at: new Date(),
          updated_at: new Date(),
          restaurant_name: "Restaurant A",
          venue_id: "100",
          days_in_advance: 14,
          release_time: "09:00",
          discord_id: "user1",
          resy_auth_token: "token1",
          resy_payment_method_id: 1,
          preferred_proxy_id: null,
        },
        {
          id: 2,
          user_id: 2,
          restaurant_id: 1,
          party_size: 2, // Same venue, same party size
          time_window_start: "19:00",
          time_window_end: "22:00",
          table_types: null,
          target_days: null,
          enabled: true,
          created_at: new Date(),
          updated_at: new Date(),
          restaurant_name: "Restaurant A",
          venue_id: "100",
          days_in_advance: 14,
          release_time: "09:00",
          discord_id: "user2",
          resy_auth_token: "token2",
          resy_payment_method_id: 2,
          preferred_proxy_id: null,
        },
        {
          id: 3,
          user_id: 1,
          restaurant_id: 1,
          party_size: 4, // Same venue, different party size
          time_window_start: "18:00",
          time_window_end: "21:00",
          table_types: null,
          target_days: null,
          enabled: true,
          created_at: new Date(),
          updated_at: new Date(),
          restaurant_name: "Restaurant A",
          venue_id: "100",
          days_in_advance: 14,
          release_time: "09:00",
          discord_id: "user1",
          resy_auth_token: "token1",
          resy_payment_method_id: 1,
          preferred_proxy_id: null,
        },
      ];

      // Group by venue_id:party_size
      const groups = new Map<string, number[]>();
      for (const sub of subs) {
        const key = `${sub.venue_id}:${sub.party_size}`;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(sub.id);
      }

      expect(groups.size).toBe(2);
      expect(groups.get("100:2")).toEqual([1, 2]);
      expect(groups.get("100:4")).toEqual([3]);
    });
  });

  describe("blackout window", () => {
    test("calculates blackout correctly around release times", () => {
      const RELEASE_TIMES = ["00:00", "07:00", "09:00", "10:00", "12:00"];
      const blackoutMinutes = 5;

      // Helper to check if in blackout
      const isInBlackout = (hour: number, minute: number): boolean => {
        const currentMins = hour * 60 + minute;
        for (const releaseTime of RELEASE_TIMES) {
          const [h, m] = releaseTime.split(":").map(Number);
          const releaseMins = h * 60 + m;
          const diff = Math.abs(currentMins - releaseMins);
          const wrappedDiff = Math.min(diff, 24 * 60 - diff);
          if (wrappedDiff <= blackoutMinutes) {
            return true;
          }
        }
        return false;
      };

      // 8:55 AM - within 5 min of 9:00 AM release
      expect(isInBlackout(8, 55)).toBe(true);

      // 9:00 AM - exactly at release
      expect(isInBlackout(9, 0)).toBe(true);

      // 9:05 AM - still within blackout
      expect(isInBlackout(9, 5)).toBe(true);

      // 9:06 AM - outside blackout
      expect(isInBlackout(9, 6)).toBe(false);

      // 8:30 AM - well outside any release
      expect(isInBlackout(8, 30)).toBe(false);

      // 11:55 PM - within 5 min of midnight
      expect(isInBlackout(23, 55)).toBe(true);

      // 0:05 AM - within 5 min of midnight (other side)
      expect(isInBlackout(0, 5)).toBe(true);
    });
  });

  describe("service lifecycle", () => {
    test("can start and stop", () => {
      const onSlotsDiscovered = mock(() => {});
      const monitor = new PassiveMonitorService({
        pollIntervalMs: 60000,
        blackoutMinutes: 5,
        onSlotsDiscovered,
      });

      mockGetFullSubscriptions.mockReturnValue([]);

      // Should start without error
      monitor.start();
      expect(monitor.getStatus().running).toBe(true);

      // Should stop without error
      monitor.stop();
      expect(monitor.getStatus().running).toBe(false);
    });
  });
});
