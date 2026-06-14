import fs from "fs";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  PermissionFlagsBits
} from "discord.js";
import {
  getWorkerConfig,
  getAnnouncements,
  saveAnnouncement,
  getAnnouncement,
  getWorker,
  saveWorker
} from "../workerStorage.js";
import { addStrike } from "./strikeHandler.js";
import { sendLog } from "./logHandler.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);



// ─── Button: worker_check_status (on announcement message) ────────────────────

export async function handleCheckStatus(interaction) {
  const userId = interaction.user.id;
  const worker = await getWorker(userId);

  if (!worker || worker.status !== "accepted") {
    return interaction.reply({ content: "❌ You are not an accepted worker.", ephemeral: true });
  }

  // Find this announcement
  const announcements = await getAnnouncements();
  const announcement  = announcements[interaction.message.id];

  if (!announcement) {
    return interaction.reply({ content: "❌ Announcement record not found.", ephemeral: true });
  }

  const joinRecord = announcement.joins?.[userId];
  const deadlineTs = Math.floor(new Date(announcement.deadlineAt).getTime() / 1000);

  let statusLine;
  if (!joinRecord) {
    statusLine = "⏳ You have not logged proof yet.";
  } else if (joinRecord.rewarded) {
    statusLine = "✅ You logged proof and earned your point!";
  } else if (joinRecord.capped) {
    statusLine = "🔒 Max joins reached — no reward or strike for this announcement.";
  } else if (joinRecord.strikeGiven) {
    statusLine = "❌ You received a strike for this announcement.";
  } else {
    statusLine = "⏳ Proof submitted — pending confirmation.";
  }

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle("📊 Your Status For This Announcement")
    .addFields(
      { name: "Status",    value: statusLine,                              inline: false },
      { name: "Deadline",  value: `<t:${deadlineTs}:R>`,                  inline: true  },
      { name: "Points",    value: `${worker.points}`,                     inline: true  },
      { name: "Strikes",   value: `${worker.strikes}/2`,                  inline: true  }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ─── Deadline checker — called by cron every 5 minutes ────────────────────────
// Issues strikes to workers who did not join/log proof before deadline.

export async function checkDeadlines(client) {
  const now           = Date.now();
  const announcements = await getAnnouncements();

  for (const [announcementId, announcement] of Object.entries(announcements)) {
    if (announcement.closed) continue;

    const deadline = new Date(announcement.deadlineAt).getTime();
    if (now < deadline) continue;

    // Mark closed immediately to prevent double-processing
    await saveAnnouncement(announcementId, { ...announcement, closed: true });

    const cfg = (await getWorkerConfig())[announcement.guildId];
    if (!cfg) continue;

    const guild = await client.guilds.fetch(announcement.guildId).catch(() => null);
    if (!guild) continue;

    // Get all accepted workers in this guild
    const { getWorkers } = await import("../workerStorage.js");
    const allWorkers = await getWorkers();
    const guildWorkers = Object.values(allWorkers).filter(
      w => w.guildId === announcement.guildId && w.status === "accepted"
    );

    for (const worker of guildWorkers) {
      const joinRecord = announcement.joins?.[worker.userId];

      // Skip workers who were accepted AFTER this announcement was posted
      // (they had no chance to participate — don't penalise them)
      if (worker.acceptedAt && new Date(worker.acceptedAt) > new Date(announcement.postedAt)) continue;

      // Already rewarded or capped — skip
      if (joinRecord?.rewarded || joinRecord?.capped) continue;

      // Already got a strike for this — skip
      if (joinRecord?.strikeGiven) continue;

      // No proof submitted by deadline — issue strike
      await addStrike(worker.userId, announcementId, "missed_deadline", cfg, client);

      const updated = { ...announcement };
      if (!updated.joins[worker.userId]) updated.joins[worker.userId] = { userId: worker.userId };
      updated.joins[worker.userId].strikeGiven = true;
      await saveAnnouncement(announcementId, updated);
    }
  }
}

// ─── Grant a point to a worker for a completed announcement ───────────────────

export async function grantPoint(userId, announcementId, announcement, cfg, client) {
  const worker = await getWorker(userId);
  if (!worker) return;

  const newPoints      = (worker.points ?? 0) + 1;
  const newTotalPoints = (worker.totalPoints ?? 0) + 1;

  await saveWorker(userId, {
    ...worker,
    points:      newPoints,
    totalPoints: newTotalPoints
  });

  // Mark rewarded in announcement
  const updated = { ...announcement };
  if (!updated.joins[userId]) updated.joins[userId] = { userId };
  updated.joins[userId].rewarded = true;
  await saveAnnouncement(announcementId, updated);

  // Update the join counter on the announcement embed
  await updateAnnouncementCounter(client, updated);
}

// ─── Update join counter on announcement embed ────────────────────────────────

export async function updateAnnouncementCounter(client, announcement) {
  if (!announcement.maxJoins || announcement.maxJoins === 0) return;
  try {
    const { getWorkerConfig: gwc } = await import("../workerStorage.js");
    const cfg = (await gwc())[announcement.guildId];
    if (!cfg) return;
    const guild   = await client.guilds.fetch(announcement.guildId).catch(() => null);
    if (!guild) return;
    const channel = await guild.channels.fetch(cfg.announcementChannelId).catch(() => null);
    if (!channel) return;
    const msg = await channel.messages.fetch(announcement.id).catch(() => null);
    if (!msg || !msg.embeds[0]) return;

    const rewarded = countRewardedJoins(announcement);
    const embed    = EmbedBuilder.from(msg.embeds[0]);
    const fields   = embed.data.fields ?? [];
    const slotsIdx = fields.findIndex(f => f.name === "🎯 Slots");
    if (slotsIdx !== -1) {
      fields[slotsIdx] = {
        name:   "🎯 Slots",
        value:  `${rewarded}/${announcement.maxJoins}`,
        inline: true
      };
      embed.setFields(fields);
      await msg.edit({ embeds: [embed], components: msg.components });
    }
  } catch (e) {
    console.error("[updateAnnouncementCounter]", e.message);
  }
}

// ─── Count rewarded joins for an announcement ─────────────────────────────────

export function countRewardedJoins(announcement) {
  return Object.values(announcement.joins ?? {}).filter(j => j.rewarded).length;
}

// ─── Button: log_remove_point_<userId>_<announcementId> ──────────────────────
// Shown in the proof log — lets owner manually remove a wrongly granted point.

export async function handleLogRemovePoint(interaction) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: "❌ Only the bot owner can do this.", ephemeral: true });
  }

  // customId format: log_remove_point_<userId>_<announcementId>
  const parts          = interaction.customId.split("_");
  // ["log","remove","point","<userId>","<announcementId>"]
  const userId         = parts[3];
  const announcementId = parts[4];

  if (!userId || !announcementId) {
    return interaction.reply({ content: "❌ Malformed button ID.", ephemeral: true });
  }

  const { getWorker: gw, saveWorker: sw } = await import("../workerStorage.js");
  const worker = await gw(userId);
  if (!worker) {
    return interaction.reply({ content: "❌ Worker not found.", ephemeral: true });
  }

  const newPoints = Math.max(0, (worker.points ?? 0) - 1);
  await sw(userId, { ...worker, points: newPoints });

  // Mark as un-rewarded in the announcement so deadline cron doesn't double-process
  const announcement = await getAnnouncement(announcementId);
  if (announcement?.joins?.[userId]) {
    const updated = { ...announcement };
    updated.joins[userId].rewarded    = false;
    updated.joins[userId].pointRemoved = true;
    await saveAnnouncement(announcementId, updated);
  }

  // Disable the button on the log message
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("discord.js");
  const disabledRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(interaction.customId)
      .setLabel("➖ Point Removed")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true)
  );
  await interaction.update({ components: [disabledRow] });

  // DM the worker
  try {
    const user = await interaction.client.users.fetch(userId);
    await user.send(
      `➖ **A point was removed from your account** by the owner.\n` +
      `**New total:** ${newPoints} point${newPoints !== 1 ? "s" : ""}`
    );
  } catch (_) {}
}