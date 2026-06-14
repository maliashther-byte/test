import fs from "fs";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { getGuildConfigs, saveGuildConfigs } from "../storage.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

export const data = new SlashCommandBuilder()
  .setName("premium")
  .setDescription("View premium vs free plans and manage premium.");

export async function execute(interaction) {
  const guild = interaction.guild;
  const configs = await getGuildConfigs();
  const gCfg = guild ? configs[guild.id] : null;
  const plan = gCfg?.plan || "free";

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle("Premium Plan")
    .setDescription(
      [
        "Below is a comparison between **Free** and **Premium**:",
        "",
        "```",
        "Feature                 | Free        | Premium",
        "------------------------+------------+----------------",
        "Max shops per server    | 3          | Unlimited",
        "YT verify channels      | 1          | 3",
        "Owner support           | None       | Unlimited",
        "Custom PFP/Banner       | No         | Yes",
        "```",
        "",
        "💰 **Price:** £2 in LTC",
        "",
        `Current server plan: **${plan.toUpperCase()}**`
      ].join("\n")
    )
    .setFooter({
      text: "To upgrade, follow the purchase instructions below."
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("premium_purchase")
      .setLabel("Purchase")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("premium_owner")
      .setLabel("Owner")
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true
  });
}

// Button + modal handlers will be wired in index.js
export async function handlePremiumButton(interaction) {
  if (interaction.customId === "premium_purchase") {
    return interaction.reply({
      content:
        [
          "**How to purchase Premium (per server):**",
          "",
          "1. Send **£2** in LTC to this address:",
          "```",
          "ltc1qh7xcmeeqa3hgm8w66mtdy9yr829qlgr34swu2e",
          "```",
          "2. DM **kingali69** with:",
          "   • Proof of payment",
          "   • The **server ID** you want Premium on",
          "3. Wait for confirmation and enjoy Premium features."
        ].join("\n"),
      ephemeral: true
    });
  }

  if (interaction.customId === "premium_owner") {
    if (interaction.user.id !== config.ownerId) {
      return interaction.reply({
        content: "Owner button is only for the bot owner.",
        ephemeral: true
      });
    }

    const modal = new ModalBuilder()
      .setCustomId("premium_owner_modal")
      .setTitle("Manage Premium");

    const guildIdInput = new TextInputBuilder()
      .setCustomId("guild_id")
      .setLabel("Guild ID")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const actionInput = new TextInputBuilder()
      .setCustomId("action")
      .setLabel("Action (give / revoke)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const row1 = new ActionRowBuilder().addComponents(guildIdInput);
    const row2 = new ActionRowBuilder().addComponents(actionInput);

    modal.addComponents(row1, row2);
    return interaction.showModal(modal);
  }
}

export async function handlePremiumModal(interaction) {
  if (interaction.customId !== "premium_owner_modal") return;

  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({
      content: "Not for you.",
      ephemeral: true
    });
  }

  const guildId = interaction.fields.getTextInputValue("guild_id").trim();
  const action = interaction.fields.getTextInputValue("action").trim().toLowerCase();

  const configs = await getGuildConfigs();
  const gCfg = configs[guildId] || { guildId };

  if (action === "give") {
    gCfg.plan = "premium";
  } else if (action === "revoke") {
    gCfg.plan = "free";
  } else {
    return interaction.reply({
      content: "Action must be `give` or `revoke`.",
      ephemeral: true
    });
  }

  configs[guildId] = gCfg;
  await saveGuildConfigs(configs);

  await interaction.reply({
    content: `Set plan for guild \`${guildId}\` to **${gCfg.plan.toUpperCase()}**.`,
    ephemeral: true
  });
}
