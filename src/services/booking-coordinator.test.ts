import { test, expect, describe, beforeEach } from "bun:test";

/**
 * Unit tests for slot claiming logic
 *
 * Since the claiming methods are private, we test the logic in isolation
 * by recreating the same Map-based claiming pattern.
 */

describe("Slot Claiming Logic", () => {
  let claimedSlots: Map<string, number>;

  const getSlotKey = (restaurantId: number, targetDate: string, slotTime: string): string => {
    return `${restaurantId}:${targetDate}:${slotTime}`;
  };

  const tryClaimSlot = (restaurantId: number, targetDate: string, slotTime: string, userId: number): boolean => {
    const key = getSlotKey(restaurantId, targetDate, slotTime);
    if (claimedSlots.has(key)) {
      return false;
    }
    claimedSlots.set(key, userId);
    return true;
  };

  const releaseSlot = (restaurantId: number, targetDate: string, slotTime: string, userId: number): void => {
    const key = getSlotKey(restaurantId, targetDate, slotTime);
    if (claimedSlots.get(key) === userId) {
      claimedSlots.delete(key);
    }
  };

  beforeEach(() => {
    claimedSlots = new Map();
  });

  test("first user can claim an unclaimed slot", () => {
    const result = tryClaimSlot(123, "2025-02-01", "19:30", 1);
    expect(result).toBe(true);
    expect(claimedSlots.size).toBe(1);
  });

  test("second user cannot claim already-claimed slot", () => {
    // User 1 claims the slot
    const firstClaim = tryClaimSlot(123, "2025-02-01", "19:30", 1);
    expect(firstClaim).toBe(true);

    // User 2 tries to claim the same slot
    const secondClaim = tryClaimSlot(123, "2025-02-01", "19:30", 2);
    expect(secondClaim).toBe(false);

    // Slot is still owned by user 1
    expect(claimedSlots.get("123:2025-02-01:19:30")).toBe(1);
  });

  test("different slots can be claimed by different users", () => {
    // User 1 claims 7:30 PM
    const claim1 = tryClaimSlot(123, "2025-02-01", "19:30", 1);
    expect(claim1).toBe(true);

    // User 2 claims 7:45 PM (different slot)
    const claim2 = tryClaimSlot(123, "2025-02-01", "19:45", 2);
    expect(claim2).toBe(true);

    // User 3 claims 8:00 PM (different slot)
    const claim3 = tryClaimSlot(123, "2025-02-01", "20:00", 3);
    expect(claim3).toBe(true);

    expect(claimedSlots.size).toBe(3);
  });

  test("same slot at different restaurants can be claimed", () => {
    const claim1 = tryClaimSlot(123, "2025-02-01", "19:30", 1);
    const claim2 = tryClaimSlot(456, "2025-02-01", "19:30", 2);

    expect(claim1).toBe(true);
    expect(claim2).toBe(true);
    expect(claimedSlots.size).toBe(2);
  });

  test("same slot on different dates can be claimed", () => {
    const claim1 = tryClaimSlot(123, "2025-02-01", "19:30", 1);
    const claim2 = tryClaimSlot(123, "2025-02-02", "19:30", 2);

    expect(claim1).toBe(true);
    expect(claim2).toBe(true);
    expect(claimedSlots.size).toBe(2);
  });

  test("owner can release their claim", () => {
    tryClaimSlot(123, "2025-02-01", "19:30", 1);
    expect(claimedSlots.size).toBe(1);

    releaseSlot(123, "2025-02-01", "19:30", 1);
    expect(claimedSlots.size).toBe(0);
  });

  test("non-owner cannot release another user's claim", () => {
    // User 1 claims
    tryClaimSlot(123, "2025-02-01", "19:30", 1);

    // User 2 tries to release (should fail)
    releaseSlot(123, "2025-02-01", "19:30", 2);

    // Slot is still claimed by user 1
    expect(claimedSlots.size).toBe(1);
    expect(claimedSlots.get("123:2025-02-01:19:30")).toBe(1);
  });

  test("released slot can be claimed by another user", () => {
    // User 1 claims then releases
    tryClaimSlot(123, "2025-02-01", "19:30", 1);
    releaseSlot(123, "2025-02-01", "19:30", 1);

    // User 2 can now claim it
    const claim = tryClaimSlot(123, "2025-02-01", "19:30", 2);
    expect(claim).toBe(true);
    expect(claimedSlots.get("123:2025-02-01:19:30")).toBe(2);
  });

  test("clear removes all claims", () => {
    tryClaimSlot(123, "2025-02-01", "19:30", 1);
    tryClaimSlot(123, "2025-02-01", "19:45", 2);
    tryClaimSlot(456, "2025-02-01", "20:00", 3);

    expect(claimedSlots.size).toBe(3);

    claimedSlots.clear();

    expect(claimedSlots.size).toBe(0);
  });

  describe("Simulated booking scenarios", () => {
    test("4 users racing for same slot - only first wins", () => {
      const userIds = [1, 2, 3, 4];
      const results: { userId: number; claimed: boolean }[] = [];

      // Simulate all 4 users trying to claim the same 7:30 PM slot
      for (const userId of userIds) {
        const claimed = tryClaimSlot(123, "2025-02-01", "19:30", userId);
        results.push({ userId, claimed });
      }

      // Only the first user should succeed
      expect(results[0]).toEqual({ userId: 1, claimed: true });
      expect(results[1]).toEqual({ userId: 2, claimed: false });
      expect(results[2]).toEqual({ userId: 3, claimed: false });
      expect(results[3]).toEqual({ userId: 4, claimed: false });
    });

    test("users spread across multiple slots when first is claimed", () => {
      const slots = ["19:30", "19:45", "20:00", "20:15"];
      const assignments: { userId: number; slot: string }[] = [];

      // Each user tries slots in order, takes first available
      for (let userId = 1; userId <= 4; userId++) {
        for (const slot of slots) {
          if (tryClaimSlot(123, "2025-02-01", slot, userId)) {
            assignments.push({ userId, slot });
            break;
          }
        }
      }

      // Each user should get a different slot
      expect(assignments).toEqual([
        { userId: 1, slot: "19:30" },
        { userId: 2, slot: "19:45" },
        { userId: 3, slot: "20:00" },
        { userId: 4, slot: "20:15" },
      ]);
    });

    test("WAF failure releases slot for others", () => {
      // User 1 claims slot
      tryClaimSlot(123, "2025-02-01", "19:30", 1);

      // User 2 skips this slot (already claimed)
      const user2Claim = tryClaimSlot(123, "2025-02-01", "19:30", 2);
      expect(user2Claim).toBe(false);

      // User 1 hits max WAF retries, releases slot
      releaseSlot(123, "2025-02-01", "19:30", 1);

      // Now user 2 (on retry) can claim it
      const user2Retry = tryClaimSlot(123, "2025-02-01", "19:30", 2);
      expect(user2Retry).toBe(true);
    });

    test("sold out slot stays claimed (no point others trying)", () => {
      // User 1 claims and gets "sold out"
      tryClaimSlot(123, "2025-02-01", "19:30", 1);
      // User 1 does NOT release on sold_out

      // Slot remains claimed
      expect(claimedSlots.has("123:2025-02-01:19:30")).toBe(true);

      // User 2 cannot claim
      const user2Claim = tryClaimSlot(123, "2025-02-01", "19:30", 2);
      expect(user2Claim).toBe(false);
    });
  });
});
