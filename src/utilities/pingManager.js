import fs from "fs";
import {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType
} from "discord.js";
import { getGuildPingConfig, setGuildPingConfig } from "../games/gamesStorage.js";

const config   = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));
const OWNER_ID = config.ownerId;

// ─── /pingsetup ───────────────────────────────────────────────────────────────
export const pingSetupData = new SlashCommandBuilder()
  .setName("pingsetup")
  .setDescription("Configure the ping manager for this server.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addIntegerOption(o => o.setName("max_everyone").setDescription("Max @everyone pings per day (global)").setRequired(true).setMinValue(0))
  .addIntegerOption(o => o.setName("max_here").setDescription("Max @here pings per day (global)").setRequired(true).setMinValue(0))
  .addIntegerOption(o => o.setName("max_role").setDescription("Max @role pings per day (global)").setRequired(true).setMinValue(0))
  .addStringOption(o => o.setName("punishment_1").setDescription("1st offence punishment (e.g. warn, 1h timeout)").setRequired(true))
  .addStringOption(o => o.setName("punishment_2").setDescription("2nd offence punishment (e.g. 24h timeout)").setRequired(true))
  .addStringOption(o => o.setName("punishment_3").setDescription("3rd+ offence punishment (e.g. ban, remove admin role)").setRequired(true))
  .addChannelOption(o => o.setName("counter_channel").setDescription("Channel to show live ping counter").addChannelTypes(ChannelType.GuildText).setRequired(false));

export async function executePingSetup(interaction) {
  if (interaction.user.id !== OWNER_ID && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "❌ Admins only.", ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const maxEveryone    = interaction.options.getInteger("max_everyone");
  const maxHere        = interaction.options.getInteger("max_here");
  const maxRole        = interaction.options.getInteger("max_role");
  const punishment1    = interaction.options.getString("punishment_1");
  const punishment2    = interaction.options.getString("punishment_2");
  const punishment3    = interaction.options.getString("punishment_3");
  const counterChannel = interaction.options.getChannel("counter_channel");

  const today = new Date().toISOString().slice(0, 10);
  await setGuildPingConfig(interaction.guild.id, {
    guildId:        interaction.guild.id,
    maxEveryone, maxHere, maxRole,
    punishments:    [punishment1, punishment2, punishment3],
    counterChannelId: counterChannel?.id ?? null,
    day:            today,
    usedEveryone:   0,
    usedHere:       0,
    usedRole:       0,
    offences:       {},    // { [userId]: count }
    roleLimits:     {},    // { [roleId]: { everyone, here, role } }
    memberLimits:   {},    // { [userId]: { everyone, here, role } }
    memberUsage:    {},    // { [userId]: { everyone, here, role, day } }
  });

  if (counterChannel) await updatePingCounter(interaction.client, interaction.guild.id);

  await interaction.editReply({ content: "✅ Ping manager configured!" });
}

// ─── /setrole-pings ───────────────────────────────────────────────────────────
export const setRolePingsData = new SlashCommandBuilder()
  .setName("setrolepings")
  .setDescription("Set ping limits for a specific role.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addRoleOption(o => o.setName("role").setDescription("The role").setRequired(true))
  .addIntegerOption(o => o.setName("everyone").setDescription("@everyone pings per day").setRequired(true).setMinValue(0))
  .addIntegerOption(o => o.setName("here").setDescription("@here pings per day").setRequired(true).setMinValue(0))
  .addIntegerOption(o => o.setName("role_pings").setDescription("@role pings per day").setRequired(true).setMinValue(0));

export async function executeSetRolePings(interaction) {
  const role = interaction.options.getRole("role");
  const cfg  = await getGuildPingConfig(interaction.guild.id);
  if (!cfg) return interaction.reply({ content: "❌ Run `/pingsetup` first.", ephemeral: true });

  cfg.roleLimits[role.id] = {
    everyone: interaction.options.getInteger("everyone"),
    here:     interaction.options.getInteger("here"),
    role:     interaction.options.getInteger("role_pings")
  };
  await setGuildPingConfig(interaction.guild.id, cfg);
  await interaction.reply({ content: `✅ Ping limits set for **@${role.name}**.`, ephemeral: true });
}

// ─── /setmember-pings ────────────────────────────────────────────────────────
export const setMemberPingsData = new SlashCommandBuilder()
  .setName("setmemberpings")
  .setDescription("Set custom ping limits for a specific member (overrides role limits).")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption(o => o.setName("member").setDescription("The member").setRequired(true))
  .addIntegerOption(o => o.setName("everyone").setDescription("@everyone pings per day").setRequired(true).setMinValue(0))
  .addIntegerOption(o => o.setName("here").setDescription("@here pings per day").setRequired(true).setMinValue(0))
  .addIntegerOption(o => o.setName("role_pings").setDescription("@role pings per day").setRequired(true).setMinValue(0));

export async function executeSetMemberPings(interaction) {
  const user = interaction.options.getUser("member");
  const cfg  = await getGuildPingConfig(interaction.guild.id);
  if (!cfg) return interaction.reply({ content: "❌ Run `/pingsetup` first.", ephemeral: true });

  cfg.memberLimits[user.id] = {
    everyone: interaction.options.getInteger("everyone"),
    here:     interaction.options.getInteger("here"),
    role:     interaction.options.getInteger("role_pings")
  };
  await setGuildPingConfig(interaction.guild.id, cfg);
  await interaction.reply({ content: `✅ Custom ping limits set for <@${user.id}>.`, ephemeral: true });
}

// ─── /pingcheck ───────────────────────────────────────────────────────────────
export const pingCheckData = new SlashCommandBuilder()
  .setName("pingcheck")
  .setDescription("Check how many pings you have left today.");

export async function executePingCheck(interaction) {
  const cfg = await getGuildPingConfig(interaction.guild.id);
  if (!cfg) return interaction.reply({ content: "❌ Ping manager not configured.", ephemeral: true });

  await resetDayIfNeeded(interaction.guild.id, cfg);
  const limits  = getUserLimits(interaction.user.id, interaction.member, cfg);
  const usage   = getUserUsage(interaction.user.id, cfg);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📊 Your Ping Allowance Today")
    .addFields(
      { name: "@everyone", value: `${Math.max(0, limits.everyone - usage.everyone)} / ${limits.everyone} left`, inline: true },
      { name: "@here",     value: `${Math.max(0, limits.here     - usage.here)}     / ${limits.here}     left`, inline: true },
      { name: "@role",     value: `${Math.max(0, limits.role     - usage.role)}     / ${limits.role}     left`, inline: true },
      { name: "Global caps", value: `@everyone: ${cfg.usedEveryone}/${cfg.maxEveryone} · @here: ${cfg.usedHere}/${cfg.maxHere} · @role: ${cfg.usedRole}/${cfg.maxRole}`, inline: false }
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ─── /pingrules ───────────────────────────────────────────────────────────────
export const pingRulesData = new SlashCommandBuilder()
  .setName("pingrules")
  .setDescription("Post the staff ping rules in this channel.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function executePingRules(interaction) {
  const cfg = await getGuildPingConfig(interaction.guild.id);
  if (!cfg) return interaction.reply({ content: "❌ Run `/pingsetup` first.", ephemeral: true });

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("📋 Staff Ping Rules")
    .setDescription(
      "All staff must follow the daily ping limits set by the admin.\n\n" +
      `**Daily Global Limits:**\n` +
      `• @everyone: max **${cfg.maxEveryone}** per day\n` +
      `• @here: max **${cfg.maxHere}** per day\n` +
      `• @role: max **${cfg.maxRole}** per day\n\n` +
      "**Punishments for exceeding limits:**\n" +
      `• 1st offence: ${cfg.punishments[0]}\n` +
      `• 2nd offence: ${cfg.punishments[1]}\n` +
      `• 3rd+ offence: ${cfg.punishments[2]}\n\n` +
      "Use `/pingcheck` to see your remaining pings at any time.\n" +
      "Ignorance of the rules is not an excuse."
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

// ─── messageCreate — intercept pings ─────────────────────────────────────────
export async function handlePingMessage(message) {
  if (!message.guild || message.author.bot) return;
  const cfg = await getGuildPingConfig(message.guild.id);
  if (!cfg) return;

  await resetDayIfNeeded(message.guild.id, cfg);

  const hasEveryone = message.content.includes("@everyone");
  const hasHere     = message.content.includes("@here");
  const hasRole     = message.mentions.roles.size > 0;

  if (!hasEveryone && !hasHere && !hasRole) return;

  const type    = hasEveryone ? "everyone" : hasHere ? "here" : "role";
  const limits  = getUserLimits(message.author.id, message.member, cfg);
  const usage   = getUserUsage(message.author.id, cfg);

  const globalUsed = cfg[`used${type.charAt(0).toUpperCase() + type.slice(1)}`] ?? 0;
  const globalMax  = cfg[`max${type.charAt(0).toUpperCase() + type.slice(1)}`] ?? 0;

  const userOver   = (usage[type] ?? 0) >= (limits[type] ?? 0);
  const globalOver = globalUsed >= globalMax;

  if (userOver || globalOver) {
    await message.delete().catch(() => {});
    const reason = globalOver ? "global daily limit reached" : "your personal ping limit reached";
    const warn   = await message.channel.send({ content: `<@${message.author.id}> ❌ Ping deleted — ${reason}.` });
    setTimeout(() => warn.delete().catch(() => {}), 6000);
    await applyPingOffence(message.member, message.guild, cfg, type);
    return;
  }

  // Count the ping
  if (!cfg.memberUsage[message.author.id]) cfg.memberUsage[message.author.id] = { everyone: 0, here: 0, role: 0, day: new Date().toISOString().slice(0, 10) };
  cfg.memberUsage[message.author.id][type]++;
  cfg[`used${type.charAt(0).toUpperCase() + type.slice(1)}`]++;
  await setGuildPingConfig(message.guild.id, cfg);
  await updatePingCounter(message.client, message.guild.id);
}

// ─── Apply offence ────────────────────────────────────────────────────────────
async function applyPingOffence(member, guild, cfg, type) {
  const userId   = member.id;
  const offences = cfg.offences[userId] = (cfg.offences[userId] ?? 0) + 1;
  const punIdx   = Math.min(offences - 1, cfg.punishments.length - 1);
  const punText  = cfg.punishments[punIdx] ?? "warned";
  await setGuildPingConfig(guild.id, cfg);

  try {
    await member.send(`⚠️ **Ping limit exceeded** (${type} ping).\n**Offence #${offences}:** ${punText}`);
  } catch (_) {}

  const punLower = punText.toLowerCase();
  if (punLower.includes("ban")) { await member.ban({ reason: "Ping abuse" }).catch(() => {}); return; }
  if (punLower.includes("timeout")) {
    const match = punText.match(/(\d+)\s*h/i);
    const ms    = match ? parseInt(match[1]) * 3600000 : 3600000;
    await member.timeout(ms, "Ping limit exceeded").catch(() => {});
    return;
  }
  if (punLower.includes("remove") && punLower.includes("admin")) {
    const adminRoles = member.roles.cache.filter(r => r.permissions.has(PermissionFlagsBits.Administrator));
    for (const r of adminRoles.values()) { await member.roles.remove(r).catch(() => {}); }
    return;
  }
  if (punLower.includes("kick")) { await member.kick("Ping abuse").catch(() => {}); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getUserLimits(userId, member, cfg) {
  if (cfg.memberLimits?.[userId]) return cfg.memberLimits[userId];
  // Find highest role limit
  let best = { everyone: 0, here: 0, role: 0 };
  if (member?.roles?.cache) {
    for (const [roleId] of member.roles.cache) {
      const rl = cfg.roleLimits?.[roleId];
      if (rl) {
        best.everyone = Math.max(best.everyone, rl.everyone ?? 0);
        best.here     = Math.max(best.here,     rl.here     ?? 0);
        best.role     = Math.max(best.role,      rl.role     ?? 0);
      }
    }
  }
  return best;
}

function getUserUsage(userId, cfg) {
  const u = cfg.memberUsage?.[userId];
  if (!u || u.day !== new Date().toISOString().slice(0, 10)) return { everyone: 0, here: 0, role: 0 };
  return u;
}

async function resetDayIfNeeded(guildId, cfg) {
  const today = new Date().toISOString().slice(0, 10);
  if (cfg.day === today) return;
  cfg.day = today; cfg.usedEveryone = 0; cfg.usedHere = 0; cfg.usedRole = 0; cfg.memberUsage = {};
  await setGuildPingConfig(guildId, cfg);
}

async function updatePingCounter(client, guildId) {
  const cfg = await getGuildPingConfig(guildId);
  if (!cfg?.counterChannelId) return;
  const guild   = await client.guilds.fetch(guildId).catch(() => null);
  const channel = guild ? await guild.channels.fetch(cfg.counterChannelId).catch(() => null) : null;
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📡 Live Ping Counter — Today")
    .addFields(
      { name: "@everyone", value: `${cfg.usedEveryone} / ${cfg.maxEveryone}`, inline: true },
      { name: "@here",     value: `${cfg.usedHere}     / ${cfg.maxHere}`,     inline: true },
      { name: "@role",     value: `${cfg.usedRole}     / ${cfg.maxRole}`,     inline: true }
    )
    .setTimestamp();

  const msgs = await channel.messages.fetch({ limit: 5 }).catch(() => null);
  const existing = msgs?.find(m => m.author.id === client.user.id);
  if (existing) await existing.edit({ embeds: [embed] }).catch(() => {});
  else await channel.send({ embeds: [embed] }).catch(() => {});
}