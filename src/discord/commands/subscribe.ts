/**
 * /subscribe command - Subscribe to a restaurant
 */
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { store } from "../../store";

// Day name to number mapping (0 = Sunday, 6 = Saturday)
const DAY_MAP: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

/**
 * Parse day string into array of day numbers
 * Supports: "Fri,Sat,Sun", "weekends", "weekdays", "any"
 */
function parseDays(input: string): number[] | null {
  const lower = input.toLowerCase().trim();

  // Special keywords
  if (lower === "any" || lower === "all") return null;
  if (lower === "weekends" || lower === "weekend") return [5, 6, 0]; // Fri, Sat, Sun
  if (lower === "weekdays" || lower === "weekday") return [1, 2, 3, 4, 5]; // Mon-Fri

  // Parse comma-separated days
  const days = new Set<number>();
  for (const part of lower.split(/[,\s]+/)) {
    const day = DAY_MAP[part];
    if (day !== undefined) {
      days.add(day);
    }
  }

  return days.size > 0 ? Array.from(days).sort((a, b) => a - b) : null;
}

/**
 * Format day numbers back to readable string
 */
function formatDays(days: number[] | null): string {
  if (!days || days.length === 0) return "Any day";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days.map(d => names[d]).join(", ");
}

export const subscribeCommand = new SlashCommandBuilder()
  .setName("subscribe")
  .setDescription("Subscribe to a restaurant for automatic sniping")
  .addStringOption((option) =>
    option
      .setName("restaurant")
      .setDescription("Restaurant name (partial match)")
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName("party_size")
      .setDescription("Number of guests (default: 2)")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(20)
  )
  .addStringOption((option) =>
    option
      .setName("time_start")
      .setDescription("Start of time window (HH:mm, e.g., 18:00)")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("time_end")
      .setDescription("End of time window (HH:mm, e.g., 21:00)")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("table_types")
      .setDescription("Table types (comma-separated, e.g., 'Dining Room,Bar')")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("days")
      .setDescription("Target days of week (e.g., 'Fri,Sat,Sun' or 'weekends')")
      .setRequired(false)
  );

export async function handleSubscribe(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const restaurantQuery = interaction.options.getString("restaurant", true);
  const partySize = interaction.options.getInteger("party_size") ?? 2;
  const timeStart = interaction.options.getString("time_start") ?? "17:00";
  const timeEnd = interaction.options.getString("time_end") ?? "22:00";
  const tableTypesStr = interaction.options.getString("table_types");
  const daysStr = interaction.options.getString("days");
  const discordId = interaction.user.id;

  // Defer reply
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Check if user is registered
    const user = store.getUserByDiscordId(discordId);
    if (!user || !store.isUserRegistered(user.id)) {
      const embed = new EmbedBuilder()
        .setTitle("Not Registered")
        .setDescription("You need to register your Resy account first.")
        .setColor(0xf39c12)
        .setFooter({ text: "Use /register to link your Resy account" });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Validate time format
    const timeRegex = /^\d{2}:\d{2}$/;
    if (!timeRegex.test(timeStart) || !timeRegex.test(timeEnd)) {
      const embed = new EmbedBuilder()
        .setTitle("Invalid Time Format")
        .setDescription("Time must be in HH:mm format (e.g., 18:00)")
        .setColor(0xe74c3c);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Search for restaurant in memory
    const restaurants = store.searchRestaurantsByName(restaurantQuery);

    if (restaurants.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle("Restaurant Not Found")
        .setDescription(`No restaurant found matching "${restaurantQuery}"`)
        .setColor(0xe74c3c)
        .setFooter({ text: "Use /restaurants to see available restaurants" });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (restaurants.length > 1) {
      // Show options if multiple matches
      const options = restaurants
        .slice(0, 10)
        .map((r) => `- **${r.name}** (${r.neighborhood ?? "N/A"})`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("Multiple Matches")
        .setDescription(`Found multiple restaurants. Please be more specific:\n\n${options}`)
        .setColor(0xf39c12);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const restaurant = restaurants[0];

    // Parse table types
    const tableTypes = tableTypesStr
      ? tableTypesStr.split(",").map((t) => t.trim())
      : undefined;

    // Parse target days
    const targetDays = daysStr ? parseDays(daysStr) : null;

    // Create subscription (updates memory + writes to DB)
    await store.upsertSubscription(user.id, restaurant.id, {
      party_size: partySize,
      time_window_start: timeStart,
      time_window_end: timeEnd,
      table_types: tableTypes,
      target_days: targetDays,
    });

    const embed = new EmbedBuilder()
      .setTitle("Subscription Created")
      .setDescription(`You're now subscribed to **${restaurant.name}**`)
      .setColor(0x2ecc71)
      .addFields(
        { name: "Party Size", value: String(partySize), inline: true },
        { name: "Time Window", value: `${timeStart} - ${timeEnd}`, inline: true },
        {
          name: "Release Time",
          value: `${restaurant.release_time} EST (${restaurant.days_in_advance} days out)`,
          inline: true,
        }
      );

    if (tableTypes && tableTypes.length > 0) {
      embed.addFields({
        name: "Table Types",
        value: tableTypes.join(", "),
        inline: true,
      });
    }

    embed.addFields({
      name: "Target Days",
      value: formatDays(targetDays),
      inline: true,
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const embed = new EmbedBuilder()
      .setTitle("Subscription Failed")
      .setDescription(`An error occurred: ${String(error)}`)
      .setColor(0xe74c3c);

    await interaction.editReply({ embeds: [embed] });
  }
}
