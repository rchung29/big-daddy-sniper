/**
 * /restaurants command - Show available restaurants in the library
 */
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { store } from "../../store";

export const restaurantsCommand = new SlashCommandBuilder()
  .setName("restaurants")
  .setDescription("Show available restaurants in the sniper library")
  .addStringOption((option) =>
    option
      .setName("search")
      .setDescription("Search by name (optional)")
      .setRequired(false)
  );

export async function handleRestaurants(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const searchQuery = interaction.options.getString("search");

  // Defer reply
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const restaurants = searchQuery
      ? store.searchRestaurantsByName(searchQuery)
      : store.getAllRestaurants();

    if (restaurants.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle("No Restaurants Found")
        .setDescription(
          searchQuery
            ? `No restaurants found matching "${searchQuery}"`
            : "No restaurants in the library yet"
        )
        .setColor(0xf39c12);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Group by release time
    const byReleaseTime = new Map<string, typeof restaurants>();
    for (const r of restaurants) {
      const existing = byReleaseTime.get(r.release_time) ?? [];
      existing.push(r);
      byReleaseTime.set(r.release_time, existing);
    }

    // Build embed
    const embed = new EmbedBuilder()
      .setTitle("Restaurant Library")
      .setDescription(
        searchQuery
          ? `Found ${restaurants.length} restaurant(s) matching "${searchQuery}"`
          : `${restaurants.length} restaurants available for sniping`
      )
      .setColor(0x3498db);

    // Add fields for each release time group
    const sortedTimes = Array.from(byReleaseTime.keys()).sort();
    for (const releaseTime of sortedTimes) {
      const group = byReleaseTime.get(releaseTime)!;
      const restaurantList = group
        .slice(0, 10) // Limit to avoid Discord field limit
        .map(
          (r) =>
            `**${r.name}** (${r.neighborhood ?? "NYC"})\n` +
            `  ${r.days_in_advance} days out${r.cuisine ? ` | ${r.cuisine}` : ""}`
        )
        .join("\n");

      const moreCount = group.length > 10 ? ` (+${group.length - 10} more)` : "";

      embed.addFields({
        name: `${releaseTime} EST${moreCount}`,
        value: restaurantList.slice(0, 1024),
      });
    }

    embed.setFooter({
      text: "Use /subscribe <restaurant> to start sniping!",
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const embed = new EmbedBuilder()
      .setTitle("Error")
      .setDescription(`An error occurred: ${String(error)}`)
      .setColor(0xe74c3c);

    await interaction.editReply({ embeds: [embed] });
  }
}
