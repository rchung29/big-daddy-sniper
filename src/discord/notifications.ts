/**
 * Discord Notifications Service
 * Sends notifications to a Discord webhook
 */
import type { UserBookingResult } from "../services/booking-coordinator";
import type { DiscoveredSlot } from "../services/scanner";
import { logger } from "../logger";

/**
 * Discord webhook embed structure
 */
interface WebhookEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

/**
 * Discord webhook payload
 */
interface WebhookPayload {
  content?: string;
  embeds?: WebhookEmbed[];
  username?: string;
  avatar_url?: string;
}

/**
 * Discord Notification Service
 */
export class DiscordNotifier {
  private webhookUrl?: string;

  constructor(webhookUrl?: string) {
    this.webhookUrl = webhookUrl;
  }

  /**
   * Send a message to the webhook
   */
  private async sendWebhook(embed: WebhookEmbed): Promise<boolean> {
    if (!this.webhookUrl) {
      logger.warn("No webhook URL configured - skipping notification");
      return false;
    }

    try {
      const payload: WebhookPayload = {
        embeds: [embed],
        username: "Resy Sniper",
      };

      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        logger.error(
          { status: response.status, statusText: response.statusText },
          "Webhook request failed"
        );
        return false;
      }

      logger.debug("Sent webhook notification");
      return true;
    } catch (error) {
      logger.error({ error: String(error) }, "Failed to send webhook notification");
      return false;
    }
  }

  /**
   * Notify of successful booking
   */
  async notifyBookingSuccess(result: UserBookingResult): Promise<void> {
    if (!result.bookedSlot) return;

    const { targetDate, slot, venueName } = result.bookedSlot;

    const embed: WebhookEmbed = {
      title: "🎉 BOOKED!",
      description: `Successfully booked at **${venueName}**`,
      color: 0x2ecc71,
      fields: [
        { name: "Date", value: targetDate, inline: true },
        { name: "Time", value: slot.time, inline: true },
        { name: "Reservation ID", value: String(result.reservationId), inline: true },
      ],
      footer: { text: "Check your Resy app to view details!" },
      timestamp: new Date().toISOString(),
    };

    if (slot.type) {
      embed.fields!.push({ name: "Table Type", value: slot.type, inline: true });
    }

    await this.sendWebhook(embed);
  }

  /**
   * Notify of failed booking
   */
  async notifyBookingFailed(result: UserBookingResult): Promise<void> {
    const embed: WebhookEmbed = {
      title: "❌ Booking Failed",
      description: "Could not secure a reservation",
      color: 0xe74c3c,
      fields: [
        {
          name: "Reason",
          value: result.errorMessage ?? "All slots were sold out",
        },
      ],
      footer: { text: "The bot will keep trying on the next release window" },
      timestamp: new Date().toISOString(),
    };

    await this.sendWebhook(embed);
  }

  /**
   * Notify that scanning has started
   */
  async notifyScanStarted(
    discordId: string,
    restaurantNames: string[],
    targetDate: string,
    releaseTime: string
  ): Promise<void> {
    const embed: WebhookEmbed = {
      title: "🔍 Scan Started",
      description: `Now scanning for reservations at:\n${restaurantNames.map((n) => `• ${n}`).join("\n")}`,
      color: 0x3498db,
      fields: [
        { name: "Target Date", value: targetDate, inline: true },
        { name: "Release Time", value: `${releaseTime} EST`, inline: true },
      ],
      timestamp: new Date().toISOString(),
    };

    await this.sendWebhook(embed);
  }

  /**
   * Notify that slots were found (before booking)
   */
  async notifySlotsFound(
    discordId: string,
    slots: DiscoveredSlot[],
    targetDate: string
  ): Promise<void> {
    const slotSummary = slots
      .slice(0, 5)
      .map((s) => `• ${s.venueName}: ${s.slot.time}`)
      .join("\n");

    const moreCount = slots.length > 5 ? ` (+${slots.length - 5} more)` : "";

    const embed: WebhookEmbed = {
      title: "✨ Slots Found!",
      description: "Attempting to book...",
      color: 0xf39c12,
      fields: [
        { name: "Target Date", value: targetDate, inline: true },
        { name: `Available Slots${moreCount}`, value: slotSummary },
      ],
      timestamp: new Date().toISOString(),
    };

    await this.sendWebhook(embed);
  }

  /**
   * Notify admin of system error
   */
  async notifyAdmin(message: string, details?: string): Promise<void> {
    const embed: WebhookEmbed = {
      title: "⚠️ Admin Alert",
      description: message,
      color: 0xe74c3c,
      timestamp: new Date().toISOString(),
    };

    if (details) {
      embed.fields = [{ name: "Details", value: details.slice(0, 1024) }];
    }

    await this.sendWebhook(embed);
  }

  /**
   * Notify of unknown booking error
   */
  async notifyUnknownError(
    status: number,
    code: string | undefined,
    message: string
  ): Promise<void> {
    const embed: WebhookEmbed = {
      title: "🚨 Unknown Booking Error",
      description: "Encountered an unhandled error code - needs investigation",
      color: 0xe74c3c,
      fields: [
        { name: "HTTP Status", value: String(status), inline: true },
        { name: "Error Code", value: code ?? "N/A", inline: true },
        { name: "Message", value: message.slice(0, 1024) },
      ],
      timestamp: new Date().toISOString(),
    };

    await this.sendWebhook(embed);
  }

  /**
   * Notify of rate limiting
   */
  async notifyRateLimited(proxyId: number, durationMinutes: number): Promise<void> {
    const embed: WebhookEmbed = {
      title: "⏱️ Proxy Rate Limited",
      description: `Proxy #${proxyId} received a 429 response`,
      color: 0xf39c12,
      fields: [{ name: "Cooldown", value: `${durationMinutes} minutes`, inline: true }],
      timestamp: new Date().toISOString(),
    };

    await this.sendWebhook(embed);
  }

  /**
   * Notify of booking cycle summary
   */
  async notifyBookingCycleSummary(results: UserBookingResult[]): Promise<void> {
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    const embed: WebhookEmbed = {
      title: "📊 Booking Cycle Complete",
      description: `Processed ${results.length} booking attempts`,
      color: successful.length > 0 ? 0x2ecc71 : 0xe74c3c,
      fields: [
        { name: "Successful", value: String(successful.length), inline: true },
        { name: "Failed", value: String(failed.length), inline: true },
      ],
      timestamp: new Date().toISOString(),
    };

    if (successful.length > 0) {
      const successList = successful
        .slice(0, 5)
        .map((r) => `• ${r.bookedSlot?.venueName} at ${r.bookedSlot?.slot.time}`)
        .join("\n");
      embed.fields!.push({ name: "Booked", value: successList });
    }

    await this.sendWebhook(embed);
  }
}

// Singleton instance
let notifier: DiscordNotifier | null = null;

/**
 * Initialize the notifier with a webhook URL
 */
export function initializeNotifier(
  webhookUrl?: string
): DiscordNotifier {
  notifier = new DiscordNotifier(webhookUrl);
  return notifier;
}

/**
 * Get the notifier singleton
 */
export function getNotifier(): DiscordNotifier | null {
  return notifier;
}
