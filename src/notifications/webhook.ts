/**
 * Webhook Notifications Service
 * Sends booking and scan notifications to a Discord webhook.
 */
import type { UserBookingResult } from "../services/booking-coordinator";
import { logger } from "../logger";

interface WebhookEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

interface WebhookPayload {
  content?: string;
  embeds?: WebhookEmbed[];
  username?: string;
  avatar_url?: string;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

export class WebhookNotifier {
  constructor(private readonly webhookUrl?: string) {}

  isConfigured(): boolean {
    return Boolean(this.webhookUrl);
  }

  private async sendWebhook(embed: WebhookEmbed): Promise<boolean> {
    if (!this.webhookUrl) {
      logger.debug("No webhook URL configured - skipping notification");
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
        const responseBody = truncate(await response.text(), 1000);
        logger.error(
          {
            status: response.status,
            statusText: response.statusText,
            responseBody,
          },
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

  async notifyBookingSuccess(result: UserBookingResult): Promise<void> {
    if (!result.bookedSlot) {
      return;
    }

    const { targetDate, slot, venueName } = result.bookedSlot;

    const embed: WebhookEmbed = {
      title: "BOOKED",
      description: `Successfully booked at **${venueName}**`,
      color: 0x2ecc71,
      fields: [
        { name: "Date", value: targetDate, inline: true },
        { name: "Time", value: slot.time, inline: true },
        { name: "Reservation ID", value: String(result.reservationId), inline: true },
      ],
      footer: { text: "Check your Resy app to view details." },
      timestamp: new Date().toISOString(),
    };

    if (slot.type) {
      embed.fields!.push({ name: "Table Type", value: slot.type, inline: true });
    }

    await this.sendWebhook(embed);
  }

  async notifyBookingFailed(result: UserBookingResult): Promise<void> {
    const embed: WebhookEmbed = {
      title: "Booking Failed",
      description: "Could not secure a reservation",
      color: 0xe74c3c,
      fields: [
        {
          name: "Reason",
          value: result.errorMessage ?? "All slots were sold out",
        },
      ],
      footer: { text: "The system will try again when a future window opens." },
      timestamp: new Date().toISOString(),
    };

    await this.sendWebhook(embed);
  }

  async notifyScanStarted(
    restaurantNames: string[],
    targetDate: string,
    releaseTime: string
  ): Promise<void> {
    const embed: WebhookEmbed = {
      title: "Scan Started",
      description: `Now scanning for reservations at:\n${restaurantNames.map((name) => `- ${name}`).join("\n")}`,
      color: 0x3498db,
      fields: [
        { name: "Target Date", value: targetDate, inline: true },
        { name: "Release Time", value: `${releaseTime} EST`, inline: true },
      ],
      timestamp: new Date().toISOString(),
    };

    await this.sendWebhook(embed);
  }

  async notifyAdmin(message: string, details?: string): Promise<void> {
    const embed: WebhookEmbed = {
      title: "Admin Alert",
      description: message,
      color: 0xe74c3c,
      timestamp: new Date().toISOString(),
    };

    if (details) {
      embed.fields = [{ name: "Details", value: truncate(details, 1024) }];
    }

    await this.sendWebhook(embed);
  }
}

let notifier: WebhookNotifier | null = null;

export function initializeNotifier(webhookUrl?: string): WebhookNotifier {
  notifier = new WebhookNotifier(webhookUrl);

  logger.info(
    { webhookConfigured: notifier.isConfigured() },
    "Webhook notifier initialized"
  );

  return notifier;
}

export function getNotifier(): WebhookNotifier | null {
  return notifier;
}
