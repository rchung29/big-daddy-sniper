/**
 * /unsubscribe command - Remove subscription from a restaurant
 */
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { store } from "../../store";

export const unsubscribeCommand = new SlashCommandBuilder()
  .setName("unsubscribe")
  .setDescription("Unsubscribe from a restaurant")
  .addStringOption((option) =>
    option
      .setName("restaurant")
      .setDescription("Restaurant name (partial match)")
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName("party_size")
      .setDescription("Party size (if you have multiple subscriptions)")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(20)
  );

export async function handleUnsubscribe(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const restaurantQuery = interaction.options.getString("restaurant", true);
  const partySize = interaction.options.getInteger("party_size");
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

    // Search for restaurant
    const restaurants = store.searchRestaurantsByName(restaurantQuery);

    if (restaurants.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle("Restaurant Not Found")
        .setDescription(`No restaurant found matching "${restaurantQuery}"`)
        .setColor(0xe74c3c);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (restaurants.length > 1) {
      const options = restaurants
        .slice(0, 10)
        .map((r) => `- **${r.name}**`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("Multiple Matches")
        .setDescription(`Found multiple restaurants. Please be more specific:\n\n${options}`)
        .setColor(0xf39c12);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const restaurant = restaurants[0];

    // Get all subscriptions for this user + restaurant
    const userSubs = store.getSubscriptionsByUser(user.id);
    const matchingSubs = userSubs.filter(s => s.restaurant_id === restaurant.id);

    if (matchingSubs.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle("Not Subscribed")
        .setDescription(`You're not subscribed to **${restaurant.name}**`)
        .setColor(0xf39c12);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // If multiple subscriptions and no party_size specified, show options
    if (matchingSubs.length > 1 && partySize === null) {
      const options = matchingSubs
        .map((s) => `- Party of **${s.party_size}** (${s.time_window_start}-${s.time_window_end})`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("Multiple Subscriptions")
        .setDescription(
          `You have multiple subscriptions to **${restaurant.name}**. ` +
          `Please specify party_size:\n\n${options}`
        )
        .setColor(0xf39c12);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Find the specific subscription to delete
    const subToDelete = partySize !== null
      ? matchingSubs.find(s => s.party_size === partySize)
      : matchingSubs[0];

    if (!subToDelete) {
      const embed = new EmbedBuilder()
        .setTitle("Not Found")
        .setDescription(`No subscription found for **${restaurant.name}** with party size ${partySize}`)
        .setColor(0xf39c12);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Delete subscription (updates memory + writes to DB)
    await store.deleteSubscription(user.id, restaurant.id, subToDelete.party_size);

    const embed = new EmbedBuilder()
      .setTitle("Unsubscribed")
      .setDescription(`You've been unsubscribed from **${restaurant.name}** (party of ${subToDelete.party_size})`)
      .setColor(0x3498db);

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const embed = new EmbedBuilder()
      .setTitle("Error")
      .setDescription(`An error occurred: ${String(error)}`)
      .setColor(0xe74c3c);

    await interaction.editReply({ embeds: [embed] });
  }
}
