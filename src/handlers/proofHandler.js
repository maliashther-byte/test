import fs from "fs";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import {
  getWorkerConfig,
  getAnnouncement,
  saveAnnouncement,
  getWorker,
  saveWorker
} from "../workerStorage.js";
import { checkUserInServer } from "../oauthServer.js";
import { addStrike } from "./strikeHandler.js";
import { sendLog } from "./logHandler.js";
import { countRewardedJoins, grantPoint } from "./announcementHandler.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

// ─── Button: worker_log_proof ─────────────────────────────────────────────────

export async function handleLogProofButton(interaction) {
  const userId = interaction.user.id;

  // Must be an accepted worker
  const worker = await getWorker(userId);
  if (!worker || worker.status !== "accepted") {
    return interaction.reply({
      content: "❌ You are not an accepted worker.",
      ephemeral: true
    });
  }

  // Must be verified (pressed the Verify button in DM)
  if (!worker.verified) {
    return interaction.reply({
      content:
        "❌ You haven't verified yet. Check your DMs for the **Verify Account** button and press it first.",
      ephemeral: true
    });
  }

  const announcementId = interaction.message.id;
  const announcement   = await getAnnouncement(announcementId);

  if (!announcement) {
    return interaction.reply({
      content: "❌ Could not find this announcement record.",
      ephemeral: true
    });
  }

  // Deadline check
  if (new Date() > new Date(announcement.deadlineAt)) {
    return interaction.reply({
      content: "❌ The deadline for this announcement has passed.",
      ephemeral: true
    });
  }

  // Already submitted proof for this announcement
  const existing = announcement.joins?.[userId];
  if (existing?.rewarded) {
    return interaction.reply({
      content: "✅ You already logged proof and received your point for this announcement.",
      ephemeral: true
    });
  }
  if (existing?.proofMsgId && !existing?.rewarded) {
    return interaction.reply({
      content: "⏳ Your proof is already submitted and being processed.",
      ephemeral: true
    });
  }
  if (existing?.strikeGiven) {
    return interaction.reply({
      content: "❌ You already received a strike for this announcement.",
      ephemeral: true
    });
  }

  // Show proof modal
  const modal = new ModalBuilder()
    .setCustomId(`worker_proof_modal_${announcementId}`)
    .setTitle("Log Proof");

  const screenshotInput = new TextInputBuilder()
    .setCustomId("proof_screenshot")
    .setLabel("Screenshot link (Imgur, Discord CDN, etc.)")
    .setStyle(TextInputStyle.Short)
    .setMinLength(10)
    .setMaxLength(500)
    .setPlaceholder("https://imgur.com/...")
    .setRequired(true);

  const notesInput = new TextInputBuilder()
    .setCustomId("proof_notes")
    .setLabel("Anything to note? (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(300)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(screenshotInput),
    new ActionRowBuilder().addComponents(notesInput)
  );

  await interaction.showModal(modal);
}

// ─── Modal: worker_proof_modal_<announcementId> ────────────────────────────────

