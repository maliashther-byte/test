import fs from "fs";
import {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} from "discord.js";
import { getWorker, saveWorker, getWorkers, getWorkerConfig } from "../workerStorage.js";
import { addStrike, removeStrike } from "./strikeHandler.js";
import { sendLog } from "./logHandler.js";

const config = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));

export const data = new SlashCommandBuilder()
  .setName("workerspanel")
  .setDescription("Open the worker moderation panel.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption(o => o.setName("worker").setDescription("The worker to manage").setRequired(true));

export async function execute(interaction) {
  if (interaction.user.id !== config.ownerId && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "❌ Admins only.", ephemeral: true });
  }

  const target = interaction.options.getUser("worker");
  const worker = await getWorker(target.id);

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`👷 Worker Panel — ${target.tag}`)
    .setThumbnail(target.displayAvatarURL({ dynamic: true }))
    .setDescription(
      "**Available Actions:**\n" +
      "⏱ **Timeout** — Mute the worker in this server\n" +
      "🔨 **Ban** — Ban from this server\n" +
      "✅ **Unban** — Unban from this server\n" +
      "⚡ **Add Strike** — Add a strike to their record\n" +
      "🔧 **Remove Strike** — Remove a strike with reason\n" +
      "➕ **Add Point** — Manually add a point\n" +
      "➖ **Remove Point** — Manually remove a point\n" +
      "📊 **View Stats** — See their current points/strikes\n" +
      "🔨 **Punish** — Log a custom punishment"
    )
    .addFields(
      { name: "⭐ Points",    value: worker ? `${worker.points ?? 0}`   : "Not a worker", inline: true },
      { name: "⚡ Strikes",  value: worker ? `${worker.strikes ?? 0}/2` : "Not a worker", inline: true },
      { name: "📋 Status",   value: worker ? worker.status              : "Not found",    inline: true }
    )
    .setFooter({ text: `User ID: ${target.id}` });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`wp_timeout_${target.id}`).setLabel("⏱ Timeout").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`wp_ban_${target.id}`).setLabel("🔨 Ban").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`wp_unban_${target.id}`).setLabel("✅ Unban").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`wp_addstrike_${target.id}`).setLabel("⚡ Add Strike").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`wp_removestrike_${target.id}`).setLabel("🔧 Remove Strike").setStyle(ButtonStyle.Primary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`wp_addpoint_${target.id}`).setLabel("➕ Point").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`wp_removepoint_${target.id}`).setLabel("➖ Point").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`wp_stats_${target.id}`).setLabel("📊 Stats").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`wp_punish_${target.id}`).setLabel("🔨 Punish").setStyle(ButtonStyle.Danger)
  );

  await interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
}

// ─── Button handlers ──────────────────────────────────────────────────────────
export async function handleWorkerPanelButton(interaction) {
  const parts  = interaction.customId.split("_");
  const action = parts[1];
  const userId = parts[2];

  if (interaction.user.id !== config.ownerId && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "❌ Admins only.", ephemeral: true });
  }

  const worker = await getWorker(userId);
  const configs = await getWorkerConfig();
  const cfg = configs[interaction.guild.id];

  if (action === "timeout") {
    const modal = new ModalBuilder().setCustomId(`wp_timeout_modal_${userId}`).setTitle("Timeout Worker");
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("duration").setLabel("Duration (e.g. 10m, 1h, 1d)").setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Reason").setStyle(TextInputStyle.Paragraph).setRequired(true))
    );
    return interaction.showModal(modal);
  }

  if (action === "ban") {
    const modal = new ModalBuilder().setCustomId(`wp_ban_modal_${userId}`).setTitle("Ban Worker");
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Reason").setStyle(TextInputStyle.Paragraph).setRequired(true))
    );
    return interaction.showModal(modal);
  }

  if (action === "unban") {
    await interaction.deferReply({ ephemeral: true });
    await interaction.guild.bans.remove(userId, "Unbanned via worker panel").catch(() => {});
    return interaction.editReply({ content: `✅ <@${userId}> unbanned.` });
  }

  if (action === "addstrike") {
    await interaction.deferReply({ ephemeral: true });
    if (!worker) return interaction.editReply({ content: "❌ Not a worker." });
    await addStrike(userId, "manual", "manual_admin", cfg, interaction.client);
    return interaction.editReply({ content: `⚡ Strike added to <@${userId}>.` });
  }

  if (action === "removestrike") {
    const modal = new ModalBuilder().setCustomId(`wp_removestrike_modal_${userId}`).setTitle("Remove Strike");
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Reason for removing strike").setStyle(TextInputStyle.Paragraph).setRequired(true))
    );
    return interaction.showModal(modal);
  }

  if (action === "addpoint") {
    await interaction.deferReply({ ephemeral: true });
    if (!worker) return interaction.editReply({ content: "❌ Not a worker." });
    await saveWorker(userId, { ...worker, points: (worker.points ?? 0) + 1, totalPoints: (worker.totalPoints ?? 0) + 1 });
    return interaction.editReply({ content: `➕ Point added to <@${userId}>. Now: ${(worker.points ?? 0) + 1}` });
  }

  if (action === "removepoint") {
    await interaction.deferReply({ ephemeral: true });
    if (!worker) return interaction.editReply({ content: "❌ Not a worker." });
    const newPts = Math.max(0, (worker.points ?? 0) - 1);
    await saveWorker(userId, { ...worker, points: newPts });
    return interaction.editReply({ content: `➖ Point removed from <@${userId}>. Now: ${newPts}` });
  }

  if (action === "stats") {
    await interaction.deferReply({ ephemeral: true });
    if (!worker) return interaction.editReply({ content: "❌ Not a worker." });
    const embed = new EmbedBuilder().setColor(config.embedColor).setTitle(`📊 Stats — <@${userId}>`)
      .addFields(
        { name: "⭐ Points",       value: `${worker.points ?? 0}`,      inline: true },
        { name: "🏆 Total Points", value: `${worker.totalPoints ?? 0}`, inline: true },
        { name: "⚡ Strikes",     value: `${worker.strikes ?? 0}/2`,    inline: true },
        { name: "📋 Status",      value: worker.status,                 inline: true },
        { name: "✅ Verified",    value: worker.verified ? "Yes" : "No", inline: true },
        { name: "📅 Accepted",    value: worker.acceptedAt ? `<t:${Math.floor(new Date(worker.acceptedAt).getTime()/1000)}:D>` : "N/A", inline: true }
      );
    return interaction.editReply({ embeds: [embed] });
  }

  if (action === "punish") {
    const modal = new ModalBuilder().setCustomId(`wp_punish_modal_${userId}`).setTitle("Punish Worker");
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Reason").setStyle(TextInputStyle.Paragraph).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("punishment").setLabel("Punishment (e.g. warned, removed, restricted)").setStyle(TextInputStyle.Short).setRequired(true))
    );
    return interaction.showModal(modal);
  }
}

