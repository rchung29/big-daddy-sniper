/**
 * Discord Bot
 * Handles user registration, subscription management, and notifications
 */
import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type Interaction,
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import pino from "pino";

// Import commands
import { registerCommand, handleRegister } from "./commands/register";
import { subscribeCommand, handleSubscribe } from "./commands/subscribe";
import { unsubscribeCommand, handleUnsubscribe } from "./commands/unsubscribe";
import { listCommand, handleList } from "./commands/list";
import { restaurantsCommand, handleRestaurants } from "./commands/restaurants";
import { statusCommand, handleStatus } from "./commands/status";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

/**
 * All slash commands
 */
const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  registerCommand.toJSON(),
  subscribeCommand.toJSON(),
  unsubscribeCommand.toJSON(),
  listCommand.toJSON(),
  restaurantsCommand.toJSON(),
  statusCommand.toJSON(),
];

/**
 * Command handlers map
 */
const commandHandlers: Record<
  string,
  (interaction: ChatInputCommandInteraction) => Promise<void>
> = {
  register: handleRegister,
  subscribe: handleSubscribe,
  unsubscribe: handleUnsubscribe,
  list: handleList,
  restaurants: handleRestaurants,
  status: handleStatus,
};

/**
 * Discord bot class
 */
export class DiscordBot {
  private client: Client;
  private token: string;
  private clientId: string;

  constructor(config: { token: string; clientId: string }) {
    this.token = config.token;
    this.clientId = config.clientId;

    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
    });

    this.setupEventHandlers();
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, () => {
      logger.info(
        { username: this.client.user?.tag },
        "Discord bot is ready"
      );
    });

    this.client.on(Events.InteractionCreate, async (interaction: Interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const handler = commandHandlers[interaction.commandName];
      if (!handler) {
        logger.warn(
          { command: interaction.commandName },
          "Unknown command received"
        );
        return;
      }

      try {
        await handler(interaction);
      } catch (error) {
        logger.error(
          { command: interaction.commandName, error: String(error) },
          "Error handling command"
        );

        const errorMessage = "An error occurred while processing your command.";
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
          await interaction.reply({ content: errorMessage, ephemeral: true });
        }
      }
    });

    this.client.on("error", (error) => {
      logger.error({ error: String(error) }, "Discord client error");
    });
  }

  /**
   * Register slash commands with Discord
   */
  async registerCommands(): Promise<void> {
    const rest = new REST().setToken(this.token);

    try {
      logger.info(
        { commandCount: commands.length },
        "Registering slash commands..."
      );

      await rest.put(Routes.applicationCommands(this.clientId), {
        body: commands,
      });

      logger.info("Slash commands registered successfully");
    } catch (error) {
      logger.error({ error: String(error) }, "Failed to register commands");
      throw error;
    }
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    await this.registerCommands();
    await this.client.login(this.token);
    logger.info("Discord bot started");
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    this.client.destroy();
    logger.info("Discord bot stopped");
  }

  /**
   * Get the Discord client (for notifications)
   */
  getClient(): Client {
    return this.client;
  }
}

// Singleton instance
let discordBot: DiscordBot | null = null;

/**
 * Get the Discord bot singleton
 */
export function getDiscordBot(config?: {
  token: string;
  clientId: string;
}): DiscordBot {
  if (!discordBot) {
    if (!config) {
      throw new Error("Discord bot not initialized - provide config");
    }
    discordBot = new DiscordBot(config);
  }
  return discordBot;
}
