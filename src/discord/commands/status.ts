/**
 * /status command - Show bot status and upcoming windows
 */
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { calculateReleaseWindows } from "../../services/scheduler";
import { getProxyManager } from "../../services/proxy-manager";
import { getIspProxyPool } from "../../services/isp-proxy-pool";
import { store } from "../../store";

export const statusCommand = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Show bot status and upcoming release windows");

export async function handleStatus(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  // Defer reply
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const proxyManager = getProxyManager();
    const datacenterStatus = proxyManager.getStatus();
    const ispPoolStatus = getIspProxyPool().getStatus();
    const storeStatus = store.getStatus();

    const users = store.getAllUsers();
    const restaurants = store.getAllRestaurants();
    const windows = calculateReleaseWindows();

    // Build embed
    const embed = new EmbedBuilder()
      .setTitle("Big Daddy Sniper Status")
      .setColor(0x3498db)
      .setTimestamp();

    // System stats
    embed.addFields(
      {
        name: "Registered Users",
        value: String(users.filter((u) => u.resy_auth_token).length),
        inline: true,
      },
      {
        name: "Restaurants",
        value: String(restaurants.length),
        inline: true,
      },
      {
        name: "Datacenter Proxies",
        value: `${datacenterStatus.available} available`,
        inline: true,
      },
      {
        name: "ISP Proxies",
        value: `${ispPoolStatus.available}/${ispPoolStatus.total} available (${ispPoolStatus.inUse} in use, ${ispPoolStatus.cooldown} cooldown)`,
        inline: true,
      }
    );

    // Upcoming windows
    if (windows.length === 0) {
      embed.addFields({
        name: "Upcoming Windows",
        value: "No active subscriptions",
      });
    } else {
      const windowList = windows
        .slice(0, 5)
        .map((w) => {
          const timeUntil = w.scanStartDateTime.getTime() - Date.now();
          const minutesUntil = Math.round(timeUntil / 60000);
          const timeStr =
            minutesUntil > 0
              ? `in ${minutesUntil} min`
              : minutesUntil > -120
              ? "NOW"
              : "passed";

          return (
            `**${w.releaseTime} EST** (${timeStr})\n` +
            `  Target: ${w.targetDate}\n` +
            `  Restaurants: ${w.restaurants.map((r) => r.name).join(", ")}\n` +
            `  Subscriptions: ${w.subscriptions.length}`
          );
        })
        .join("\n\n");

      embed.addFields({
        name: `Upcoming Windows (${windows.length})`,
        value: windowList.slice(0, 1024),
      });
    }

    // Memory usage and sync status
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const lastSync = storeStatus.lastSyncAt
      ? `Last sync: ${formatTimeAgo(storeStatus.lastSyncAt)}`
      : "Not synced";
    embed.setFooter({ text: `Memory: ${memMB}MB | Uptime: ${formatUptime()} | ${lastSync}` });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const embed = new EmbedBuilder()
      .setTitle("Error")
      .setDescription(`An error occurred: ${String(error)}`)
      .setColor(0xe74c3c);

    await interaction.editReply({ embeds: [embed] });
  }
}

function formatUptime(): string {
  const uptimeSeconds = process.uptime();
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
