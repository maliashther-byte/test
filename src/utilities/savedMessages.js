// ── ?save / /panel — Saved Messages System ───────────────────────────────────
// ?save <message>  → form asks for name → saved
// /panel           → owner-only panel with Save, List, Deploy buttons
import fs from "fs";
import fsExtra from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder
} from "discord.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const dataDir    = path.join(__dirname, "..", "..", "data");
const file       = path.join(dataDir, "savedMessages.json");
const config     = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));

await fsExtra.ensureDir(dataDir);

async function load() {
  try {
    if (!await fsExtra.pathExists(file)) { await fsExtra.writeJson(file, {}, { spaces: 2 }); return {}; }
    return await fsExtra.readJson(file);
  } catch { return {}; }
}
async function save(data) { await fsExtra.writeJson(file, data, { spaces: 2 }); }

// ── ?save <message> ──────────────────────────────────────────────────────────
export async function handleSaveCommand(message) {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith("?save ")) return;

  const text = message.content.slice("?save ".length).trim();
  if (!text) return;

  await message.delete().catch(() => {});

  const modal = new ModalBuilder()
    .setCustomId(`savedmsg_name_${message.author.id}_${Date.now()}`)
    .setTitle("Save Message");

  // Store content temporarily via a DM prompt since we can't show modal from messageCreate
  // Instead: reply ephemeral-style then ask for name via next message
  const prompt = await message.channel.send({
    content: `<@${message.author.id}> 📝 Reply with the **name** to save this message as (one word, no spaces). You have 30 seconds.\n\n*Message to save:* \`${text.slice(0, 100)}\``
  });

  const filter = m => m.author.id === message.author.id;
  const collector = message.channel.createMessageCollector({ filter, max: 1, time: 30000 });

  collector.on("collect", async m => {
    const name = m.content.trim().replace(/\s+/g, "_");
    await m.delete().catch(() => {});
    await prompt.delete().catch(() => {});

    const all = await load();
    all[`${message.guild.id}:${name}`] = {
      name, guildId: message.guild.id, content: text,
      isEmbed: false, createdBy: message.author.id, createdAt: new Date().toISOString()
    };
    await save(all);

    const conf = await message.channel.send({ content: `✅ Message saved as **"${name}"**.` });
    setTimeout(() => conf.delete().catch(() => {}), 4000);
  });

  collector.on("end", collected => {
    if (!collected.size) prompt.delete().catch(() => {});
  });
}

// ── /panel ───────────────────────────────────────────────────────────────────
export const panelData = new SlashCommandBuilder()
  .setName("panel")
  .setDescription("[Owner] Manage saved messages.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function executePanel(interaction) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: "❌ Owner only.", ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setColor(config.embedColor ?? 0x5865f2)
    .setTitle("📋 Message Panel")
    .setDescription("Manage saved messages. Use the buttons below.");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("panel_save_embed").setLabel("💾 Save Embed").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("panel_list").setLabel("📃 List Saved").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel_deploy").setLabel("🚀 Deploy").setStyle(ButtonStyle.Success)
  );

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

// Button: panel_save_embed
export async function handlePanelSaveEmbed(interaction) {
  if (interaction.user.id !== config.ownerId) return interaction.reply({ content: "❌ Owner only.", ephemeral: true });

  const modal = new ModalBuilder().setCustomId("panel_save_embed_modal").setTitle("Save Embed Message");
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("msg_name").setLabel("Name (one word)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("embed_title").setLabel("Title (optional)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("embed_body").setLabel("Body / Description").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("embed_color").setLabel("Color hex (e.g. #ff0000) — optional").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("embed_image").setLabel("Image URL (optional)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500))
  );
  await interaction.showModal(modal);
}

// Modal: panel_save_embed_modal
export async function handlePanelSaveEmbedModal(interaction) {
  if (interaction.user.id !== config.ownerId) return interaction.reply({ content: "❌ Owner only.", ephemeral: true });
  await interaction.deferReply({ ephemeral: true });

  const name  = interaction.fields.getTextInputValue("msg_name").trim().replace(/\s+/g, "_");
  const title = interaction.fields.getTextInputValue("embed_title").trim();
  const body  = interaction.fields.getTextInputValue("embed_body").trim();
  const color = interaction.fields.getTextInputValue("embed_color").trim();
  const image = interaction.fields.getTextInputValue("embed_image").trim();

  const all = await load();
  all[`${interaction.guild.id}:${name}`] = {
    name, guildId: interaction.guild.id, isEmbed: true,
    embedOptions: { title, body, color, image },
    createdBy: interaction.user.id, createdAt: new Date().toISOString()
  };
  await save(all);
  await interaction.editReply({ content: `✅ Embed saved as **"${name}"**.` });
}

// Button: panel_list
export async function handlePanelList(interaction) {
  if (interaction.user.id !== config.ownerId) return interaction.reply({ content: "❌ Owner only.", ephemeral: true });

  const all     = await load();
  const entries = Object.values(all).filter(m => m.guildId === interaction.guild.id);
  if (!entries.length) return interaction.reply({ content: "No saved messages.", ephemeral: true });

  const embed = new EmbedBuilder().setColor(config.embedColor ?? 0x5865f2).setTitle("📃 Saved Messages")
    .addFields(entries.map(e => ({ name: e.name, value: e.isEmbed ? "📋 Embed" : `💬 ${String(e.content).slice(0, 80)}`, inline: true })));
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Button: panel_deploy
export async function handlePanelDeploy(interaction) {
  if (interaction.user.id !== config.ownerId) return interaction.reply({ content: "❌ Owner only.", ephemeral: true });

  const all     = await load();
  const entries = Object.values(all).filter(m => m.guildId === interaction.guild.id);
  if (!entries.length) return interaction.reply({ content: "No saved messages to deploy.", ephemeral: true });

  const modal = new ModalBuilder().setCustomId("panel_deploy_modal").setTitle("Deploy Saved Message");
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("deploy_name").setLabel("Message name to deploy").setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("deploy_channel_id").setLabel("Channel ID to send to").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(17).setMaxLength(20))
  );
  await interaction.showModal(modal);
}

// Modal: panel_deploy_modal
export async function handlePanelDeployModal(interaction) {
  if (interaction.user.id !== config.ownerId) return interaction.reply({ content: "❌ Owner only.", ephemeral: true });
  await interaction.deferReply({ ephemeral: true });

  const name      = interaction.fields.getTextInputValue("deploy_name").trim();
  const channelId = interaction.fields.getTextInputValue("deploy_channel_id").trim();

  const all  = await load();
  const msg  = all[`${interaction.guild.id}:${name}`];
  if (!msg) return interaction.editReply({ content: `❌ No saved message named **"${name}"**.` });

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return interaction.editReply({ content: "❌ Channel not found." });

  if (msg.isEmbed) {
    const e = msg.embedOptions;
    let color = config.embedColor ?? 0x5865f2;
    if (e.color) { const n = parseInt(e.color.replace("#",""), 16); if (!isNaN(n)) color = n; }
    const embed = new EmbedBuilder().setDescription(e.body).setColor(color);
    if (e.title) embed.setTitle(e.title);
    if (e.image) { try { new URL(e.image); embed.setImage(e.image); } catch (_) {} }
    await channel.send({ embeds: [embed] });
  } else {
    await channel.send({ content: msg.content });
  }

  await interaction.editReply({ content: `✅ **"${name}"** deployed to <#${channelId}>.` });
}