/**
 * /list command - Show user's subscriptions
 */
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { store } from "../../store";

/**
 * Format day numbers back to readable string
 */
function formatDays(days: number[] | null): string {
  if (!days || days.length === 0) return "Any day";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days.map(d => names[d]).join(", ");
}

export const listCommand = new SlashCommandBuilder()
  .setName("list")
  .setDescription("Show your subscriptions");

export async function handleList(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordId = interaction.user.id;

  // Defer reply
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Get user
    const user = store.getUserByDiscordId(discordId);
    if (!user) {
      const embed = new EmbedBuilder()
        .setTitle("Not Registered")
        .setDescription("You don't have an account yet.")
        .setColor(0xf39c12)
        .setFooter({ text: "Use /register to create an account" });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const registered = store.isUserRegistered(user.id);
    const subscriptions = store.getSubscriptionsByUser(user.id);

    // Build embed
    const embed = new EmbedBuilder()
      .setTitle("Your Sniper Status")
      .setColor(registered ? 0x2ecc71 : 0xf39c12);

    // Registration status
    embed.addFields({
      name: "Registration",
      value: registered ? "Linked" : "Not linked - use /register",
      inline: true,
    });

    // Subscriptions
    if (subscriptions.length === 0) {
      embed.addFields({
        name: "Subscriptions",
        value: "None - use /subscribe to add restaurants",
      });
    } else {
      const subList = subscriptions
        .map((s) => {
          const restaurant = store.getRestaurantById(s.restaurant_id);
          if (!restaurant) return null;
          const daysStr = formatDays(s.target_days);
          return (
            `**${restaurant.name}**\n` +
            `  Party: ${s.party_size} | Time: ${s.time_window_start}-${s.time_window_end}\n` +
            `  Release: ${restaurant.release_time} EST (${restaurant.days_in_advance} days)\n` +
            `  Days: ${daysStr}`
          );
        })
        .filter(Boolean)
        .join("\n\n");

      embed.addFields({
        name: `Subscriptions (${subscriptions.length})`,
        value: subList.slice(0, 1024) || "None",
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const embed = new EmbedBuilder()
      .setTitle("Error")
      .setDescription(`An error occurred: ${String(error)}`)
      .setColor(0xe74c3c);

    await interaction.editReply({ embeds: [embed] });
  }
}
