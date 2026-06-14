import fs from "fs";
import {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle
} from "discord.js";
import {
  startGiveaway, endGiveaway, rerollGiveaway,
  buildGiveawayEmbed, REQUIREMENT_TYPES
} from "./giveawayManager.js";
import { getGiveaway, getActiveGiveaways, saveGiveaway } from "./giveawayStorage.js";

const config   = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));
const OWNER_ID = config.ownerId;

// ─── Helper: parse duration string ───────────────────────────────────────────
// Accepts: 10s, 5m, 2h, 1d, 1h30m, etc.
function parseDuration(str) {
  let ms = 0;
  const matches = str.matchAll(/(\d+)\s*(d|h|m|s)/gi);
  for (const m of matches) {
    const n = parseInt(m[1]);
    switch (m[2].toLowerCase()) {
      case "d": ms += n * 86400000; break;
      case "h": ms += n * 3600000;  break;
      case "m": ms += n * 60000;    break;
      case "s": ms += n * 1000;     break;
    }
  }
  return ms;
}

// ─── /gcreate ─────────────────────────────────────────────────────────────────
export const gcreateData = new SlashCommandBuilder()
  .setName("gcreate")
  .setDescription("Create a giveaway.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o => o.setName("prize").setDescription("What are you giving away?").setRequired(true).setMaxLength(200))
  .addStringOption(o => o.setName("duration").setDescription("How long? (e.g. 1h, 30m, 2d)").setRequired(true))
  .addIntegerOption(o => o.setName("winners").setDescription("Number of winners (default: 1)").setMinValue(1).setMaxValue(20).setRequired(false))
  .addChannelOption(o => o.setName("channel").setDescription("Channel to post in (default: current)").setRequired(false))
  // Requirements
  .addStringOption(o => o.setName("req_join_server").setDescription("Require joining a server (paste server invite link)").setRequired(false))
  .addIntegerOption(o => o.setName("req_account_age").setDescription("Minimum account age in days").setMinValue(1).setRequired(false))
  .addRoleOption(o => o.setName("req_role").setDescription("Require a specific role").setRequired(false))
  .addStringOption(o => o.setName("req_trivia_question").setDescription("Trivia question to answer (must also set req_trivia_answer)").setRequired(false))
  .addStringOption(o => o.setName("req_trivia_answer").setDescription("Correct answer to the trivia question").setRequired(false))
  .addBooleanOption(o => o.setName("req_wordle").setDescription("Require today's Wordle result").setRequired(false))
  .addStringOption(o => o.setName("req_short_question").setDescription("Short answer question (host reviews entries)").setRequired(false))
  .addIntegerOption(o => o.setName("req_message_count").setDescription("Minimum messages sent in this server").setMinValue(1).setRequired(false));

export async function executeGCreate(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const prize       = interaction.options.getString("prize");
  const durationStr = interaction.options.getString("duration");
  const winnerCount = interaction.options.getInteger("winners") ?? 1;
  const channel     = interaction.options.getChannel("channel") ?? interaction.channel;
  const durationMs  = parseDuration(durationStr);

  if (durationMs < 10000) return interaction.editReply({ content: "❌ Duration must be at least 10 seconds." });
  if (durationMs > 30 * 86400000) return interaction.editReply({ content: "❌ Duration cannot exceed 30 days." });

  // Build requirements list
  const requirements = [];

  const joinServerLink = interaction.options.getString("req_join_server");
  if (joinServerLink) {
    // Resolve invite to get guild ID
    try {
      const match  = joinServerLink.match(/(?:discord\.gg|discord\.com\/invite)\/([a-zA-Z0-9-]+)/);
      const invite = match ? await interaction.client.fetchInvite(match[1]).catch(() => null) : null;
      if (invite?.guild) {
        requirements.push({ type: "join_server", options: { guildId: invite.guild.id, guildName: invite.guild.name, invite: joinServerLink } });
      } else {
        return interaction.editReply({ content: "❌ Could not resolve that invite link. Make sure it's valid." });
      }
    } catch { return interaction.editReply({ content: "❌ Invalid invite link." }); }
  }

  const minAge = interaction.options.getInteger("req_account_age");
  if (minAge) requirements.push({ type: "account_age", options: { minDays: minAge } });

  const reqRole = interaction.options.getRole("req_role");
  if (reqRole) requirements.push({ type: "has_role", options: { roleId: reqRole.id, roleName: reqRole.name } });

  const triviaQ = interaction.options.getString("req_trivia_question");
  const triviaA = interaction.options.getString("req_trivia_answer");
  if (triviaQ && triviaA) requirements.push({ type: "trivia", options: { question: triviaQ, answer: triviaA } });

  if (interaction.options.getBoolean("req_wordle")) requirements.push({ type: "wordle", options: {} });

  const shortQ = interaction.options.getString("req_short_question");
  if (shortQ) requirements.push({ type: "short_answer", options: { question: shortQ } });

  const minMsgs = interaction.options.getInteger("req_message_count");
  if (minMsgs) requirements.push({ type: "message_count", options: { minMessages: minMsgs } });

  const msg = await startGiveaway(channel, interaction.guild, interaction.user.id, {
    prize, winnerCount, durationMs, requirements
  });

  await interaction.editReply({ content: `✅ Giveaway started in ${channel}! [Jump to it](https://discord.com/channels/${interaction.guild.id}/${channel.id}/${msg.id})` });
}

// ─── /gend ────────────────────────────────────────────────────────────────────
export const gendData = new SlashCommandBuilder()
  .setName("gend")
  .setDescription("End a giveaway early.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o => o.setName("message_id").setDescription("Message ID of the giveaway").setRequired(true));

export async function executeGEnd(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const messageId = interaction.options.getString("message_id");
  const giveaway  = await getGiveaway(messageId);
  if (!giveaway || giveaway.guildId !== interaction.guild.id) return interaction.editReply({ content: "❌ Giveaway not found." });
  if (giveaway.ended) return interaction.editReply({ content: "❌ Already ended." });

  const winners = await endGiveaway(messageId, interaction.client);
  await interaction.editReply({ content: winners?.length ? `✅ Giveaway ended. Winner(s): ${winners.map(w => `<@${w}>`).join(", ")}` : "✅ Giveaway ended. No valid entries." });
}

// ─── /greroll ─────────────────────────────────────────────────────────────────
export const grerollData = new SlashCommandBuilder()
  .setName("greroll")
  .setDescription("Reroll a giveaway winner.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o => o.setName("message_id").setDescription("Message ID of the giveaway").setRequired(true));

export async function executeGReroll(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const messageId = interaction.options.getString("message_id");
  const giveaway  = await getGiveaway(messageId);
  if (!giveaway || giveaway.guildId !== interaction.guild.id) return interaction.editReply({ content: "❌ Giveaway not found." });
  if (!giveaway.ended) return interaction.editReply({ content: "❌ Giveaway hasn't ended yet." });

  const newWinner = await rerollGiveaway(messageId, interaction.client);
  if (!newWinner) return interaction.editReply({ content: "❌ No remaining valid entries to reroll." });

  const guild   = interaction.guild;
  const channel = await guild.channels.fetch(giveaway.channelId).catch(() => null);
  if (channel) await channel.send({ content: `🎊 New winner for **${giveaway.prize}**: <@${newWinner}>! Congratulations!`, allowedMentions: { users: [newWinner] } });

  await interaction.editReply({ content: `✅ Rerolled! New winner: <@${newWinner}>` });
}

// ─── /glist ───────────────────────────────────────────────────────────────────
export const glistData = new SlashCommandBuilder()
  .setName("glist")
  .setDescription("List all active giveaways.");

export async function executeGList(interaction) {
  const active = await getActiveGiveaways(interaction.guild.id);
  if (!active.length) return interaction.reply({ content: "No active giveaways.", ephemeral: true });

  const embed = new EmbedBuilder()
    .setColor(0xff6b6b)
    .setTitle("🎉 Active Giveaways")
    .addFields(
      active.map(g => ({
        name:  g.prize,
        value: `Entries: ${Object.keys(g.entries).length} · Winners: ${g.winnerCount} · Ends: <t:${Math.floor(new Date(g.endsAt).getTime() / 1000)}:R>\nID: \`${g.messageId}\``,
        inline: false
      }))
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ─── /gsetwinner — owner only ─────────────────────────────────────────────────
export const gsetwinnerData = new SlashCommandBuilder()
  .setName("gsetwinner")
  .setDescription("[Owner only] Force-set the winner of a giveaway.")
  .addStringOption(o => o.setName("message_id").setDescription("Message ID of the giveaway").setRequired(true))
  .addUserOption(o => o.setName("user").setDescription("The user to set as winner").setRequired(true));

export async function executeGSetWinner(interaction) {
  if (interaction.user.id !== OWNER_ID) {
    return interaction.reply({ content: "❌ This command is owner-only.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const messageId = interaction.options.getString("message_id");
  const user      = interaction.options.getUser("user");
  const giveaway  = await getGiveaway(messageId);

  if (!giveaway) return interaction.editReply({ content: "❌ Giveaway not found." });

  // End the giveaway with forced winner (works on active or ended giveaways)
  if (!giveaway.ended) {
    await endGiveaway(messageId, interaction.client, user.id);
  } else {
    // Already ended — just add to winners list and announce
    if (!giveaway.winners.includes(user.id)) giveaway.winners.push(user.id);
    await saveGiveaway(messageId, giveaway);

    const guild   = await interaction.client.guilds.fetch(giveaway.guildId).catch(() => null);
    const channel = guild ? await guild.channels.fetch(giveaway.channelId).catch(() => null) : null;
    if (channel) {
      await channel.send({ content: `🎊 <@${user.id}> has been selected as the winner of **${giveaway.prize}**!`, allowedMentions: { users: [user.id] } });
    }
  }

  await interaction.editReply({ content: `✅ <@${user.id}> has been set as the winner of **${giveaway.prize}**.` });
}

// ─── /gcancel ─────────────────────────────────────────────────────────────────
export const gcancelData = new SlashCommandBuilder()
  .setName("gcancel")
  .setDescription("Cancel a giveaway without picking a winner.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o => o.setName("message_id").setDescription("Message ID of the giveaway").setRequired(true));

export async function executeGCancel(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const messageId = interaction.options.getString("message_id");
  const giveaway  = await getGiveaway(messageId);
  if (!giveaway || giveaway.guildId !== interaction.guild.id) return interaction.editReply({ content: "❌ Giveaway not found." });
  if (giveaway.ended || giveaway.cancelled) return interaction.editReply({ content: "❌ Giveaway already ended/cancelled." });

  giveaway.cancelled = true;
  giveaway.ended     = true;
  await saveGiveaway(messageId, giveaway);

  try {
    const channel = await interaction.guild.channels.fetch(giveaway.channelId).catch(() => null);
    const msg     = channel ? await channel.messages.fetch(messageId).catch(() => null) : null;
    if (msg) {
      const embed = new EmbedBuilder().setColor(0x808080).setTitle(`~~${giveaway.prize}~~`).setDescription("❌ **Giveaway Cancelled**").setTimestamp();
      await msg.edit({ embeds: [embed], components: [] });
    }
  } catch (_) {}

  await interaction.editReply({ content: "✅ Giveaway cancelled." });
}

// ─── /giveawaypanel ───────────────────────────────────────────────────────────
export const giveawayPanelData = new SlashCommandBuilder()
  .setName("giveawaypanel")
  .setDescription("[Owner] Giveaway management panel.");

export async function executeGiveawayPanel(interaction) {
  if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "❌ Owner only.", ephemeral: true });

  const embed = new EmbedBuilder()
    .setColor(0xff6b6b)
    .setTitle("🎉 Giveaway Management Panel")
    .setDescription(
      "**Commands:**\n" +
      "• `/gcreate` — Create a new giveaway\n" +
      "• `/gend <msg_id>` — End early and pick winner\n" +
      "• `/greroll <msg_id>` — Reroll winner\n" +
      "• `/gcancel <msg_id>` — Cancel without picking\n" +
      "• `/glist` — View all active giveaways\n" +
      "• `/gsetwinner <msg_id> @user` — Force-set winner (announced)\n" +
      "• `/gchoosewinner <msg_id> @user` — Silent winner (no announcement)\n" +
      "• `/gedit <msg_id>` — Edit prize or end time\n\n" +
      "**Requirements:**\n" +
      "Join server · Account age · Has role · Trivia · Wordle · Short answer · Message count · Grid challenge · Invite tracker\n\n" +
      "**Extra Entries:**\n" +
      "`/extra-entries set @role <multiplier>` — e.g. 2x entries for VIPs"
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ─── /gedit ───────────────────────────────────────────────────────────────────
export const geditData = new SlashCommandBuilder()
  .setName("gedit")
  .setDescription("Edit a giveaway's basic details.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o => o.setName("message_id").setDescription("Message ID of the giveaway").setRequired(true))
  .addStringOption(o => o.setName("prize").setDescription("New prize name").setRequired(false))
  .addStringOption(o => o.setName("duration").setDescription("New duration from now (e.g. 2h, 1d)").setRequired(false));

export async function executeGEdit(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const messageId = interaction.options.getString("message_id");
  const giveaway  = await getGiveaway(messageId);
  if (!giveaway || giveaway.guildId !== interaction.guild.id) return interaction.editReply({ content: "❌ Giveaway not found." });
  if (giveaway.ended) return interaction.editReply({ content: "❌ Already ended." });

  const newPrize    = interaction.options.getString("prize");
  const newDuration = interaction.options.getString("duration");

  if (newPrize)    giveaway.prize  = newPrize;
  if (newDuration) {
    const ms = parseDurationLocal(newDuration);
    if (ms) giveaway.endsAt = new Date(Date.now() + ms).toISOString();
  }

  await saveGiveaway(messageId, giveaway);

  // Update embed
  try {
    const guild   = await interaction.client.guilds.fetch(giveaway.guildId);
    const channel = await guild.channels.fetch(giveaway.channelId);
    const msg     = await channel.messages.fetch(messageId);
    const embed   = buildGiveawayEmbed(giveaway, guild);
    await msg.edit({ embeds: [embed] });
  } catch (_) {}

  await interaction.editReply({ content: `✅ Giveaway updated.${newPrize ? ` Prize: **${newPrize}**` : ""}${newDuration ? ` New end: <t:${Math.floor(new Date(giveaway.endsAt).getTime()/1000)}:R>` : ""}` });
}

// ─── /gchoosewinner — silent, no announcement ─────────────────────────────────
export const gchoosewinnerData = new SlashCommandBuilder()
  .setName("gchoosewinner")
  .setDescription("[Owner only] Silently add a winner — no one is notified.")
  .addStringOption(o => o.setName("message_id").setDescription("Message ID of the giveaway").setRequired(true))
  .addUserOption(o => o.setName("user").setDescription("The user to set as winner").setRequired(true));

export async function executeGChooseWinner(interaction) {
  if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "❌ Owner only.", ephemeral: true });
  await interaction.deferReply({ ephemeral: true });

  const messageId = interaction.options.getString("message_id");
  const user      = interaction.options.getUser("user");
  const giveaway  = await getGiveaway(messageId);
  if (!giveaway) return interaction.editReply({ content: "❌ Giveaway not found." });

  // Add to entries and winners silently
  if (!giveaway.entries[user.id]) {
    giveaway.entries[user.id] = { joinedAt: new Date().toISOString(), requirementsMet: [], silentlyAdded: true };
  }
  if (!giveaway.winners.includes(user.id)) giveaway.winners.push(user.id);
  await saveGiveaway(messageId, giveaway);

  await interaction.editReply({ content: `✅ <@${user.id}> silently added as winner of **${giveaway.prize}**. No announcement sent.` });
}

// ─── /extra-entries ───────────────────────────────────────────────────────────
export const extraEntriesData = new SlashCommandBuilder()
  .setName("extra-entries")
  .setDescription("Set extra or reduced entries for a role in giveaways.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(sub => sub.setName("set").setDescription("Set entry multiplier for a role")
    .addRoleOption(o => o.setName("role").setDescription("The role").setRequired(true))
    .addNumberOption(o => o.setName("multiplier").setDescription("e.g. 2 = double entries, 0.5 = half").setRequired(true).setMinValue(0).setMaxValue(10))
  )
  .addSubcommand(sub => sub.setName("remove").setDescription("Remove entry multiplier for a role")
    .addRoleOption(o => o.setName("role").setDescription("The role").setRequired(true))
  )
  .addSubcommand(sub => sub.setName("list").setDescription("List all role multipliers"));

export async function executeExtraEntries(interaction) {
  // Store in gamesConfig for simplicity
  const { getGamesConfig, saveGamesConfig } = await import("../games/gamesStorage.js");
  const all = await getGamesConfig();
  if (!all[interaction.guild.id]) all[interaction.guild.id] = {};
  if (!all[interaction.guild.id].entryMultipliers) all[interaction.guild.id].entryMultipliers = {};

  const sub = interaction.options.getSubcommand();

  if (sub === "set") {
    const role = interaction.options.getRole("role");
    const mult = interaction.options.getNumber("multiplier");
    all[interaction.guild.id].entryMultipliers[role.id] = { roleId: role.id, roleName: role.name, multiplier: mult };
    await saveGamesConfig(all);
    return interaction.reply({ content: `✅ **@${role.name}** will get **${mult}x** entries in giveaways.`, ephemeral: true });
  }
  if (sub === "remove") {
    const role = interaction.options.getRole("role");
    delete all[interaction.guild.id].entryMultipliers[role.id];
    await saveGamesConfig(all);
    return interaction.reply({ content: `✅ Entry multiplier removed for **@${role.name}**.`, ephemeral: true });
  }
  if (sub === "list") {
    const entries = Object.values(all[interaction.guild.id].entryMultipliers ?? {});
    if (!entries.length) return interaction.reply({ content: "No entry multipliers set.", ephemeral: true });
    const embed = new EmbedBuilder().setColor(0xff6b6b).setTitle("🎉 Entry Multipliers")
      .addFields(entries.map(e => ({ name: `@${e.roleName}`, value: `${e.multiplier}x entries`, inline: true })));
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

function parseDurationLocal(str) {
  let ms = 0;
  for (const m of str.matchAll(/(\d+)\s*(d|h|m|s)/gi)) {
    const n = parseInt(m[1]);
    switch (m[2].toLowerCase()) {
      case "d": ms += n * 86400000; break;
      case "h": ms += n * 3600000;  break;
      case "m": ms += n * 60000;    break;
      case "s": ms += n * 1000;     break;
    }
  }
  return ms || null;
}