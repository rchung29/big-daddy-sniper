/**
 * Proxy Manager Service
 *
 * Handles monitoring proxy rotation for scanning operations.
 * Checkout proxies for booking are managed by the CheckoutProxyPool service.
 *
 * Uses in-memory store - no direct DB access on hot path.
 */
import { store } from "../store";
import type { Proxy } from "../db/schema";
import { logger } from "../logger";

// Default rate limit duration: 15 minutes
const DEFAULT_RATE_LIMIT_MS = 15 * 60 * 1000;

/**
 * Proxy Manager class for monitoring proxy rotation (scanning only)
 */
export class ProxyManager {
  private rotationIndex = 0;

  /**
   * Get the next monitoring proxy for rotating scan requests
   * Uses round-robin across available monitoring proxies only
   * Checkout proxies are reserved for booking (managed by CheckoutProxyPool)
   */
  getRotatingProxy(): Proxy | null {
    // Only use monitoring proxies for scanning
    const proxies = store.getMonitoringProxies();
    if (proxies.length === 0) {
      logger.warn("No available monitoring proxies for rotation");
      return null;
    }

    // Round-robin rotation
    this.rotationIndex = this.rotationIndex % proxies.length;
    const proxy = proxies[this.rotationIndex];
    this.rotationIndex++;

    // Mark as used (updates memory + writes through to DB)
    store.markProxyUsed(proxy.id);

    logger.debug(
      { proxyId: proxy.id, type: "monitoring", index: this.rotationIndex - 1, total: proxies.length },
      "Selected rotating monitoring proxy for scanning"
    );

    return proxy;
  }

  /**
   * Mark a proxy as rate limited (got 429)
   */
  markRateLimited(proxyId: number, durationMs = DEFAULT_RATE_LIMIT_MS): void {
    store.markProxyRateLimited(proxyId, durationMs);
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
   * Get count of available monitoring proxies
   */
  getAvailableCount(): number {
    return store.getMonitoringProxies().length;
  }

  /**
   * Get status information
   */
  getStatus(): {
    available: number;
    rotationIndex: number;
  } {
    return {
      available: this.getAvailableCount(),
      rotationIndex: this.rotationIndex,
    };
  }

  /**
   * Reset rotation index
   */
  reset(): void {
    this.rotationIndex = 0;
    logger.info("Proxy manager rotation reset");
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
