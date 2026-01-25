import { test, expect, describe } from "bun:test";
import {
    parseSlotTime,
    isTimeInWindow,
    matchesTableType,
    filterSlots,
} from "./filters";

describe("parseSlotTime", () => {
    test("parses 12-hour AM time", () => {
        expect(parseSlotTime("9:30 AM")).toBe(9 * 60 + 30);
        expect(parseSlotTime("12:00 AM")).toBe(0);
        expect(parseSlotTime("12:30 AM")).toBe(30);
    });

    test("parses 12-hour PM time", () => {
        expect(parseSlotTime("7:30 PM")).toBe(19 * 60 + 30);
        expect(parseSlotTime("12:00 PM")).toBe(12 * 60);
        expect(parseSlotTime("12:30 PM")).toBe(12 * 60 + 30);
    });

    test("parses 24-hour time", () => {
        expect(parseSlotTime("19:30")).toBe(19 * 60 + 30);
        expect(parseSlotTime("00:00")).toBe(0);
        expect(parseSlotTime("23:59")).toBe(23 * 60 + 59);
    });

    test("parses datetime format from API", () => {
        expect(parseSlotTime("2026-02-04 12:00:00")).toBe(12 * 60);
        expect(parseSlotTime("2026-02-04 19:30:00")).toBe(19 * 60 + 30);
        expect(parseSlotTime("2026-02-04 21:00:00")).toBe(21 * 60);
    });

    test("throws on invalid format", () => {
        expect(() => parseSlotTime("invalid")).toThrow();
    });
});

describe("isTimeInWindow", () => {
    test("returns true when slot is in window", () => {
        expect(isTimeInWindow("7:30 PM", { start: "19:00", end: "21:00" })).toBe(true);
        expect(isTimeInWindow("19:00", { start: "19:00", end: "21:00" })).toBe(true);
        expect(isTimeInWindow("21:00", { start: "19:00", end: "21:00" })).toBe(true);
    });

    test("returns false when slot is outside window", () => {
        expect(isTimeInWindow("6:30 PM", { start: "19:00", end: "21:00" })).toBe(false);
        expect(isTimeInWindow("9:30 PM", { start: "19:00", end: "21:00" })).toBe(false);
    });

    test("handles overnight windows", () => {
        expect(isTimeInWindow("11:00 PM", { start: "22:00", end: "02:00" })).toBe(true);
        expect(isTimeInWindow("1:00 AM", { start: "22:00", end: "02:00" })).toBe(true);
        expect(isTimeInWindow("3:00 AM", { start: "22:00", end: "02:00" })).toBe(false);
    });
});

describe("matchesTableType", () => {
    test("returns true when no filter specified", () => {
        expect(matchesTableType("Dining Room", undefined)).toBe(true);
        expect(matchesTableType("Dining Room", [])).toBe(true);
    });

    test("returns true when type matches filter", () => {
        expect(matchesTableType("Dining Room", ["Dining Room"])).toBe(true);
        expect(matchesTableType("Main Dining Room", ["Dining"])).toBe(true);
    });

    test("returns false when type does not match", () => {
        expect(matchesTableType("Bar", ["Dining Room"])).toBe(false);
    });

    test("returns false when slot has no type", () => {
        expect(matchesTableType(undefined, ["Dining Room"])).toBe(false);
    });
});

describe("filterSlots", () => {
    const config = {
        id: "123",
        party_size: 2,
        time_window: { start: "19:00", end: "21:00" },
        target_dates: ["2025-02-14"],
    };

    test("filters slots by time window", () => {
        const slots = [
            { config_id: "1", time: "6:00 PM" },
            { config_id: "2", time: "7:30 PM" },
            { config_id: "3", time: "9:30 PM" },
        ];
        const result = filterSlots(slots, config);
        expect(result).toHaveLength(1);
        expect(result[0].config_id).toBe("2");
    });

    test("filters slots by table type when specified", () => {
        const configWithType = { ...config, table_types: ["Dining"] };
        const slots = [
            { config_id: "1", time: "7:30 PM", type: "Bar" },
            { config_id: "2", time: "7:30 PM", type: "Dining Room" },
        ];
        const result = filterSlots(slots, configWithType);
        expect(result).toHaveLength(1);
        expect(result[0].config_id).toBe("2");
    });
});
