/**
 * ISP Proxy Pool Service
 *
 * Manages a shared pool of ISP proxies for booking operations.
 * Key semantics:
 * - acquire(): Get next available proxy, blocks with timeout if none available
 * - release(): Return proxy to pool for reuse
 * - markBad(): Put proxy in cooldown (5 min) after WAF block
 *
 * This pool is shared across all booking operations - proxies are allocated
 * per-restaurant, not per-user, to maximize utilization with limited ISP proxies.
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

// Cooldown duration after WAF block: 5 minutes
const COOLDOWN_DURATION_MS = 5 * 60 * 1000;

// Minimum delay between reusing the same proxy: 2 seconds
const MIN_REUSE_DELAY_MS = 2000;

// Default acquire timeout: 10 seconds
const DEFAULT_ACQUIRE_TIMEOUT_MS = 10_000;

// Poll interval when waiting for proxy
const POLL_INTERVAL_MS = 100;

/**
 * ISP Proxy Pool
 *
 * Rate limiting: Enforces MIN_REUSE_DELAY_MS between uses of the same proxy
 */
export class IspProxyPool {
  private available: Proxy[] = [];
  private inUse = new Map<number, { proxy: Proxy; since: Date }>();
  private cooldown = new Map<number, { proxy: Proxy; until: Date }>();
  private lastUsed = new Map<number, number>(); // proxyId → timestamp
  private initialized = false;

  /**
   * Initialize the pool with ISP proxies from the store
   */
  initialize(): void {
    if (this.initialized) {
      logger.warn("ISP proxy pool already initialized");
      return;
    }

    const ispProxies = store.getIspProxies();
    this.available = [...ispProxies];
    this.inUse.clear();
    this.cooldown.clear();
    this.initialized = true;

    logger.info(
      { count: this.available.length },
      "ISP proxy pool initialized"
    );
  }

  /**
   * Refresh the pool from the store (call after store sync)
   */
  refresh(): void {
    const ispProxies = store.getIspProxies();

    // Keep track of currently in-use and cooldown proxy IDs
    const inUseIds = new Set(this.inUse.keys());
    const cooldownIds = new Set(this.cooldown.keys());

    // Update available list with proxies not in use or cooldown
    this.available = ispProxies.filter(
      (p) => !inUseIds.has(p.id) && !cooldownIds.has(p.id)
    );

    logger.debug(
      {
        available: this.available.length,
        inUse: this.inUse.size,
        cooldown: this.cooldown.size,
      },
      "ISP proxy pool refreshed"
    );
  }

  /**
   * Acquire a proxy from the pool
   * Blocks with timeout if none available
   * Enforces MIN_REUSE_DELAY_MS between uses of the same proxy
   *
   * @param timeoutMs Maximum time to wait for a proxy
   * @returns Proxy if available, null if timed out
   */
  async acquire(timeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS): Promise<Proxy | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      // Restore any proxies whose cooldown has expired
      this.restoreFromCooldown();

      // Find a proxy that hasn't been used too recently
      const now = Date.now();
      const eligibleIndex = this.available.findIndex((proxy) => {
        const lastUsedTime = this.lastUsed.get(proxy.id) ?? 0;
        return now - lastUsedTime >= MIN_REUSE_DELAY_MS;
      });

      if (eligibleIndex !== -1) {
        // Remove from available and mark in-use
        const [proxy] = this.available.splice(eligibleIndex, 1);
        this.inUse.set(proxy.id, { proxy, since: new Date() });

        logger.debug(
          {
            proxyId: proxy.id,
            remainingAvailable: this.available.length,
            inUse: this.inUse.size,
          },
          "Acquired ISP proxy"
        );

        // Mark as used in store (for LRU tracking)
        store.markProxyUsed(proxy.id);

        return proxy;
      }

      // Wait before polling again
      await sleep(POLL_INTERVAL_MS);
    }

    logger.warn(
      { timeoutMs, inUse: this.inUse.size, cooldown: this.cooldown.size },
      "Timed out waiting for ISP proxy"
    );

    return null;
  }

  /**
   * Release a proxy back to the pool
   * Records lastUsed timestamp to enforce MIN_REUSE_DELAY_MS
   *
   * @param proxyId ID of the proxy to release
   */
  release(proxyId: number): void {
    const entry = this.inUse.get(proxyId);
    if (entry) {
      this.inUse.delete(proxyId);
      this.available.push(entry.proxy);
      this.lastUsed.set(proxyId, Date.now()); // Track for rate limiting

      logger.debug(
        {
          proxyId,
          available: this.available.length,
          inUse: this.inUse.size,
        },
        "Released ISP proxy"
      );
    } else {
      logger.warn({ proxyId }, "Attempted to release proxy not in use");
    }
  }

  /**
   * Mark a proxy as bad (WAF blocked)
   * Puts it in cooldown for 5 minutes
   *
   * @param proxyId ID of the proxy to mark as bad
   */
  markBad(proxyId: number): void {
    const entry = this.inUse.get(proxyId);
    if (entry) {
      this.inUse.delete(proxyId);
      const cooldownUntil = new Date(Date.now() + COOLDOWN_DURATION_MS);
      this.cooldown.set(proxyId, { proxy: entry.proxy, until: cooldownUntil });

      logger.warn(
        {
          proxyId,
          cooldownUntil: cooldownUntil.toISOString(),
          available: this.available.length,
          cooldown: this.cooldown.size,
        },
        "Marked ISP proxy as bad - in cooldown"
      );
    } else {
      logger.warn({ proxyId }, "Attempted to mark bad proxy not in use");
    }
  }

  /**
   * Move proxies out of cooldown if their time has passed
   */
  private restoreFromCooldown(): void {
    const now = Date.now();

    for (const [proxyId, entry] of this.cooldown) {
      if (now >= entry.until.getTime()) {
        this.cooldown.delete(proxyId);
        this.available.push(entry.proxy);

        logger.info(
          {
            proxyId,
            available: this.available.length,
          },
          "Restored ISP proxy from cooldown"
        );
      }
    }
  }

  /**
   * Get pool status
   */
  getStatus(): {
    available: number;
    inUse: number;
    cooldown: number;
    total: number;
  } {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      cooldown: this.cooldown.size,
      total: this.available.length + this.inUse.size + this.cooldown.size,
    };
  }

  /**
   * Reset the pool (call at start of new scan window)
   */
  reset(): void {
    // Release all in-use proxies
    for (const [, entry] of this.inUse) {
      this.available.push(entry.proxy);
    }
    this.inUse.clear();

    // Restore from cooldown (force)
    for (const [, entry] of this.cooldown) {
      this.available.push(entry.proxy);
    }
    this.cooldown.clear();

    // Clear rate limiting history
    this.lastUsed.clear();

    logger.info(
      { available: this.available.length },
      "ISP proxy pool reset"
    );
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Singleton instance
let ispProxyPool: IspProxyPool | null = null;

/**
 * Get the ISP proxy pool singleton
 */
export function getIspProxyPool(): IspProxyPool {
  if (!ispProxyPool) {
    ispProxyPool = new IspProxyPool();
  }
  return ispProxyPool;
}