export async function handleWorkerPanelModal(interaction) {
  const parts  = interaction.customId.split("_");
  const action = parts[1];
  const userId = parts[parts.length - 1];

  await interaction.deferReply({ ephemeral: true });

  const worker  = await getWorker(userId);
  const configs = await getWorkerConfig();
  const cfg     = configs[interaction.guild.id];
  const member  = await interaction.guild.members.fetch(userId).catch(() => null);

  if (action === "timeout") {
    const durationStr = interaction.fields.getTextInputValue("duration");
    const reason      = interaction.fields.getTextInputValue("reason");
    const ms = parseDuration(durationStr);
    if (!ms) return interaction.editReply({ content: "❌ Invalid duration. Use e.g. 10m, 1h, 1d." });
    await member?.timeout(ms, reason).catch(() => {});
    try { await (await interaction.client.users.fetch(userId)).send(`⏱ You've been timed out for **${durationStr}**.\n**Reason:** ${reason}`); } catch (_) {}
    return interaction.editReply({ content: `✅ <@${userId}> timed out for ${durationStr}.` });
  }

  if (action === "ban") {
    const reason = interaction.fields.getTextInputValue("reason");
    await member?.ban({ reason }).catch(() => {});
    try { await (await interaction.client.users.fetch(userId)).send(`🔨 You've been banned.\n**Reason:** ${reason}`); } catch (_) {}
    return interaction.editReply({ content: `✅ <@${userId}> banned.` });
  }

  if (action === "removestrike") {
    const reason = interaction.fields.getTextInputValue("reason");
    if (!worker) return interaction.editReply({ content: "❌ Not a worker." });
    const newStrikes = Math.max(0, (worker.strikes ?? 0) - 1);
    await saveWorker(userId, { ...worker, strikes: newStrikes });
    if (cfg) await sendLog(interaction.client, interaction.guild.id, cfg.logChannelId, { type: "strike_removed", userId, strikes: newStrikes, reason, adminId: interaction.user.id });
    try { await (await interaction.client.users.fetch(userId)).send(`🔧 A strike was removed.\n**Reason:** ${reason}\n**Strikes now:** ${newStrikes}/2`); } catch (_) {}
    return interaction.editReply({ content: `✅ Strike removed from <@${userId}>. Now: ${newStrikes}/2` });
  }

  if (action === "punish") {
    const reason     = interaction.fields.getTextInputValue("reason");
    const punishment = interaction.fields.getTextInputValue("punishment");
    if (cfg) {
      const guild   = interaction.guild;
      const channel = await guild.channels.fetch(cfg.logChannelId).catch(() => null);
      if (channel) {
        const embed = new EmbedBuilder().setColor(0xed4245).setTitle("🔨 Worker Punished")
          .addFields({ name: "👤 Worker", value: `<@${userId}>`, inline: true }, { name: "🔨 Punishment", value: punishment, inline: true }, { name: "❓ Reason", value: reason, inline: false });
        await channel.send({ embeds: [embed] });
      }
    }
    try { await (await interaction.client.users.fetch(userId)).send(`🔨 **Punishment:** ${punishment}\n**Reason:** ${reason}`); } catch (_) {}
    return interaction.editReply({ content: `✅ Punishment logged for <@${userId}>.` });
  }
}

function parseDuration(str) {
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