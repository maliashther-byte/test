import fs from "fs";
import {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle
} from "discord.js";
import { getShops, saveShops } from "../storage.js";

const config = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));

export const data = new SlashCommandBuilder()
  .setName("shoppanel")
  .setDescription("Admin panel for managing shops.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  if (interaction.user.id !== config.ownerId && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "❌ Admins only.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const shops   = await getShops();
  const active  = Object.values(shops).filter(s => s.guildId === interaction.guild.id && Date.now() < s.expiresAt);
  const expired = Object.values(shops).filter(s => s.guildId === interaction.guild.id && Date.now() >= s.expiresAt);
  const trials  = active.filter(s => s.isTrial);

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle("🛍 Shop Admin Panel")
    .setDescription(
      "**Manage all shops in this server.**\n\n" +
      "**Buttons:**\n" +
      "• **Gen Key** → Run `/genkey` to generate a key\n" +
      "• **Open Shop** → Run `/openshop` to open directly\n" +
      "• **Trial Shop** → Run `/shoptrial` for a 12h trial\n" +
      "• **Close Shop** → Closes and deletes a shop channel\n\n" +
      `**Active shops:** ${active.length}\n` +
      `**Trial shops:** ${trials.length}/2\n` +
      `**Expired:** ${expired.length}`
    )
    .addFields(
      active.slice(0, 8).map(s => ({
        name:  `#${s.name} ${s.isTrial ? "🔬 Trial" : ""}`,
        value: `Owner: <@${s.ownerId}> · Expires: <t:${Math.floor(s.expiresAt/1000)}:R>`,
        inline: false
      }))
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("shoppanel_genkey_info").setLabel("🔑 Gen Key Info").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("shoppanel_openshop_info").setLabel("🏪 Open Shop Info").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("shoppanel_trial_info").setLabel("🔬 Trial Info").setStyle(ButtonStyle.Secondary)
  );

  // Close buttons for active shops
  const closeRows = [];
  const chunks = active.slice(0, 5);
  if (chunks.length) {
    const closeRow = new ActionRowBuilder();
    for (const s of chunks) {
      closeRow.addComponents(
        new ButtonBuilder().setCustomId(`shoppanel_close_${s.channelId}`).setLabel(`🗑 ${s.name}`).setStyle(ButtonStyle.Danger)
      );
    }
    closeRows.push(closeRow);
  }

  await interaction.editReply({ embeds: [embed], components: [row, ...closeRows] });
}

export async function handleShopPanelButton(interaction) {
  const id = interaction.customId;

  if (id === "shoppanel_genkey_info") {
    return interaction.reply({ content: "Use `/genkey` to generate a shop key. Set duration, daily/weekly/3-day ping limits.", ephemeral: true });
  }
  if (id === "shoppanel_openshop_info") {
    return interaction.reply({ content: "Use `/openshop` to open a shop directly. Set name, owner, duration, and all ping limits.", ephemeral: true });
  }
  if (id === "shoppanel_trial_info") {
    return interaction.reply({ content: "Use `/shoptrial` to give a 12-hour trial shop. Max 2 trials at once.", ephemeral: true });
  }
  if (id.startsWith("shoppanel_close_")) {
    const channelId = id.replace("shoppanel_close_", "");
    const shops = await getShops();
    const shop  = shops[channelId];
    if (!shop) return interaction.reply({ content: "❌ Shop not found.", ephemeral: true });

    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (channel) await channel.delete("Closed via shop panel").catch(() => {});
    delete shops[channelId];
    await saveShops(shops);
    await interaction.reply({ content: `✅ Shop **${shop.name}** closed.`, ephemeral: true });
  }
}