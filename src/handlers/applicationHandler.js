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
import {
  getWorkers,
  saveWorkers,
  getWorker,
  saveWorker,
  getWorkerConfig
} from "../workerStorage.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

// Cooldown after rejection: 7 days in ms
const REJECTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Button: worker_apply ─────────────────────────────────────────────────────

export async function handleApplyButton(interaction) {
  const userId = interaction.user.id;

  // ── Guard: check existing application state ──────────────────────────────
  const existing = await getWorker(userId);

  if (existing) {
    if (existing.status === "accepted") {
      return interaction.reply({
        content: "✅ You are already an accepted worker.",
        ephemeral: true
      });
    }

    if (existing.status === "pending") {
      return interaction.reply({
        content: "⏳ Your application is already pending review. Please wait.",
        ephemeral: true
      });
    }

    if (existing.status === "banned") {
      return interaction.reply({
        content: "🚫 You are not eligible to apply.",
        ephemeral: true
      });
    }

    if (existing.status === "rejected") {
      // Enforce 7-day cooldown
      const rejectedAt = new Date(existing.rejectedAt).getTime();
      const now = Date.now();
      if (now - rejectedAt < REJECTION_COOLDOWN_MS) {
        const availableAt = new Date(rejectedAt + REJECTION_COOLDOWN_MS);
        const ts = Math.floor(availableAt.getTime() / 1000);
        return interaction.reply({
          content: `❌ Your application was rejected. You can reapply <t:${ts}:R>.`,
          ephemeral: true
        });
      }
      // Cooldown passed — allow reapplication (fall through to modal)
    }
  }

  // ── Show the application modal ───────────────────────────────────────────
  const modal = new ModalBuilder()
    .setCustomId("worker_apply_modal")
    .setTitle("Worker Application");

  const whyInput = new TextInputBuilder()
    .setCustomId("apply_why")
    .setLabel("Why do you want to join the worker team?")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(20)
    .setMaxLength(500)
    .setPlaceholder("Be honest and detailed — short answers are rejected.")
    .setRequired(true);

  const experienceInput = new TextInputBuilder()
    .setCustomId("apply_experience")
    .setLabel("Any relevant experience? (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(300)
    .setPlaceholder("Previous similar work, how active you are, etc.")
    .setRequired(false);

  const onlineHoursInput = new TextInputBuilder()
    .setCustomId("apply_online_hours")
    .setLabel("How long are you online on average per day?")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setPlaceholder("e.g. 3-4 hours, mostly evenings")
    .setRequired(true);

  const upcomingEventsInput = new TextInputBuilder()
    .setCustomId("apply_upcoming_events")
    .setLabel("Upcoming events that may stop you joining?")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(300)
    .setPlaceholder("e.g. exams next month, holiday in 2 weeks, or 'None'")
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(whyInput),
    new ActionRowBuilder().addComponents(experienceInput),
    new ActionRowBuilder().addComponents(onlineHoursInput),
    new ActionRowBuilder().addComponents(upcomingEventsInput)
  );

  await interaction.showModal(modal);
}

// ─── Modal: worker_apply_modal ────────────────────────────────────────────────

