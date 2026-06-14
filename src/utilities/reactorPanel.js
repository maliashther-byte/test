import fs from "fs";
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getAutoReactors, removeReactorForChannel, setReactorForChannel } from "../games/gamesStorage.js";

const config = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));

export const data = new SlashCommandBuilder()
  .setName("reactorpanel")
  .setDescription("Manage all auto-reactors in this server.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const all     = await getAutoReactors();
  const entries = Object.values(all).filter(r => r.guildId === interaction.guild.id);

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle("😀 Auto-Reactor Panel")
    .setDescription(
      "**What is Auto-React?**\nThe bot automatically reacts to messages in selected channels with set emojis.\n\n" +
      "**How to use:**\n" +
      "• `/autoreact set #channel emojis` — Set reactions\n" +
      "• `/autoreact remove #channel` — Remove\n" +
      "• `/autoreact pause #channel` — Toggle pause\n" +
      "• `/autoreact list` — View all\n\n" +
      "**Options:**\n" +
      "• `keyword` — Only react to messages containing a word\n" +
      "• `role` — Only react to messages from a specific role\n" +
      "• `bots` — Also react to bot messages\n\n" +
      `**Active Reactors:** ${entries.length}`
    );

  if (entries.length) {
    embed.addFields(
      entries.slice(0, 10).map(r => ({
        name:  `<#${r.channelId}> ${r.paused ? "⏸" : "▶️"}`,
        value: `${r.emojis.join(" ")}${r.keyword ? ` · 🔑 \`${r.keyword}\`` : ""}${r.roleId ? ` · 👥 <@&${r.roleId}>` : ""}`,
        inline: false
      }))
    );
  }

  const rows = [];
  if (entries.length) {
    const chunks = entries.slice(0, 5);
    const row = new ActionRowBuilder();
    for (const r of chunks) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`reactor_remove_${r.channelId}`)
          .setLabel(`🗑 #${r.channelId.slice(-4)}`)
          .setStyle(ButtonStyle.Danger)
      );
    }
    rows.push(row);
  }

  await interaction.editReply({ embeds: [embed], components: rows });
}

export async function handleReactorPanelButton(interaction) {
  const channelId = interaction.customId.replace("reactor_remove_", "");
  await removeReactorForChannel(channelId);
  await interaction.reply({ content: `✅ Auto-reactor removed for <#${channelId}>.`, ephemeral: true });
}