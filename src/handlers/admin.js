/**
 * /admin — Owner-only admin panel for the Worker system.
 *
 * Subcommands:
 *   addpoints    <user> <amount>
 *   removepoints <user> <amount>
 *   timeout      <user> <minutes>   — removes Worker role, restores after timeout
 *   removetimeout <user>            — cancels an active timeout and restores role
 *   ban          <user>             — permanent ban from Worker role (status → "banned")
 *   unban        <user>             — lifts ban and restores Worker role
 */

import fs from "fs";
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} from "discord.js";
import {
  getWorker,
  saveWorker,
  getWorkerConfig,
  getWorkers,
  saveWorkers
} from "../workerStorage.js";
import { sendLog } from "./logHandler.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

// ─── Command definition ───────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("admin")
  .setDescription("Worker system admin panel (owner only).")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

  // ── add points ──────────────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub
      .setName("addpoints")
      .setDescription("Add points to a worker.")
      .addUserOption(o =>
        o.setName("user").setDescription("The worker").setRequired(true)
      )
      .addIntegerOption(o =>
        o
          .setName("amount")
          .setDescription("Points to add (1–100)")
          .setMinValue(1)
          .setMaxValue(100)
          .setRequired(true)
      )
      .addStringOption(o =>
        o
          .setName("reason")
          .setDescription("Optional reason (shown in log)")
          .setRequired(false)
      )
  )

  // ── remove points ────────────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub
      .setName("removepoints")
      .setDescription("Remove points from a worker.")
      .addUserOption(o =>
        o.setName("user").setDescription("The worker").setRequired(true)
      )
      .addIntegerOption(o =>
        o
          .setName("amount")
          .setDescription("Points to remove (1–100)")
          .setMinValue(1)
          .setMaxValue(100)
          .setRequired(true)
      )
      .addStringOption(o =>
        o
          .setName("reason")
          .setDescription("Optional reason (shown in log)")
          .setRequired(false)
      )
  )

  // ── timeout ──────────────────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub
      .setName("timeout")
      .setDescription(
        "Temporarily remove the Worker role. Role is automatically restored after the duration."
      )
      .addUserOption(o =>
        o.setName("user").setDescription("The worker").setRequired(true)
      )
      .addIntegerOption(o =>
        o
          .setName("minutes")
          .setDescription("Duration in minutes (1–10080 = 1 week)")
          .setMinValue(1)
          .setMaxValue(10080)
          .setRequired(true)
      )
      .addStringOption(o =>
        o
          .setName("reason")
          .setDescription("Optional reason (sent to worker via DM and shown in log)")
          .setRequired(false)
      )
  )

  // ── remove timeout ───────────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub
      .setName("removetimeout")
      .setDescription("Cancel an active role timeout and restore the Worker role immediately.")
      .addUserOption(o =>
        o.setName("user").setDescription("The worker").setRequired(true)
      )
  )

  // ── ban ──────────────────────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub
      .setName("ban")
      .setDescription("Permanently ban a user from the Worker role (status → banned).")
      .addUserOption(o =>
        o.setName("user").setDescription("The worker").setRequired(true)
      )
      .addStringOption(o =>
        o
          .setName("reason")
          .setDescription("Reason (sent to worker and shown in log)")
          .setRequired(false)
      )
  )

  // ── unban ─────────────────────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub
      .setName("unban")
      .setDescription("Lift a Worker ban and restore the Worker role.")
      .addUserOption(o =>
        o.setName("user").setDescription("The worker").setRequired(true)
      )
  )

  // ── removeworker ──────────────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub
      .setName("removeworker")
      .setDescription("Remove a user from the Worker role and worker system entirely.")
      .addUserOption(o =>
        o.setName("user").setDescription("The user to remove").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("reason")
          .setDescription("Reason (sent to user via DM and logged)")
          .setRequired(false)
      )
  );

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  // Restrict to bot owner only
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({
      content: "❌ This command is restricted to the bot owner.",
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const sub    = interaction.options.getSubcommand();
  const target = interaction.options.getUser("user");

  switch (sub) {
    case "addpoints":    return cmdAddPoints(interaction, target);
    case "removepoints": return cmdRemovePoints(interaction, target);
    case "timeout":      return cmdTimeout(interaction, target);
    case "removetimeout":return cmdRemoveTimeout(interaction, target);
    case "ban":          return cmdBan(interaction, target);
    case "unban":        return cmdUnban(interaction, target);
    case "removeworker": return cmdRemoveWorker(interaction, target);
    default:
      return interaction.editReply({ content: "❌ Unknown subcommand." });
  }
}

// ─── Helper: get guild config + worker, with standard error replies ───────────

async function resolveContext(interaction, targetUser, requireWorker = true) {
  const guildId = interaction.guild.id;
  const cfg     = (await getWorkerConfig())[guildId];

  if (!cfg) {
    await interaction.editReply({
      content: "❌ Worker system is not set up. Run `/workersetup` first."
    });
    return null;
  }

  if (!requireWorker) return { guildId, cfg, worker: null };

  const worker = await getWorker(targetUser.id);
  if (!worker || worker.guildId !== guildId) {
    await interaction.editReply({
      content: `❌ <@${targetUser.id}> is not a registered worker in this server.`
    });
    return null;
  }

  return { guildId, cfg, worker };
}

// ─── Helper: fetch member safely ─────────────────────────────────────────────

async function fetchMember(guild, userId) {
  return guild.members.fetch(userId).catch(() => null);
}

// ─── /admin addpoints ─────────────────────────────────────────────────────────

async function cmdAddPoints(interaction, target) {
  const ctx = await resolveContext(interaction, target);
  if (!ctx) return;

  const amount = interaction.options.getInteger("amount");
  const reason = interaction.options.getString("reason") ?? "Manual adjustment by admin";
  const { worker, cfg } = ctx;

  const newPoints      = (worker.points ?? 0) + amount;
  const newTotalPoints = (worker.totalPoints ?? 0) + amount;

  await saveWorker(target.id, {
    ...worker,
    points:      newPoints,
    totalPoints: newTotalPoints
  });

  await sendLog(interaction.client, ctx.guildId, cfg.logChannelId, {
    type:    "point_added",
    userId:  target.id,
    points:  newPoints,
    adminId: interaction.user.id,
    reason
  });

  // DM worker
  await target.send(
    `✅ **+${amount} point${amount !== 1 ? "s" : ""} added** by an admin.\n` +
    `**Reason:** ${reason}\n` +
    `**New total:** ${newPoints} point${newPoints !== 1 ? "s" : ""}`
  ).catch(() => {});

  return interaction.editReply({
    content:
      `✅ Added **${amount}** point${amount !== 1 ? "s" : ""} to <@${target.id}>.\n` +
      `New points: **${newPoints}**`
  });
}

// ─── /admin removepoints ──────────────────────────────────────────────────────

async function cmdRemovePoints(interaction, target) {
  const ctx = await resolveContext(interaction, target);
  if (!ctx) return;

  const amount = interaction.options.getInteger("amount");
  const reason = interaction.options.getString("reason") ?? "Manual adjustment by admin";
  const { worker, cfg } = ctx;

  const newPoints = Math.max(0, (worker.points ?? 0) - amount);
  const removed   = (worker.points ?? 0) - newPoints; // actual amount removed (capped at 0)

  await saveWorker(target.id, { ...worker, points: newPoints });

  await sendLog(interaction.client, ctx.guildId, cfg.logChannelId, {
    type:    "point_removed",
    userId:  target.id,
    points:  newPoints,
    adminId: interaction.user.id,
    reason
  });

  await target.send(
    `➖ **${removed} point${removed !== 1 ? "s" : ""} removed** by an admin.\n` +
    `**Reason:** ${reason}\n` +
    `**New total:** ${newPoints} point${newPoints !== 1 ? "s" : ""}`
  ).catch(() => {});

  return interaction.editReply({
    content:
      `✅ Removed **${removed}** point${removed !== 1 ? "s" : ""} from <@${target.id}>.\n` +
      `New points: **${newPoints}**`
  });
}

// ─── /admin timeout ───────────────────────────────────────────────────────────

async function cmdTimeout(interaction, target) {
  const ctx = await resolveContext(interaction, target);
  if (!ctx) return;

  const { worker, cfg, guildId } = ctx;
  const minutes = interaction.options.getInteger("minutes");
  const reason  = interaction.options.getString("reason") ?? "Timed out by admin";

  if (worker.status === "banned") {
    return interaction.editReply({
      content: `❌ <@${target.id}> is banned — cannot timeout a banned worker. Use \`/admin unban\` first.`
    });
  }

  if (worker.timeoutUntil && Date.now() < new Date(worker.timeoutUntil).getTime()) {
    const ts = Math.floor(new Date(worker.timeoutUntil).getTime() / 1000);
    return interaction.editReply({
      content:
        `⚠️ <@${target.id}> already has an active timeout ending <t:${ts}:R>.\n` +
        `Use \`/admin removetimeout\` first, then issue a new one if needed.`
    });
  }

  // Remove the Worker role
  const member = await fetchMember(interaction.guild, target.id);
  const roleId = cfg.acceptedRoleId;
  let roleRemoved = false;

  if (member && roleId) {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId).catch(() => {});
      roleRemoved = true;
    }
  }

  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();

  await saveWorker(target.id, {
    ...worker,
    timedOut:     true,
    timeoutUntil: expiresAt
  });

  await sendLog(interaction.client, guildId, cfg.logChannelId, {
    type:      "worker_timeout",
    userId:    target.id,
    duration:  `${minutes} minute${minutes !== 1 ? "s" : ""}`,
    expiresAt,
    adminId:   interaction.user.id,
    reason
  });

  // DM worker
  const ts = Math.floor(new Date(expiresAt).getTime() / 1000);
  await target.send(
    `⏱️ **Your Worker role has been temporarily removed.**\n` +
    `**Reason:** ${reason}\n` +
    `**Duration:** ${minutes} minute${minutes !== 1 ? "s" : ""}\n` +
    `**Role restored:** <t:${ts}:R>`
  ).catch(() => {});

  const durationText = minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes}m`;

  return interaction.editReply({
    content:
      `✅ Timed out <@${target.id}> for **${durationText}**.\n` +
      `${roleRemoved ? "Worker role removed." : "⚠️ Could not find/remove the role — worker may not be in the server."}\n` +
      `Role will be restored <t:${ts}:R>.`
  });
}

// ─── /admin removetimeout ─────────────────────────────────────────────────────

async function cmdRemoveTimeout(interaction, target) {
  const ctx = await resolveContext(interaction, target);
  if (!ctx) return;

  const { worker, cfg, guildId } = ctx;

  if (!worker.timedOut && !worker.timeoutUntil) {
    return interaction.editReply({
      content: `❌ <@${target.id}> does not have an active timeout.`
    });
  }

  // Restore the Worker role
  const member = await fetchMember(interaction.guild, target.id);
  const roleId = cfg.acceptedRoleId;
  let roleRestored = false;

  if (member && roleId && !member.roles.cache.has(roleId)) {
    await member.roles.add(roleId).catch(() => {});
    roleRestored = true;
  }

  await saveWorker(target.id, {
    ...worker,
    timedOut:     false,
    timeoutUntil: null
  });

  await sendLog(interaction.client, guildId, cfg.logChannelId, {
    type:    "worker_timeout_end",
    userId:  target.id,
    adminId: interaction.user.id,
    note:    "Timeout removed manually by admin"
  });

  await target.send(
    `✅ **Your Worker role timeout has been removed** by an admin.\n` +
    `Your Worker role has been restored.`
  ).catch(() => {});

  return interaction.editReply({
    content:
      `✅ Removed timeout for <@${target.id}>.\n` +
      `${roleRestored ? "Worker role restored." : "⚠️ Role already present or could not be re-added."}`
  });
}

// ─── /admin ban ───────────────────────────────────────────────────────────────

async function cmdBan(interaction, target) {
  const ctx = await resolveContext(interaction, target);
  if (!ctx) return;

  const { worker, cfg, guildId } = ctx;
  const reason = interaction.options.getString("reason") ?? "Banned by admin";

  if (worker.status === "banned") {
    return interaction.editReply({
      content: `❌ <@${target.id}> is already banned from the Worker role.`
    });
  }

  // Remove the Worker role
  const member = await fetchMember(interaction.guild, target.id);
  const roleId = cfg.acceptedRoleId;
  let roleRemoved = false;

  if (member && roleId && member.roles.cache.has(roleId)) {
    await member.roles.remove(roleId).catch(() => {});
    roleRemoved = true;
  }

  await saveWorker(target.id, {
    ...worker,
    status:       "banned",
    bannedAt:     new Date().toISOString(),
    timedOut:     false,
    timeoutUntil: null
  });

  await sendLog(interaction.client, guildId, cfg.logChannelId, {
    type:    "worker_banned",
    userId:  target.id,
    adminId: interaction.user.id,
    reason
  });

  await target.send(
    `🚫 **You have been banned from the Worker role.**\n` +
    `**Reason:** ${reason}\n\n` +
    `You can no longer participate in Worker announcements. ` +
    `Contact the server owner if you believe this is a mistake.`
  ).catch(() => {});

  return interaction.editReply({
    content:
      `✅ Banned <@${target.id}> from the Worker role.\n` +
      `${roleRemoved ? "Worker role removed." : "⚠️ Role could not be removed (user may have left)."}`
  });
}

// ─── /admin unban ─────────────────────────────────────────────────────────────

async function cmdUnban(interaction, target) {
  const ctx = await resolveContext(interaction, target);
  if (!ctx) return;

  const { worker, cfg, guildId } = ctx;

  if (worker.status !== "banned") {
    return interaction.editReply({
      content: `❌ <@${target.id}> is not currently banned from the Worker role.`
    });
  }

  // Restore the Worker role
  const member = await fetchMember(interaction.guild, target.id);
  const roleId = cfg.acceptedRoleId;
  let roleRestored = false;

  if (member && roleId && !member.roles.cache.has(roleId)) {
    await member.roles.add(roleId).catch(() => {});
    roleRestored = true;
  }

  await saveWorker(target.id, {
    ...worker,
    status:   "accepted",
    bannedAt: null
  });

  await sendLog(interaction.client, guildId, cfg.logChannelId, {
    type:    "worker_unbanned",
    userId:  target.id,
    adminId: interaction.user.id
  });

  await target.send(
    `✅ **Your Worker ban has been lifted.**\n` +
    `Your Worker role has been restored. Welcome back!`
  ).catch(() => {});

  return interaction.editReply({
    content:
      `✅ Unbanned <@${target.id}>.\n` +
      `${roleRestored ? "Worker role restored." : "⚠️ Role could not be re-added (user may not be in server)."}`
  });
}

// ─── Timeout restoration checker (called by cron every minute) ───────────────
// Import this in src/index.js and call from cron.

export async function checkTimeouts(client) {
  const workers = await import("../workerStorage.js").then(m => m.getWorkers());
  const cfgs    = await import("../workerStorage.js").then(m => m.getWorkerConfig());
  const now     = Date.now();

  for (const [userId, worker] of Object.entries(workers)) {
    if (!worker.timedOut || !worker.timeoutUntil) continue;

    const expiry = new Date(worker.timeoutUntil).getTime();
    if (now < expiry) continue;

    // Timeout has expired — restore role
    const cfg  = cfgs[worker.guildId];
    if (!cfg) continue;

    const guild = await client.guilds.fetch(worker.guildId).catch(() => null);
    if (!guild) continue;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && cfg.acceptedRoleId && !member.roles.cache.has(cfg.acceptedRoleId)) {
      await member.roles.add(cfg.acceptedRoleId).catch(() => {});
    }

    // Update worker record
    const { saveWorker: sw } = await import("../workerStorage.js");
    await sw(userId, { ...worker, timedOut: false, timeoutUntil: null });

    await sendLog(client, worker.guildId, cfg.logChannelId, {
      type:   "worker_timeout_end",
      userId,
      note:   "Timeout expired — role automatically restored"
    });

    // DM worker
    try {
      const user = await client.users.fetch(userId);
      await user.send("✅ **Your Worker role timeout has expired.** Your role has been automatically restored!");
    } catch (_) {}
  }
}
// ─── /admin removeworker ──────────────────────────────────────────────────────

async function cmdRemoveWorker(interaction, target) {
  const ctx = await resolveContext(interaction, target, false);
  if (!ctx) return;

  const { cfg, guildId } = ctx;
  const reason = interaction.options.getString("reason") ?? "Removed by admin";

  // Remove Worker role from member
  const member  = await fetchMember(interaction.guild, target.id);
  const roleId  = cfg.acceptedRoleId;
  let roleRemoved = false;

  if (member && roleId && member.roles.cache.has(roleId)) {
    await member.roles.remove(roleId, "Admin: removeworker command").catch(() => {});
    roleRemoved = true;
  }

  // Delete worker record entirely
  const { getWorkers, saveWorkers: sw } = await import("../workerStorage.js");
  const workers = await getWorkers();
  const hadRecord = !!workers[target.id];
  delete workers[target.id];
  await sw(workers);

  await sendLog(interaction.client, guildId, cfg.logChannelId, {
    type:    "worker_removed",
    userId:  target.id,
    adminId: interaction.user.id,
    reason
  });

  // DM the user
  await target.send(
    `❌ **Your Worker role has been removed.**\n` +
    `**Reason:** ${reason}\n\n` +
    `You are no longer part of the worker team. Contact the owner if you believe this is a mistake.`
  ).catch(() => {});

  return interaction.editReply({
    content:
      `✅ Removed <@${target.id}> from the worker system.\n` +
      `${roleRemoved ? "Worker role removed." : "⚠️ Role not found on user (may have already been removed)."}\n` +
      `${hadRecord ? "Worker record deleted." : "⚠️ No worker record found."}`
  });
}