export async function handleProofModal(interaction) {
  // customId: worker_proof_modal_<announcementId>
  const announcementId = interaction.customId.replace("worker_proof_modal_", "");
  const userId         = interaction.user.id;

  await interaction.deferReply({ ephemeral: true });

  const worker = await getWorker(userId);
  if (!worker || worker.status !== "accepted") {
    return interaction.editReply({ content: "❌ You are not an accepted worker." });
  }

  const announcement = await getAnnouncement(announcementId);
  if (!announcement) {
    return interaction.editReply({ content: "❌ Announcement record not found." });
  }

  // Deadline re-check after modal (can take time to fill)
  if (new Date() > new Date(announcement.deadlineAt)) {
    return interaction.editReply({
      content: "❌ The deadline passed while you were filling out the form. Your proof cannot be accepted."
    });
  }

  // Re-check not already submitted (race condition safety)
  const existingJoin = announcement.joins?.[userId];
  if (existingJoin?.rewarded) {
    return interaction.editReply({ content: "✅ You already received your point for this announcement." });
  }
  if (existingJoin?.proofMsgId) {
    return interaction.editReply({ content: "⏳ Proof already submitted." });
  }

  const screenshotUrl = interaction.fields.getTextInputValue("proof_screenshot").trim();
  const notes         = interaction.fields.getTextInputValue("proof_notes").trim();

  // Basic URL validation
  try {
    new URL(screenshotUrl);
  } catch {
    return interaction.editReply({
      content: "❌ That doesn't look like a valid URL. Please paste a direct image link."
    });
  }

  // Block obviously fake/placeholder URLs
  const blockedDomains = ["example.com", "test.com", "placeholder.com"];
  const urlHost = new URL(screenshotUrl).hostname;
  if (blockedDomains.some(d => urlHost.includes(d))) {
    return interaction.editReply({ content: "❌ Invalid screenshot URL." });
  }

  const cfg = (await getWorkerConfig())[announcement.guildId];
  if (!cfg) {
    return interaction.editReply({ content: "❌ Worker config not found." });
  }

  // ── Check if max joins cap has been reached ───────────────────────────────
  const rewardedCount = countRewardedJoins(announcement);
  if (announcement.maxJoins > 0 && rewardedCount >= announcement.maxJoins) {
    // Mark as capped — no reward, no strike
    const updated = { ...announcement };
    if (!updated.joins[userId]) updated.joins[userId] = { userId };
    updated.joins[userId].capped    = true;
    updated.joins[userId].proofMsgId = "capped";
    await saveAnnouncement(announcementId, updated);

    return interaction.editReply({
      content:
        `🔒 The maximum number of rewarded joins (${announcement.maxJoins}) has been reached for this announcement.\n` +
        "You will **not** receive a point or a strike — this is not counted against you."
    });
  }

  // ── Check rejoin — has this user already been rewarded on a previous
  //    announcement for the SAME server link? ────────────────────────────────
  const allAnnouncements = await (await import("../workerStorage.js")).getAnnouncements();
  const alreadyJoinedSameServer = Object.values(allAnnouncements).some(a => {
    if (a.id === announcementId) return false;
    if (a.link !== announcement.link) return false;
    return a.joins?.[userId]?.rewarded === true;
  });

  if (alreadyJoinedSameServer) {
    // Rejoin — no reward, no strike
    const updated = { ...announcement };
    if (!updated.joins[userId]) updated.joins[userId] = { userId };
    updated.joins[userId].rejoin    = true;
    updated.joins[userId].proofMsgId = "rejoin";
    await saveAnnouncement(announcementId, updated);

    return interaction.editReply({
      content:
        "🔄 You have already joined this server for a previous announcement.\n" +
        "Rejoins do **not** count for rewards. No point or strike issued."
    });
  }

  // ── Verify server membership via OAuth ───────────────────────────────────
  let targetGuildId = announcement.targetGuildId ?? null;
  let memberStatus;

  if (targetGuildId) {
    memberStatus = await checkUserInServer(userId, targetGuildId);
  } else {
    targetGuildId = await resolveInviteGuildId(interaction.client, announcement.link);
    if (targetGuildId) {
      await saveAnnouncement(announcementId, { ...announcement, targetGuildId });
      memberStatus = await checkUserInServer(userId, targetGuildId);
    } else {
      memberStatus = "unresolvable";
    }
  }

  // ── Save proof record ─────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const updated = { ...announcement };
  if (!updated.joins[userId]) updated.joins[userId] = { userId };
  updated.joins[userId].proofMsgId   = `${userId}-${Date.now()}`;
  updated.joins[userId].screenshotUrl = screenshotUrl;
  updated.joins[userId].notes         = notes;
  updated.joins[userId].joinedAt      = now;
  updated.joins[userId].memberStatus  = memberStatus;
  await saveAnnouncement(announcementId, updated);

  // ── Decide outcome based on membership check ──────────────────────────────
  let pointAutoGranted = false;
  let strikeAutoIssued = false;
  let replyContent;

  if (memberStatus === "in_server") {
    // ✅ Confirmed — grant point immediately
    await grantPoint(userId, announcementId, updated, cfg, interaction.client);
    pointAutoGranted = true;
    replyContent =
      "✅ **Proof logged and membership confirmed!** You've been awarded **+1 point**.\n" +
      `You now have **${(worker.points ?? 0) + 1} points**.`;

  } else if (memberStatus === "not_in_server") {
    // ❌ Not in server — strike
    await addStrike(userId, announcementId, "not_in_server_at_proof", cfg, interaction.client);
    strikeAutoIssued = true;

    // Mark strike in announcement
    updated.joins[userId].strikeGiven = true;
    await saveAnnouncement(announcementId, updated);

    replyContent =
      "❌ **Your proof was submitted, but the bot could not confirm you are in the server.**\n" +
      "A strike has been issued. Make sure you join the server **before** logging proof.";

  } else if (memberStatus === "unverified") {
    replyContent =
      "⚠️ **Your proof was saved, but you haven't verified the bot's access yet.**\n" +
      "Check your DMs for the Verify Access button. Until you verify, membership cannot be confirmed and you may receive a strike.";

  } else {
    // "unresolvable" or "error" — save proof, pend for manual review
    replyContent =
      "✅ **Proof submitted!** The bot is processing your membership check.\n" +
      "A log has been sent for review.";
  }

  // ── Send to log channel (after outcome is determined) ─────────────────────
  await sendLog(interaction.client, announcement.guildId, cfg.logChannelId, {
    type:             "proof_submitted",
    userId,
    announcementId,
    screenshotUrl,
    notes,
    memberStatus,
    pointAutoGranted,
    strikeAutoIssued,
    requirements:     announcement.requirements
  });

  return interaction.editReply({ content: replyContent });
}

// ─── Resolve invite link to guild ID ─────────────────────────────────────────

async function resolveInviteGuildId(client, inviteLink) {
  try {
    // Extract invite code
    const match = inviteLink.match(/(?:discord\.gg|discord\.com\/invite)\/([a-zA-Z0-9-]+)/);
    if (!match) return null;

    const code   = match[1];
    const invite = await client.fetchInvite(code);
    return invite?.guild?.id ?? null;
  } catch (e) {
    console.error("Failed to resolve invite guild ID:", e);
    return null;
  }
}