/**
 * breakHandler.js — "On Break" system
 *
 * Flow:
 *  1. Worker presses "On Break" in guide channel
 *  2. Modal opens: duration (days) + reason
 *  3. Owner is DM'd an embed with Accept / Decline buttons
 *  4. If accepted → worker.onBreak = true, breakUntil set
 *     — during break: strikes and points cannot be earned
 *  5. If declined → worker notified via DM
 *  6. Break auto-expires via cron (checkBreaks)
 *  7. Worker can press "End Break Early" once on break
 */

import fs from "fs";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { getWorker, saveWorker } from "../workerStorage.js";
import { sendLog } from "./logHandler.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

// ─── Button: worker_on_break ──────────────────────────────────────────────────

export async function handleOnBreakButton(interaction) {
  const userId = interaction.user.id;
  const worker = await getWorker(userId);

  if (!worker || worker.status !== "accepted") {
    return interaction.reply({
      content: "❌ You are not an accepted worker.",
      ephemeral: true
    });
  }

  if (worker.onBreak) {
    // Already on break — show end break early option
    const breakUntilTs = worker.breakUntil
      ? Math.floor(new Date(worker.breakUntil).getTime() / 1000)
      : null;

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle("⏸️ You Are Currently On Break")
      .setDescription(
        breakUntilTs
          ? `Your break ends <t:${breakUntilTs}:R> (<t:${breakUntilTs}:f>).\n\nYou can end your break early if you're ready to return.`
          : "Your break is active. You can end it early below."
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("worker_end_break")
        .setLabel("✅ End Break Early")
        .setStyle(ButtonStyle.Success)
    );

    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  if (worker.breakPending) {
    return interaction.reply({
      content: "⏳ You already have a break request pending owner approval.",
      ephemeral: true
    });
  }

  // Show modal for duration + reason
  const modal = new ModalBuilder()
    .setCustomId("worker_break_modal")
    .setTitle("Request a Break");

  const durationInput = new TextInputBuilder()
    .setCustomId("break_duration")
    .setLabel("Duration (number of days, e.g. 3)")
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(3)
    .setPlaceholder("1–30")
    .setRequired(true);

  const reasonInput = new TextInputBuilder()
    .setCustomId("break_reason")
    .setLabel("Reason for break")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(5)
    .setMaxLength(500)
    .setPlaceholder("e.g. Going on holiday, exams, etc.")
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(durationInput),
    new ActionRowBuilder().addComponents(reasonInput)
  );

  await interaction.showModal(modal);
}

// ─── Modal submit: worker_break_modal ────────────────────────────────────────

export async function handleBreakModal(interaction) {
  const userId = interaction.user.id;
  const worker = await getWorker(userId);

  if (!worker || worker.status !== "accepted") {
    return interaction.reply({ content: "❌ You are not an accepted worker.", ephemeral: true });
  }

  const rawDays = interaction.fields.getTextInputValue("break_duration").trim();
  const reason  = interaction.fields.getTextInputValue("break_reason").trim();

  const days = parseInt(rawDays, 10);
  if (isNaN(days) || days < 1 || days > 30) {
    return interaction.reply({
      content: "❌ Duration must be a whole number between 1 and 30.",
      ephemeral: true
    });
  }

  const breakUntil = new Date(Date.now() + days * 86_400_000).toISOString();
  const breakUntilTs = Math.floor(new Date(breakUntil).getTime() / 1000);

  // Mark pending
  await saveWorker(userId, {
    ...worker,
    breakPending:  true,
    pendingBreak: { days, reason, breakUntil, requestedAt: new Date().toISOString() }
  });

  // DM owner
  const owner = await interaction.client.users.fetch(config.ownerId).catch(() => null);
  if (!owner) {
    await saveWorker(userId, { ...worker, breakPending: false, pendingBreak: null });
    return interaction.reply({ content: "❌ Could not reach the owner. Try again later.", ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle("⏸️ Break Request")
    .setDescription(
      [
        `**Worker:** <@${userId}> (\`${userId}\`)`,
        `**Duration:** ${days} day${days !== 1 ? "s" : ""}`,
        `**Would end:** <t:${breakUntilTs}:f> (<t:${breakUntilTs}:R>)`,
        `**Reason:**\n${reason}`
      ].join("\n")
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`break_accept_${userId}`)
      .setLabel("✅ Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`break_decline_${userId}`)
      .setLabel("❌ Decline")
      .setStyle(ButtonStyle.Danger)
  );

  await owner.send({ embeds: [embed], components: [row] });

  return interaction.reply({
    content:
      `✅ Your break request has been sent to the owner.\n` +
      `You'll be notified once it's reviewed.\n\n` +
      `**Requested:** ${days} day${days !== 1 ? "s" : ""} — ending <t:${breakUntilTs}:R>`,
    ephemeral: true
  });
}

// ─── Owner DM: break_accept_<userId> ─────────────────────────────────────────

export async function handleBreakAccept(interaction) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: "❌ Not for you.", ephemeral: true });
  }

  const userId = interaction.customId.replace("break_accept_", "");
  const worker = await getWorker(userId);

  if (!worker || !worker.breakPending || !worker.pendingBreak) {
    return interaction.reply({ content: "❌ No pending break request found for this worker.", ephemeral: true });
  }

  const { days, reason, breakUntil } = worker.pendingBreak;
  const breakUntilTs = Math.floor(new Date(breakUntil).getTime() / 1000);

  await saveWorker(userId, {
    ...worker,
    onBreak:      true,
    breakUntil,
    breakReason:  reason,
    breakPending: false,
    pendingBreak: null
  });

  // Disable the buttons on the owner's DM
  const disabledRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`break_accept_${userId}`)
      .setLabel("✅ Accepted")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`break_decline_${userId}`)
      .setLabel("❌ Decline")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true)
  );
  await interaction.update({ components: [disabledRow] });

  // DM worker
  const workerUser = await interaction.client.users.fetch(userId).catch(() => null);
  if (workerUser) {
    await workerUser.send(
      `✅ **Your break request has been approved!**\n` +
      `**Duration:** ${days} day${days !== 1 ? "s" : ""}\n` +
      `**Break ends:** <t:${breakUntilTs}:f> (<t:${breakUntilTs}:R>)\n\n` +
      `During your break you will not receive strikes or earn points from announcements.\n` +
      `You can end your break early by pressing **On Break** in the guide channel.`
    ).catch(() => {});
  }

  // Log
  const { getWorkerConfig } = await import("../workerStorage.js");
  const cfgs = await getWorkerConfig();
  const cfg  = cfgs[worker.guildId];
  if (cfg) {
    await sendLog(interaction.client, worker.guildId, cfg.logChannelId, {
      type:      "break_accepted",
      userId,
      duration:  `${days} day${days !== 1 ? "s" : ""}`,
      expiresAt: breakUntil,
      reason,
      adminId:   interaction.user.id
    });
  }
}

