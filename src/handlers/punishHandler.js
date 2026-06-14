import fs from "fs";
import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";
import { getWorker } from "../workerStorage.js";
import { sendLog } from "./logHandler.js";
import { getWorkerConfig } from "../workerStorage.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

// ─── Button: log_punish_<userId> ──────────────────────────────────────────────

export async function handlePunishButton(interaction) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: "❌ Only the bot owner can do this.", ephemeral: true });
  }

  const userId = interaction.customId.replace("log_punish_", "");

  const modal = new ModalBuilder()
    .setCustomId(`punish_modal_${userId}`)
    .setTitle("Punish Worker");

  const reasonInput = new TextInputBuilder()
    .setCustomId("punish_reason")
    .setLabel("Reason for punishment")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(5)
    .setMaxLength(500)
    .setRequired(true);

  const punishmentInput = new TextInputBuilder()
    .setCustomId("punish_action")
    .setLabel("Punishment (e.g. warning, removed, banned)")
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(100)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(reasonInput),
    new ActionRowBuilder().addComponents(punishmentInput)
  );

  await interaction.showModal(modal);
}

// ─── Modal: punish_modal_<userId> ────────────────────────────────────────────

export async function handlePunishModal(interaction) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: "❌ Only the bot owner can do this.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const userId     = interaction.customId.replace("punish_modal_", "");
  const reason     = interaction.fields.getTextInputValue("punish_reason").trim();
  const punishment = interaction.fields.getTextInputValue("punish_action").trim();

  const worker = await getWorker(userId);
  if (!worker) {
    return interaction.editReply({ content: "❌ Worker not found." });
  }

  // Find guild config
  const configs = await getWorkerConfig();
  const cfg     = configs[worker.guildId];

  // Log to log channel
  if (cfg) {
    const guild   = await interaction.client.guilds.fetch(worker.guildId).catch(() => null);
    const channel = guild ? await guild.channels.fetch(cfg.logChannelId).catch(() => null) : null;

    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("🔨 Worker Punished")
        .addFields(
          { name: "👤 Worker",      value: `<@${userId}> (\`${userId}\`)`, inline: true },
          { name: "👮 By",          value: `<@${interaction.user.id}>`,    inline: true },
          { name: "🔨 Punishment",  value: punishment,                     inline: false },
          { name: "❓ Reason",      value: reason,                         inline: false }
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    }
  }

  // DM the worker
  try {
    const user = await interaction.client.users.fetch(userId);
    await user.send(
      `🔨 **You have received a punishment from the owner.**\n\n` +
      `**Punishment:** ${punishment}\n` +
      `**Reason:** ${reason}`
    );
  } catch (_) {}

  // Disable the punish button on the original log message
  try {
    const components = interaction.message?.components;
    if (components) {
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("discord.js");
      const newRows = components.map(row => {
        const newRow = new ActionRowBuilder();
        newRow.addComponents(
          row.components.map(btn => {
            const b = ButtonBuilder.from(btn);
            if (btn.customId === `log_punish_${userId}`) {
              b.setLabel("✅ Punished").setDisabled(true).setStyle(ButtonStyle.Secondary);
            }
            return b;
          })
        );
        return newRow;
      });
      await interaction.message.edit({ components: newRows });
    }
  } catch (_) {}

  await interaction.editReply({ content: `✅ Punishment applied to <@${userId}> and they have been DMed.` });
}