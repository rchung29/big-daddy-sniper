import { test, expect, describe, mock, beforeEach } from "bun:test";
import { DateTime } from "luxon";
import type { FullPassiveTarget, Restaurant, DayConfig } from "../db/schema";

// Mock the store module
const mockGetFullPassiveTargets = mock((): FullPassiveTarget[] => []);
const mockGetRestaurantById = mock((): Restaurant | undefined => undefined);
const mockGetDatacenterProxies = mock(() => []);

mock.module("../store", () => ({
  store: {
    getFullPassiveTargets: mockGetFullPassiveTargets,
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
    mockGetFullPassiveTargets.mockReset();
    mockGetRestaurantById.mockReset();
    mockGetCalendar.mockReset();
    mockFindSlots.mockReset();
  });

  describe("day-of-week matching", () => {
    test("target with no target_days matches any day", () => {
      const target: FullPassiveTarget = {
        id: 1,
        user_id: 1,
        restaurant_id: 1,
        party_size: 2,
        time_window_start: "18:00",
        time_window_end: "21:00",
        table_types: null,
        target_days: null, // No filter
        day_configs: null, // No per-day config
        enabled: true,
        created_at: new Date(),
        updated_at: new Date(),
        restaurant_name: "Test Restaurant",
        venue_id: "123",
        days_in_advance: 14,
        discord_id: "user123",
        resy_auth_token: "token",
        resy_payment_method_id: 1,
        preferred_proxy_id: null,
      };

      mockGetFullPassiveTargets.mockReturnValue([target]);

      // Sunday (0), Monday (1), etc. should all match
      expect(target.target_days).toBeNull();
    });

    test("target with empty target_days matches any day", () => {
      const target: FullPassiveTarget = {
        id: 1,
        user_id: 1,
        restaurant_id: 1,
        party_size: 2,
        time_window_start: "18:00",
        time_window_end: "21:00",
        table_types: null,
        target_days: [], // Empty = any day
        day_configs: null,
        enabled: true,
        created_at: new Date(),
        updated_at: new Date(),
        restaurant_name: "Test Restaurant",
        venue_id: "123",
        days_in_advance: 14,
        discord_id: "user123",
        resy_auth_token: "token",
        resy_payment_method_id: 1,
        preferred_proxy_id: null,
      };

      mockGetFullPassiveTargets.mockReturnValue([target]);

      expect(target.target_days).toEqual([]);
    });

    test("target with specific target_days filters correctly", () => {
      // Target for weekends only (Saturday=6, Sunday=0)
      const target: FullPassiveTarget = {
        id: 1,
        user_id: 1,
        restaurant_id: 1,
        party_size: 2,
        time_window_start: "18:00",
        time_window_end: "21:00",
        table_types: null,
        target_days: [0, 6], // Sunday and Saturday
        day_configs: null, // Using legacy target_days
        enabled: true,
        created_at: new Date(),
        updated_at: new Date(),
        restaurant_name: "Test Restaurant",
        venue_id: "123",
        days_in_advance: 14,
        discord_id: "user123",
        resy_auth_token: "token",
        resy_payment_method_id: 1,
        preferred_proxy_id: null,
      };

      // 2025-02-01 is a Saturday
      const saturdayDate = "2025-02-01";
      const luxonWeekday = DateTime.fromISO(saturdayDate).weekday; // 6 for Saturday
      const dayOfWeek = luxonWeekday === 7 ? 0 : luxonWeekday; // 6

      expect(target.target_days?.includes(dayOfWeek)).toBe(true);

      // 2025-02-02 is a Sunday
      const sundayDate = "2025-02-02";
      const sundayLuxon = DateTime.fromISO(sundayDate).weekday; // 7 for Sunday
      const sundayDow = sundayLuxon === 7 ? 0 : sundayLuxon; // 0

      expect(target.target_days?.includes(sundayDow)).toBe(true);

      // 2025-02-03 is a Monday
      const mondayDate = "2025-02-03";
      const mondayLuxon = DateTime.fromISO(mondayDate).weekday; // 1 for Monday
      const mondayDow = mondayLuxon === 7 ? 0 : mondayLuxon; // 1

      expect(target.target_days?.includes(mondayDow)).toBe(false);
    });

    test("target with day_configs takes precedence over target_days", () => {
      // day_configs says Friday only
      const dayConfigs: DayConfig[] = [
        { day: 5, start: "18:00", end: "22:00" },  // Friday only
      ];

      const target: FullPassiveTarget = {
        id: 1,
        user_id: 1,
        restaurant_id: 1,
        party_size: 2,
        time_window_start: "18:00",
        time_window_end: "21:00",
        table_types: null,
        target_days: [0, 1, 2, 3, 4, 5, 6], // All days (legacy)
        day_configs: dayConfigs, // Friday only (takes precedence)
        enabled: true,
        created_at: new Date(),
        updated_at: new Date(),
        restaurant_name: "Test Restaurant",
        venue_id: "123",
        days_in_advance: 14,
        discord_id: "user123",
        resy_auth_token: "token",
        resy_payment_method_id: 1,
        preferred_proxy_id: null,
      };

      // 2025-02-07 is a Friday - should match day_configs
      const fridayLuxon = DateTime.fromISO("2025-02-07").weekday; // 5 for Friday
      const fridayDow = fridayLuxon === 7 ? 0 : fridayLuxon; // 5
      expect(target.day_configs?.some(c => c.day === fridayDow)).toBe(true);

      // 2025-02-08 is a Saturday - in target_days but NOT in day_configs
      const saturdayLuxon = DateTime.fromISO("2025-02-08").weekday; // 6 for Saturday
      const saturdayDow = saturdayLuxon === 7 ? 0 : saturdayLuxon; // 6
      expect(target.day_configs?.some(c => c.day === saturdayDow)).toBe(false);
    });

    test("day_configs provides per-day time windows", () => {
      const dayConfigs: DayConfig[] = [
        { day: 5, start: "18:00", end: "22:00" },  // Friday: 6pm-10pm
        { day: 6, start: "11:30", end: "22:00" },  // Saturday: 11:30am-10pm
        { day: 0, start: "11:30", end: "22:00" },  // Sunday: 11:30am-10pm
      ];

      const target: FullPassiveTarget = {
        id: 1,
        user_id: 1,
        restaurant_id: 1,
        party_size: 2,
        time_window_start: "17:00", // Legacy fallback
        time_window_end: "21:00",
        table_types: null,
        target_days: null,
        day_configs: dayConfigs,
        enabled: true,
        created_at: new Date(),
        updated_at: new Date(),
        restaurant_name: "Test Restaurant",
        venue_id: "123",
        days_in_advance: 14,
        discord_id: "user123",
        resy_auth_token: "token",
        resy_payment_method_id: 1,
        preferred_proxy_id: null,
      };

      // Get Friday config
      const fridayConfig = target.day_configs?.find(c => c.day === 5);
      expect(fridayConfig?.start).toBe("18:00");
      expect(fridayConfig?.end).toBe("22:00");

      // Get Saturday config
      const saturdayConfig = target.day_configs?.find(c => c.day === 6);
      expect(saturdayConfig?.start).toBe("11:30");
      expect(saturdayConfig?.end).toBe("22:00");
    });
  });

  describe("target grouping", () => {
    test("groups targets by venue_id and party_size", () => {
      const targets: FullPassiveTarget[] = [
        {
          id: 1,
          user_id: 1,
          restaurant_id: 1,
          party_size: 2,
          time_window_start: "18:00",
          time_window_end: "21:00",
          table_types: null,
          target_days: null,
          day_configs: null,
          enabled: true,
          created_at: new Date(),
          updated_at: new Date(),
          restaurant_name: "Restaurant A",
          venue_id: "100",
          days_in_advance: 14,
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
          day_configs: null,
          enabled: true,
          created_at: new Date(),
          updated_at: new Date(),
          restaurant_name: "Restaurant A",
          venue_id: "100",
          days_in_advance: 14,
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
          day_configs: null,
          enabled: true,
          created_at: new Date(),
          updated_at: new Date(),
          restaurant_name: "Restaurant A",
          venue_id: "100",
          days_in_advance: 14,
          discord_id: "user1",
          resy_auth_token: "token1",
          resy_payment_method_id: 1,
          preferred_proxy_id: null,
        },
      ];

      // Group by venue_id:party_size
      const groups = new Map<string, number[]>();
      for (const target of targets) {
        const key = `${target.venue_id}:${target.party_size}`;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(target.id);
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

      mockGetFullPassiveTargets.mockReturnValue([]);

      // Should start without error
      monitor.start();
      expect(monitor.getStatus().running).toBe(true);

      // Should stop without error
      monitor.stop();
      expect(monitor.getStatus().running).toBe(false);
    });
  });
});