// ─── Owner DM: break_decline_<userId> ────────────────────────────────────────

export async function handleBreakDecline(interaction) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: "❌ Not for you.", ephemeral: true });
  }

  const userId = interaction.customId.replace("break_decline_", "");
  const worker = await getWorker(userId);

  if (!worker || !worker.breakPending) {
    return interaction.reply({ content: "❌ No pending break request found for this worker.", ephemeral: true });
  }

  await saveWorker(userId, {
    ...worker,
    breakPending: false,
    pendingBreak: null
  });

  const disabledRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`break_accept_${userId}`)
      .setLabel("✅ Accept")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`break_decline_${userId}`)
      .setLabel("❌ Declined")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true)
  );
  await interaction.update({ components: [disabledRow] });

  const workerUser = await interaction.client.users.fetch(userId).catch(() => null);
  if (workerUser) {
    await workerUser.send(
      `❌ **Your break request has been declined by the owner.**\n` +
      `If you have questions, please contact the owner directly.`
    ).catch(() => {});
  }

  // Log
  const { getWorkerConfig } = await import("../workerStorage.js");
  const cfgs = await getWorkerConfig();
  const cfg  = cfgs[worker.guildId];
  if (cfg) {
    await sendLog(interaction.client, worker.guildId, cfg.logChannelId, {
      type:    "break_declined",
      userId,
      adminId: interaction.user.id
    });
  }
}

// ─── Button: worker_end_break ─────────────────────────────────────────────────

export async function handleEndBreakButton(interaction) {
  const userId = interaction.user.id;
  const worker = await getWorker(userId);

  if (!worker || !worker.onBreak) {
    return interaction.reply({ content: "❌ You are not currently on a break.", ephemeral: true });
  }

  await endBreak(userId, worker, interaction.client, "ended_early");

  return interaction.update({
    content: "✅ Your break has been ended. Welcome back!",
    embeds:  [],
    components: []
  });
}

// ─── Shared: end a break ──────────────────────────────────────────────────────

async function endBreak(userId, worker, client, reason = "expired") {
  await saveWorker(userId, {
    ...worker,
    onBreak:     false,
    breakUntil:  null,
    breakReason: null
  });

  const { getWorkerConfig } = await import("../workerStorage.js");
  const cfgs = await getWorkerConfig();
  const cfg  = cfgs[worker.guildId];

  if (cfg) {
    await sendLog(client, worker.guildId, cfg.logChannelId, {
      type:   "break_ended",
      userId,
      note:   reason === "expired" ? "Break expired automatically" : "Worker ended break early"
    });
  }

  if (reason === "expired") {
    try {
      const user = await client.users.fetch(userId);
      await user.send("✅ **Your break has ended.** Welcome back! You will now receive strikes and earn points from new announcements.");
    } catch (_) {}
  }
}

// ─── Cron: check expired breaks every 5 minutes ──────────────────────────────

export async function checkBreaks(client) {
  const { getWorkers } = await import("../workerStorage.js");
  const workers = await getWorkers();
  const now = Date.now();

  for (const [userId, worker] of Object.entries(workers)) {
    if (!worker.onBreak || !worker.breakUntil) continue;
    if (now < new Date(worker.breakUntil).getTime()) continue;

    await endBreak(userId, worker, client, "expired");
  }
}