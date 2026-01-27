/**
 * Proxy Manager Service
 * Handles proxy pool management, rotation for scanning, and per-user assignment for booking
 *
 * Uses in-memory store - no direct DB access on hot path
 */
import { store } from "../store";
import type { Proxy } from "../db/schema";
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

// Default rate limit duration: 15 minutes
const DEFAULT_RATE_LIMIT_MS = 15 * 60 * 1000;

/**
 * Proxy Manager class for handling proxy rotation and assignment
 */
export class ProxyManager {
  private rotationIndex = 0;
  private userProxyAssignments = new Map<number, Proxy>();

  /**
   * Get the next datacenter proxy for rotating scan requests
   * Uses round-robin across available datacenter proxies only
   * ISP proxies are reserved for booking (details + book endpoints)
   */
  getRotatingProxy(): Proxy | null {
    // Only use datacenter proxies for scanning
    const proxies = store.getDatacenterProxies();
    if (proxies.length === 0) {
      logger.warn("No available datacenter proxies for rotation");
      return null;
    }

    // Round-robin rotation
    this.rotationIndex = this.rotationIndex % proxies.length;
    const proxy = proxies[this.rotationIndex];
    this.rotationIndex++;

    // Mark as used (updates memory + writes through to DB)
    store.markProxyUsed(proxy.id);

    logger.debug(
      { proxyId: proxy.id, type: "datacenter", index: this.rotationIndex - 1, total: proxies.length },
      "Selected rotating datacenter proxy for scanning"
    );

    return proxy;
  }

  /**
   * Assign a dedicated proxy to a user for their booking session
   * Each user gets ONE proxy that they keep for all their requests
   */
  assignProxyToUser(userId: number): Proxy | null {
    // Check if user already has an assigned proxy
    const existing = this.userProxyAssignments.get(userId);
    if (existing) {
      logger.debug({ userId, proxyId: existing.id }, "User already has assigned proxy");
      return existing;
    }

    // Get currently assigned proxy IDs to avoid duplicates
    const assignedProxyIds = new Set(
      Array.from(this.userProxyAssignments.values()).map((p) => p.id)
    );

    // Find an unassigned proxy
    const proxies = store.getAvailableProxies();
    const available = proxies.filter((p) => !assignedProxyIds.has(p.id));

    if (available.length === 0) {
      logger.warn({ userId }, "No available proxies for user assignment");
      return null;
    }

    const proxy = available[0];
    this.userProxyAssignments.set(userId, proxy);
    store.markProxyUsed(proxy.id);

    logger.info(
      { userId, proxyId: proxy.id, remainingAvailable: available.length - 1 },
      "Assigned proxy to user"
    );

    return proxy;
  }

  /**
   * Assign proxies to multiple users at once
   * Returns map of userId -> Proxy
   */
  assignProxiesToUsers(userIds: number[]): Map<number, Proxy> {
    const assignments = new Map<number, Proxy>();

    // Get currently assigned proxy IDs
    const assignedProxyIds = new Set(
      Array.from(this.userProxyAssignments.values()).map((p) => p.id)
    );

    // Get available proxies
    const proxies = store.getAvailableProxies();
    const availableProxies = proxies.filter((p) => !assignedProxyIds.has(p.id));

    let proxyIndex = 0;
    for (const userId of userIds) {
      // Check if user already has an assignment
      const existing = this.userProxyAssignments.get(userId);
      if (existing) {
        assignments.set(userId, existing);
        continue;
      }

      // Assign new proxy if available
      if (proxyIndex < availableProxies.length) {
        const proxy = availableProxies[proxyIndex++];
        this.userProxyAssignments.set(userId, proxy);
        assignments.set(userId, proxy);
        store.markProxyUsed(proxy.id);
      } else {
        logger.warn({ userId }, "No proxy available for user");
      }
    }

    logger.info(
      { userCount: userIds.length, assignedCount: assignments.size },
      "Bulk assigned proxies to users"
    );

    return assignments;
  }

  /**
   * Release a user's proxy back to the pool
   */
  releaseUserProxy(userId: number): void {
    const proxy = this.userProxyAssignments.get(userId);
    if (proxy) {
      this.userProxyAssignments.delete(userId);
      logger.debug({ userId, proxyId: proxy.id }, "Released user proxy");
    }
  }

  /**
   * Release all user proxy assignments
   */
  releaseAllUserProxies(): void {
    const count = this.userProxyAssignments.size;
    this.userProxyAssignments.clear();
    logger.info({ count }, "Released all user proxy assignments");
  }

  /**
   * Get the proxy assigned to a user (without assigning a new one)
   */
  getUserProxy(userId: number): Proxy | null {
    return this.userProxyAssignments.get(userId) ?? null;
  }

  /**
   * Mark a proxy as rate limited (got 429)
   */
  markRateLimited(proxyId: number, durationMs = DEFAULT_RATE_LIMIT_MS): void {
    store.markProxyRateLimited(proxyId, durationMs);

    // Remove from user assignments if this proxy was assigned
    for (const [userId, proxy] of this.userProxyAssignments) {
      if (proxy.id === proxyId) {
        this.userProxyAssignments.delete(userId);
        logger.warn(
          { userId, proxyId, durationMs },
          "Removed rate-limited proxy from user assignment"
        );
      }
    }

    logger.warn({ proxyId, durationMs }, "Marked proxy as rate limited");
  }

  /**
   * Clear rate limit on a proxy
   */
  clearRateLimit(proxyId: number): void {
    store.clearProxyRateLimit(proxyId);
    logger.info({ proxyId }, "Cleared rate limit on proxy");
  }

  /**
   * Get count of available proxies
   */
  getAvailableCount(): number {
    return store.getAvailableProxies().length;
  }

  /**
   * Get count of currently assigned proxies
   */
  getAssignedCount(): number {
    return this.userProxyAssignments.size;
  }

  /**
   * Get status information
   */
  getStatus(): {
    available: number;
    assigned: number;
    rotationIndex: number;
  } {
    return {
      available: this.getAvailableCount(),
      assigned: this.getAssignedCount(),
      rotationIndex: this.rotationIndex,
    };
  }
}

// Singleton instance
let proxyManager: ProxyManager | null = null;

/**
 * Get the proxy manager singleton
 */
export function getProxyManager(): ProxyManager {
  if (!proxyManager) {
    proxyManager = new ProxyManager();
  }
  return proxyManager;
}
