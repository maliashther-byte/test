/**
 * /limitedoffer — Post a limited-time points shop in the guide channel.
 * Owner inputs 1–3 items with names and point costs.
 * An embed is posted with a "Buy" button per item.
 * Clicking opens a ticket; owner marks fulfilled → points deducted.
 */

import fs from "fs";
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";
import { getWorkerConfig } from "../workerStorage.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

export const data = new SlashCommandBuilder()
  .setName("limitedoffer")
  .setDescription("Post a limited-time points offer in the guide channel.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(o =>
    o.setName("item1_name").setDescription("Item 1 name").setRequired(true).setMaxLength(50)
  )
  .addIntegerOption(o =>
    o.setName("item1_cost").setDescription("Item 1 point cost").setRequired(true).setMinValue(1)
  )
  .addStringOption(o =>
    o.setName("item2_name").setDescription("Item 2 name (optional)").setRequired(false).setMaxLength(50)
  )
  .addIntegerOption(o =>
    o.setName("item2_cost").setDescription("Item 2 point cost").setRequired(false).setMinValue(1)
  )
  .addStringOption(o =>
    o.setName("item3_name").setDescription("Item 3 name (optional)").setRequired(false).setMaxLength(50)
  )
  .addIntegerOption(o =>
    o.setName("item3_cost").setDescription("Item 3 point cost").setRequired(false).setMinValue(1)
  )
  .addStringOption(o =>
    o.setName("description")
      .setDescription("Optional offer description / notes")
      .setRequired(false)
      .setMaxLength(200)
  );

export async function execute(interaction) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: "❌ Only the bot owner can post offers.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guild.id;
  const cfg = (await getWorkerConfig())[guildId];
  if (!cfg) {
    return interaction.editReply({ content: "❌ Worker system not set up. Run `/workersetup` first." });
  }

  const guideChannel = await interaction.guild.channels.fetch(cfg.guideChannelId).catch(() => null);
  if (!guideChannel) {
    return interaction.editReply({ content: "❌ Guide channel not found." });
  }

  // Collect items
  const items = [];
  for (let i = 1; i <= 3; i++) {
    const name = interaction.options.getString(`item${i}_name`);
    const cost = interaction.options.getInteger(`item${i}_cost`);
    if (name && cost !== null) {
      items.push({ name, cost });
    }
  }

  if (items.length === 0) {
    return interaction.editReply({ content: "❌ Provide at least one item." });
  }

  const description = interaction.options.getString("description") ?? null;

  // Build embed
  const itemLines = items.map((item, idx) =>
    `**${idx + 1}. ${item.name}** — 🪙 ${item.cost} point${item.cost !== 1 ? "s" : ""}`
  ).join("\n");

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle("🛒 Limited Time Offer!")
    .setDescription(
      [
        description ?? "Spend your points on exclusive items — limited availability!",
        "",
        itemLines,
        "",
        "Press a button below to purchase. A private ticket will open.",
        "You must have enough points — they will be deducted when the owner confirms delivery."
      ].join("\n")
    )
    .setFooter({ text: "Points are deducted only when your item is confirmed as delivered." })
    .setTimestamp();

  // Build buttons — one per item
  const buttons = items.map((item, idx) =>
    new ButtonBuilder()
      .setCustomId(`offer_buy_${idx}_${encodeItem(item.name)}_${item.cost}`)
      .setLabel(`Buy: ${item.name} (${item.cost} pts)`)
      .setStyle(ButtonStyle.Primary)
  );

  const row = new ActionRowBuilder().addComponents(...buttons);

  await guideChannel.send({ embeds: [embed], components: [row] });

  await interaction.editReply({
    content: `✅ Limited offer posted in <#${cfg.guideChannelId}> with ${items.length} item${items.length !== 1 ? "s" : ""}.`
  });
}

function encodeItem(name) {
  // Safe for customId — strip special chars, max 30 chars
  return name.replace(/[^a-zA-Z0-9]/g, "").substring(0, 30);
}