export async function handleApplyModal(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId   = interaction.user.id;
  const guildId  = interaction.guild.id;
  const why         = interaction.fields.getTextInputValue("apply_why").trim();
  const experience  = interaction.fields.getTextInputValue("apply_experience").trim();
  const onlineHours = interaction.fields.getTextInputValue("apply_online_hours").trim();
  const upcomingEvents = interaction.fields.getTextInputValue("apply_upcoming_events").trim();

  // ── Re-check guards after modal submit (race condition safety) ────────────
  const existing = await getWorker(userId);

  if (existing?.status === "accepted") {
    return interaction.editReply({ content: "✅ You are already an accepted worker." });
  }
  if (existing?.status === "pending") {
    return interaction.editReply({ content: "⏳ Your application is already pending." });
  }
  if (existing?.status === "banned") {
    return interaction.editReply({ content: "🚫 You are not eligible to apply." });
  }

  // ── Save worker as pending ────────────────────────────────────────────────
  await saveWorker(userId, {
    userId,
    guildId,
    status:      "pending",
    points:      existing?.points      ?? 0,
    strikes:     existing?.strikes     ?? 0,
    totalPoints: existing?.totalPoints ?? 0,
    appliedAt:   new Date().toISOString(),
    acceptedAt:  null,
    rejectedAt:  null,
    applicationAnswers: { why, experience, onlineHours, upcomingEvents }
  });

  // ── DM the owner with accept/reject buttons ───────────────────────────────
  try {
    const ownerUser = await interaction.client.users.fetch(config.ownerId);

    const embed = new EmbedBuilder()
      .setColor(0xf0a500)
      .setTitle("📋 New Worker Application")
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: "👤 User",           value: `${interaction.user.tag} (<@${userId}>)`, inline: true },
        { name: "🆔 User ID",        value: userId,                                   inline: true },
        { name: "🏠 Server",         value: interaction.guild.name,                   inline: true },
        { name: "❓ Why joining",    value: why },
        { name: "📝 Experience",     value: experience || "_Not provided_" },
        { name: "🕐 Online daily",   value: onlineHours },
        { name: "📅 Upcoming events", value: upcomingEvents }
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`worker_accept_${userId}_${guildId}`)
        .setLabel("✅ Accept")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`worker_reject_${userId}_${guildId}`)
        .setLabel("❌ Reject")
        .setStyle(ButtonStyle.Danger)
    );

    await ownerUser.send({ embeds: [embed], components: [row] });
  } catch (e) {
    console.error("Failed to DM owner:", e);
    // Don't block the user — application is saved, owner can check manually
  }

  await interaction.editReply({
    content:
      "✅ **Application submitted!** The owner will review it shortly.\n" +
      "You will receive a DM when a decision is made."
  });
}

// ─── Button: worker_accept_<userId>_<guildId> ─────────────────────────────────

export async function handleAcceptButton(interaction) {
  // Only owner can accept
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: "❌ Not for you.", ephemeral: true });
  }

  await interaction.deferUpdate();

  const parts   = interaction.customId.split("_");
  // customId: worker_accept_<userId>_<guildId>
  const userId  = parts[2];
  const guildId = parts[3];

  const worker = await getWorker(userId);
  if (!worker) {
    return interaction.followUp({ content: "❌ Worker record not found.", ephemeral: true });
  }
  if (worker.status === "accepted") {
    return interaction.followUp({ content: "⚠️ Already accepted.", ephemeral: true });
  }

  // ── Update worker status ──────────────────────────────────────────────────
  await saveWorker(userId, {
    ...worker,
    status:     "accepted",
    acceptedAt: new Date().toISOString()
  });

  // ── Give accepted role in guild ───────────────────────────────────────────
  try {
    const guild  = await interaction.client.guilds.fetch(guildId);
    const cfg    = (await getWorkerConfig())[guildId];
    const member = await guild.members.fetch(userId).catch(() => null);

    if (member && cfg?.acceptedRoleId) {
      await member.roles.add(cfg.acceptedRoleId).catch(console.error);
    }
  } catch (e) {
    console.error("Role assignment error:", e);
  }

  // ── DM the user: accepted + simple verify button ──────────────────────────
  try {
    const workerUser = await interaction.client.users.fetch(userId);

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("✅ Application Accepted!")
      .setDescription(
        [
          "Congratulations — you've been accepted as a worker!",
          "",
          "**Press Verify below** to confirm your account and gain full access.",
          "This is a one-time step — just one button press, no permissions or external sites.",
          "",
          "After verifying:",
          "• Watch the announcements channel for jobs",
          "• Read the guide channel for the full rules on points and strikes"
        ].join("\n")
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`worker_verify_${userId}`)
        .setLabel("✅ Verify")
        .setStyle(ButtonStyle.Success)
    );

    await workerUser.send({ embeds: [embed], components: [row] });
  } catch (e) {
    console.error("Failed to DM accepted user:", e);
  }

  // ── Edit owner DM to show accepted ───────────────────────────────────────
  const confirmedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(0x57f287)
    .setTitle("✅ Application Accepted");

  await interaction.message.edit({
    embeds:     [confirmedEmbed],
    components: []
  });

  await interaction.followUp({ content: `✅ Accepted <@${userId}> and sent them a verification DM.`, ephemeral: true });
}

