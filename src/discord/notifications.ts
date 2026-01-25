/**
 * Discord Notifications Service
 * Sends DMs to users on booking events
 */
import { Client, EmbedBuilder, type User } from "discord.js";
import type { UserBookingResult } from "../services/executor";
import type { DiscoveredSlot } from "../services/scanner";
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

/**
 * Discord Notification Service
 */
export class DiscordNotifier {
  private client: Client;
  private adminDiscordId?: string;

  constructor(client: Client, adminDiscordId?: string) {
    this.client = client;
    this.adminDiscordId = adminDiscordId;
  }

  /**
   * Send a DM to a user by Discord ID
   */
  private async sendDM(discordId: string, embed: EmbedBuilder): Promise<boolean> {
    try {
      const user = await this.client.users.fetch(discordId);
      await user.send({ embeds: [embed] });
      logger.debug({ discordId }, "Sent DM notification");
      return true;
    } catch (error) {
      logger.error(
        { discordId, error: String(error) },
        "Failed to send DM notification"
      );
      return false;
    }
  }

  /**
   * Notify user of successful booking
   */
  async notifyBookingSuccess(result: UserBookingResult): Promise<void> {
    if (!result.bookedSlot) return;

    const { restaurant, targetDate, slot, venueName } = result.bookedSlot;

    const embed = new EmbedBuilder()
      .setTitle("BOOKED!")
      .setDescription(`Successfully booked at **${venueName}**`)
      .setColor(0x2ecc71)
      .addFields(
        { name: "Date", value: targetDate, inline: true },
        { name: "Time", value: slot.time, inline: true },
        { name: "Reservation ID", value: String(result.reservationId), inline: true }
      )
      .setTimestamp();

    if (slot.type) {
      embed.addFields({ name: "Table Type", value: slot.type, inline: true });
    }

    embed.setFooter({
      text: "Check your Resy app to view details!",
    });

    await this.sendDM(result.discordId, embed);
  }

  /**
   * Notify user of failed booking
   */
  async notifyBookingFailed(result: UserBookingResult): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle("Booking Failed")
      .setDescription("Could not secure a reservation")
      .setColor(0xe74c3c)
      .addFields({
        name: "Reason",
        value: result.errorMessage ?? "All slots were sold out",
      })
      .setTimestamp()
      .setFooter({
        text: "The bot will keep trying on the next release window",
      });

    await this.sendDM(result.discordId, embed);
  }

  /**
   * Notify user that scanning has started for their subscription
   */
  async notifyScanStarted(
    discordId: string,
    restaurantNames: string[],
    targetDate: string,
    releaseTime: string
  ): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle("Scan Started")
      .setDescription(
        `Now scanning for reservations at:\n${restaurantNames.map((n) => `- ${n}`).join("\n")}`
      )
      .setColor(0x3498db)
      .addFields(
        { name: "Target Date", value: targetDate, inline: true },
        { name: "Release Time", value: `${releaseTime} EST`, inline: true }
      )
      .setTimestamp();

    await this.sendDM(discordId, embed);
  }

  /**
   * Notify user that slots were found (before booking)
   */
  async notifySlotsFound(
    discordId: string,
    slots: DiscoveredSlot[],
    targetDate: string
  ): Promise<void> {
    const slotSummary = slots
      .slice(0, 5)
      .map((s) => `- ${s.venueName}: ${s.slot.time}`)
      .join("\n");

    const moreCount = slots.length > 5 ? ` (+${slots.length - 5} more)` : "";

    const embed = new EmbedBuilder()
      .setTitle("Slots Found!")
      .setDescription(`Attempting to book...`)
      .setColor(0xf39c12)
      .addFields(
        { name: "Target Date", value: targetDate, inline: true },
        { name: `Available Slots${moreCount}`, value: slotSummary }
      )
      .setTimestamp();

    await this.sendDM(discordId, embed);
  }

  /**
   * Notify admin of system error
   */
  async notifyAdmin(message: string, details?: string): Promise<void> {
    if (!this.adminDiscordId) return;

    const embed = new EmbedBuilder()
      .setTitle("Admin Alert")
      .setDescription(message)
      .setColor(0xe74c3c)
      .setTimestamp();

    if (details) {
      embed.addFields({ name: "Details", value: details.slice(0, 1024) });
    }

    await this.sendDM(this.adminDiscordId, embed);
  }

  /**
   * Notify admin of unknown booking error
   */
  async notifyUnknownError(
    status: number,
    code: string | undefined,
    message: string
  ): Promise<void> {
    if (!this.adminDiscordId) return;

    const embed = new EmbedBuilder()
      .setTitle("Unknown Booking Error")
      .setDescription("Encountered an unhandled error code - needs investigation")
      .setColor(0xe74c3c)
      .addFields(
        { name: "HTTP Status", value: String(status), inline: true },
        { name: "Error Code", value: code ?? "N/A", inline: true },
        { name: "Message", value: message.slice(0, 1024) }
      )
      .setTimestamp();

    await this.sendDM(this.adminDiscordId, embed);
  }

  /**
   * Notify admin of rate limiting
   */
  async notifyRateLimited(proxyId: number, durationMinutes: number): Promise<void> {
    if (!this.adminDiscordId) return;

    const embed = new EmbedBuilder()
      .setTitle("Proxy Rate Limited")
      .setDescription(`Proxy #${proxyId} received a 429 response`)
      .setColor(0xf39c12)
      .addFields({ name: "Cooldown", value: `${durationMinutes} minutes`, inline: true })
      .setTimestamp();

    await this.sendDM(this.adminDiscordId, embed);
  }

  /**
   * Notify all subscribed users about a successful booking cycle summary
   */
  async notifyBookingCycleSummary(
    results: UserBookingResult[]
  ): Promise<void> {
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    if (!this.adminDiscordId) return;

    const embed = new EmbedBuilder()
      .setTitle("Booking Cycle Complete")
      .setDescription(`Processed ${results.length} booking attempts`)
      .setColor(successful.length > 0 ? 0x2ecc71 : 0xe74c3c)
      .addFields(
        { name: "Successful", value: String(successful.length), inline: true },
        { name: "Failed", value: String(failed.length), inline: true }
      )
      .setTimestamp();

    if (successful.length > 0) {
      const successList = successful
        .slice(0, 5)
        .map(
          (r) =>
            `- ${r.bookedSlot?.venueName} at ${r.bookedSlot?.slot.time} (User: ${r.discordId})`
        )
        .join("\n");
      embed.addFields({ name: "Booked", value: successList });
    }

    await this.sendDM(this.adminDiscordId, embed);
  }
}

// Singleton instance
let notifier: DiscordNotifier | null = null;

/**
 * Initialize the notifier with a Discord client
 */
export function initializeNotifier(
  client: Client,
  adminDiscordId?: string
): DiscordNotifier {
  notifier = new DiscordNotifier(client, adminDiscordId);
  return notifier;
}

/**
 * Get the notifier singleton
 */
export function getNotifier(): DiscordNotifier | null {
  return notifier;
}
