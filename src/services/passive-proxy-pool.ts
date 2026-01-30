/**
 * Passive Proxy Pool
 *
 * Simple round-robin proxy selection for passive monitoring.
 * Uses datacenter proxies automatically - separate from ISP proxies used for booking.
 */
import { store } from "../store";
import type { Proxy } from "../db/schema";
import { logger } from "../logger";

/**
 * Passive Proxy Pool - round-robin selection using datacenter proxies
 */
export class PassiveProxyPool {
  private proxies: Proxy[] = [];
  private currentIndex = 0;

  /**
   * Initialize the pool by loading datacenter proxies from the store
   */
  initialize(): void {
    this.proxies = store.getDatacenterProxies();

    if (this.proxies.length === 0) {
      logger.warn(
        "No datacenter proxies found for passive monitoring - will run without proxies"
      );
    } else {
      logger.info(
        { count: this.proxies.length, ids: this.proxies.map((p) => p.id) },
        "Passive proxy pool initialized with datacenter proxies"
      );
    }
  }

  /**
   * Get next proxy in round-robin fashion
   * Returns undefined if no proxies configured
   */
  getNext(): Proxy | undefined {
    if (this.proxies.length === 0) {
      return undefined;
    }

    const proxy = this.proxies[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;

    return proxy;
  }

  /**
   * Refresh the pool from the store (call after store sync)
   */
  refresh(): void {
    this.proxies = store.getDatacenterProxies();

    // Reset index if it's out of bounds
    if (this.currentIndex >= this.proxies.length) {
      this.currentIndex = 0;
    }

    logger.debug(
      { count: this.proxies.length },
      "Passive proxy pool refreshed"
    );
  }

  /**
   * Get pool status
   */
  getStatus(): { total: number; ids: number[] } {
    return {
      total: this.proxies.length,
      ids: this.proxies.map((p) => p.id),
    };
  }
}