// ─── Button: worker_reject_<userId>_<guildId> ─────────────────────────────────

export async function handleRejectButton(interaction) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: "❌ Not for you.", ephemeral: true });
  }

  await interaction.deferUpdate();

  const parts   = interaction.customId.split("_");
  const userId  = parts[2];
  const guildId = parts[3];

  const worker = await getWorker(userId);
  if (!worker) {
    return interaction.followUp({ content: "❌ Worker record not found.", ephemeral: true });
  }
  if (worker.status === "rejected") {
    return interaction.followUp({ content: "⚠️ Already rejected.", ephemeral: true });
  }

  // ── Update worker status ──────────────────────────────────────────────────
  await saveWorker(userId, {
    ...worker,
    status:     "rejected",
    rejectedAt: new Date().toISOString()
  });

  // ── DM the user: rejected ─────────────────────────────────────────────────
  try {
    const workerUser = await interaction.client.users.fetch(userId);

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("❌ Application Rejected")
      .setDescription(
        "Unfortunately your application was not accepted this time.\n\n" +
        "You may reapply in **7 days**. Make sure to put more detail in your answers."
      )
      .setTimestamp();

    await workerUser.send({ embeds: [embed] });
  } catch (e) {
    console.error("Failed to DM rejected user:", e);
  }

  // ── Edit owner DM ─────────────────────────────────────────────────────────
  const rejectedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(0xed4245)
    .setTitle("❌ Application Rejected");

  await interaction.message.edit({
    embeds:     [rejectedEmbed],
    components: []
  });

  await interaction.followUp({ content: `❌ Rejected <@${userId}>.`, ephemeral: true });
}

// ─── Button: worker_my_stats ──────────────────────────────────────────────────

export async function handleMyStats(interaction) {
  const worker = await getWorker(interaction.user.id);

  if (!worker || worker.status !== "accepted") {
    return interaction.reply({
      content: "❌ You are not an accepted worker.",
      ephemeral: true
    });
  }

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle("📊 Your Worker Stats")
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: "✅ Points",        value: `${worker.points}`,      inline: true },
      { name: "⚡ Strikes",       value: `${worker.strikes}/2`,   inline: true },
      { name: "🏆 Total Points",  value: `${worker.totalPoints}`, inline: true },
      { name: "📅 Member Since",  value: `<t:${Math.floor(new Date(worker.acceptedAt).getTime() / 1000)}:D>`, inline: true }
    )
    .setFooter({ text: "Strikes reset every Monday • 15 points to claim reward" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ─── Button: worker_verify_<userId> (sent in DM after acceptance) ─────────────

export async function handleVerifyButton(interaction) {
  const userId = interaction.customId.replace("worker_verify_", "");

  // Only the intended user can press it
  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "❌ This button is not for you.", ephemeral: true });
  }

  const worker = await getWorker(userId);
  if (!worker || worker.status !== "accepted") {
    return interaction.reply({ content: "❌ Worker record not found.", ephemeral: true });
  }

  if (worker.verified) {
    return interaction.reply({ content: "✅ You are already verified!", ephemeral: true });
  }

  await saveWorker(userId, {
    ...worker,
    verified:   true,
    verifiedAt: new Date().toISOString()
  });

  // Disable the button
  const disabledRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`worker_verify_${userId}`)
      .setLabel("✅ Verified!")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true)
  );

  await interaction.update({ components: [disabledRow] });

  // Follow-up confirmation
  await interaction.followUp({
    content:
      "✅ **You are now verified!** You can log proof on announcements and the bot will confirm your server joins. Good luck!",
    ephemeral: false
  });
}