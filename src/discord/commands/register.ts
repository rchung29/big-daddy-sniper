/**
 * /register command - Link Resy account to Discord
 */
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { store } from "../../store";

export const registerCommand = new SlashCommandBuilder()
  .setName("register")
  .setDescription("Link your Resy account to the sniper bot")
  .addStringOption((option) =>
    option
      .setName("auth_token")
      .setDescription("Your Resy auth token (from browser cookies)")
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName("payment_method_id")
      .setDescription("Your Resy payment method ID")
      .setRequired(true)
  );

export async function handleRegister(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const authToken = interaction.options.getString("auth_token", true);
  const paymentMethodId = interaction.options.getInteger("payment_method_id", true);
  const discordId = interaction.user.id;
  const discordUsername = interaction.user.username;

  // Defer reply since this might take a moment
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Upsert user with Resy credentials
    await store.upsertUser(discordId, {
      discord_username: discordUsername,
      resy_auth_token: authToken,
      resy_payment_method_id: paymentMethodId,
    });

    const embed = new EmbedBuilder()
      .setTitle("Registration Successful")
      .setDescription("Your Resy account has been linked to the sniper bot.")
      .setColor(0x2ecc71)
      .addFields(
        { name: "Payment Method ID", value: String(paymentMethodId), inline: true }
      )
      .setFooter({
        text: "Use /subscribe to start sniping restaurants!",
      });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const embed = new EmbedBuilder()
      .setTitle("Registration Failed")
      .setDescription(`An error occurred: ${String(error)}`)
      .setColor(0xe74c3c);

    await interaction.editReply({ embeds: [embed] });
  }
}
