import fs from "fs";
import { getWorkerConfig, getWorker, saveWorker } from "../workerStorage.js";
import { sendLog } from "./logHandler.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

const TIMEOUT_DURATION_MS = 60 * 60 * 1000; // 1 hour

export async function handleAutoMod(message) {
  if (!message.guild) return;
  if (message.author.bot) return;
  // Bot owner is never touched
  if (message.author.id === config.ownerId) return;

  const guildId = message.guild.id;
  const cfg     = (await getWorkerConfig())[guildId];
  if (!cfg) return;

  const protectedChannels = [
    cfg.announcementChannelId,
    cfg.guideChannelId,
    cfg.applicationChannelId
  ].filter(Boolean);

  if (!protectedChannels.includes(message.channelId)) return;

  // Delete message immediately
  await message.delete().catch(() => {});

  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;

  const channelName = message.channel.name ?? "a restricted channel";
  const isAdmin = member.permissions.has("Administrator");

  if (isAdmin) {
    // ── Admin bypass prevention: remove Worker role + timeout + DM ──────────
    const workerRoleId = cfg.acceptedRoleId;
    let hadWorkerRole = false;

    if (workerRoleId && member.roles.cache.has(workerRoleId)) {
      await member.roles.remove(workerRoleId, "AutoMod: messaged in restricted channel").catch(() => {});
      hadWorkerRole = true;

      // Save role removal on worker record so it can be restored
      const worker = await getWorker(message.author.id);
      if (worker) {
        await saveWorker(message.author.id, {
          ...worker,
          autoModRoleRemoved:   true,
          autoModRoleRemoveAt:  new Date().toISOString(),
          autoModRoleRestoreAt: new Date(Date.now() + TIMEOUT_DURATION_MS).toISOString()
        });
      }
    }

    // Try Discord timeout — may fail if they are server owner
    try {
      await member.timeout(TIMEOUT_DURATION_MS, "AutoMod: messaged in restricted channel");
    } catch (_) {
      // Server owner cannot be timed out — role removal still applies
    }

    // DM admin
    try {
      await message.author.send(
        `🔇 **You have been timed out for 1 hour and your Worker role has been temporarily removed.**\n` +
        `You sent a message in **#${channelName}**, which is a restricted channel — only the bot may post there.\n\n` +
        `To appeal, DM <@${config.ownerId}>.`
      );
    } catch (_) {}

  } else {
    // Regular member — standard 1-hour timeout
    try {
      await member.timeout(TIMEOUT_DURATION_MS, "AutoMod: messaged in restricted channel");
    } catch (e) {
      console.error(`[AutoMod] Failed to timeout ${message.author.tag}:`, e.message);
    }

    try {
      await message.author.send(
        `🔇 **You have been timed out for 1 hour.**\n` +
        `You sent a message in **#${channelName}**, which is read-only — only the bot may post there.\n\n` +
        `To appeal, DM <@${config.ownerId}>.`
      );
    } catch (_) {}
  }

  await sendLog(message.client, guildId, cfg.logChannelId, {
    type:      "auto_timeout",
    userId:    message.author.id,
    channelId: message.channelId,
    note:      isAdmin ? "Admin — role removed + timeout applied" : "Standard timeout"
  });
}

// ─── Cron: restore Worker role after automod timeout expires ─────────────────

export async function checkAutoModRestores(client) {
  const { getWorkers, saveWorker: sw } = await import("../workerStorage.js");
  const workers = await getWorkers();
  const now = Date.now();

  for (const [userId, worker] of Object.entries(workers)) {
    if (!worker.autoModRoleRemoved || !worker.autoModRoleRestoreAt) continue;
    if (now < new Date(worker.autoModRoleRestoreAt).getTime()) continue;

    const { getWorkerConfig: gwc } = await import("../workerStorage.js");
    const cfgs = await gwc();
    const cfg  = cfgs[worker.guildId];
    if (!cfg) continue;

    const guild  = await client.guilds.fetch(worker.guildId).catch(() => null);
    if (!guild) continue;
    const member = await guild.members.fetch(userId).catch(() => null);

    if (member && cfg.acceptedRoleId && !member.roles.cache.has(cfg.acceptedRoleId)) {
      await member.roles.add(cfg.acceptedRoleId).catch(() => {});
    }

    await sw(userId, {
      ...worker,
      autoModRoleRemoved:   false,
      autoModRoleRemoveAt:  null,
      autoModRoleRestoreAt: null
    });

    try {
      const user = await client.users.fetch(userId);
      await user.send("✅ **Your Worker role has been restored** after your automod timeout expired.");
    } catch (_) {}
  }
}
