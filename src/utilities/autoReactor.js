import fs from "fs";
import {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder
} from "discord.js";
import { getReactorForChannel, setReactorForChannel, removeReactorForChannel, getAutoReactors } from "../games/gamesStorage.js";

const config = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));

// ─── /autoreact ───────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("autoreact")
  .setDescription("Manage auto-reactions for a channel.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addSubcommand(sub =>
    sub.setName("set")
      .setDescription("Set auto-reactions for a channel.")
      .addChannelOption(o => o.setName("channel").setDescription("Channel to set reactions for").setRequired(true))
      .addStringOption(o => o.setName("emojis").setDescription("Emojis to react with (space-separated, max 5)").setRequired(true))
      .addStringOption(o => o.setName("keyword").setDescription("Only react to messages containing this word (optional)").setRequired(false))
      .addRoleOption(o => o.setName("role").setDescription("Only react to messages from this role (optional)").setRequired(false))
      .addBooleanOption(o => o.setName("bots").setDescription("Also react to bot messages? (default: no)").setRequired(false))
  )
  .addSubcommand(sub =>
    sub.setName("remove")
      .setDescription("Remove auto-reactions from a channel.")
      .addChannelOption(o => o.setName("channel").setDescription("Channel to remove reactions from").setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName("list")
      .setDescription("List all active auto-reactors in this server.")
  )
  .addSubcommand(sub =>
    sub.setName("pause")
      .setDescription("Pause/unpause auto-reactions in a channel.")
      .addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true))
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "set") {
    const channel  = interaction.options.getChannel("channel");
    const emojiStr = interaction.options.getString("emojis").trim();
    const keyword  = interaction.options.getString("keyword")?.toLowerCase() ?? null;
    const role     = interaction.options.getRole("role");
    const bots     = interaction.options.getBoolean("bots") ?? false;

    // Parse emojis (split by space, max 5)
    const emojis = emojiStr.split(/\s+/).slice(0, 5).filter(Boolean);
    if (!emojis.length) return interaction.reply({ content: "❌ No valid emojis found.", ephemeral: true });

    await setReactorForChannel(channel.id, {
      channelId: channel.id,
      guildId:   interaction.guild.id,
      emojis,
      keyword,
      roleId:    role?.id ?? null,
      reactToBots: bots,
      paused:    false,
      createdBy: interaction.user.id,
      createdAt: new Date().toISOString()
    });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("✅ Auto-React Set")
      .addFields(
        { name: "📢 Channel",  value: `${channel}`,                       inline: true },
        { name: "😀 Emojis",  value: emojis.join(" "),                    inline: true },
        { name: "🔑 Keyword", value: keyword ?? "Any message",            inline: true },
        { name: "👥 Role",    value: role ? `${role}` : "Any role",       inline: true },
        { name: "🤖 Bots",    value: bots ? "Yes" : "No",                 inline: true }
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === "remove") {
    const channel = interaction.options.getChannel("channel");
    const existing = await getReactorForChannel(channel.id);
    if (!existing || existing.guildId !== interaction.guild.id) {
      return interaction.reply({ content: "❌ No auto-reactor found for that channel.", ephemeral: true });
    }
    await removeReactorForChannel(channel.id);
    await interaction.reply({ content: `✅ Auto-reactions removed from ${channel}.`, ephemeral: true });
    return;
  }

  if (sub === "list") {
    const all     = await getAutoReactors();
    const entries = Object.values(all).filter(r => r.guildId === interaction.guild.id);
    if (!entries.length) return interaction.reply({ content: "No auto-reactors active.", ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("😀 Active Auto-Reactors")
      .addFields(
        entries.map(r => ({
          name:   `<#${r.channelId}> ${r.paused ? "(paused)" : ""}`,
          value:  `Emojis: ${r.emojis.join(" ")}${r.keyword ? ` · Keyword: \`${r.keyword}\`` : ""}${r.roleId ? ` · Role: <@&${r.roleId}>` : ""}`,
          inline: false
        }))
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === "pause") {
    const channel  = interaction.options.getChannel("channel");
    const existing = await getReactorForChannel(channel.id);
    if (!existing || existing.guildId !== interaction.guild.id) {
      return interaction.reply({ content: "❌ No auto-reactor for that channel.", ephemeral: true });
    }
    existing.paused = !existing.paused;
    await setReactorForChannel(channel.id, existing);
    await interaction.reply({ content: `✅ Auto-reactions in ${channel} are now **${existing.paused ? "paused" : "active"}**.`, ephemeral: true });
  }
}

// ─── messageCreate — apply reactions ─────────────────────────────────────────
export async function handleAutoReact(message) {
  if (!message.guild) return;

  const reactor = await getReactorForChannel(message.channel.id);
  if (!reactor || reactor.paused) return;
  if (reactor.guildId !== message.guild.id) return;
  if (message.author.bot && !reactor.reactToBots) return;

  // Keyword filter
  if (reactor.keyword && !message.content.toLowerCase().includes(reactor.keyword)) return;

  // Role filter
  if (reactor.roleId) {
    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member?.roles.cache.has(reactor.roleId)) return;
  }

  // Apply reactions
  for (const emoji of reactor.emojis) {
    await message.react(emoji).catch(() => {});
  }
}