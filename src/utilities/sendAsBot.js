import fs from "fs";
import {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ChannelType
} from "discord.js";

const config = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));

// ─── /say ────────────────────────────────────────────────────────────────────
export const sayData = new SlashCommandBuilder()
  .setName("say")
  .setDescription("Send a message as the bot.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addStringOption(o => o.setName("message").setDescription("The message to send").setRequired(true).setMaxLength(2000))
  .addChannelOption(o => o.setName("channel").setDescription("Channel to send to (default: current)").addChannelTypes(ChannelType.GuildText).setRequired(false))
  .addBooleanOption(o => o.setName("reply_delete").setDescription("Delete your command message? (default: yes)").setRequired(false));

export async function executeSay(interaction) {
  const text    = interaction.options.getString("message");
  const channel = interaction.options.getChannel("channel") ?? interaction.channel;
  const del     = interaction.options.getBoolean("reply_delete") ?? true;

  await channel.send({ content: text });
  await interaction.reply({ content: `✅ Message sent in ${channel}.`, ephemeral: true });
}

// ─── /sayembed ───────────────────────────────────────────────────────────────
export const sayEmbedData = new SlashCommandBuilder()
  .setName("sayembed")
  .setDescription("Send an embed as the bot.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addChannelOption(o => o.setName("channel").setDescription("Channel to send to (default: current)").addChannelTypes(ChannelType.GuildText).setRequired(false));

export async function executeSayEmbed(interaction) {
  const channel = interaction.options.getChannel("channel") ?? interaction.channel;

  const modal = new ModalBuilder()
    .setCustomId(`sayembed_modal_${channel.id}`)
    .setTitle("Create Embed Message");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("embed_title").setLabel("Title (optional)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("embed_body").setLabel("Body / Description").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("embed_color").setLabel("Color (hex, e.g. #ff0000) — optional").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("embed_image").setLabel("Image URL (optional)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("embed_footer").setLabel("Footer text (optional)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)
    )
  );

  await interaction.showModal(modal);
}

// ─── Modal: sayembed_modal_<channelId> ───────────────────────────────────────
export async function handleSayEmbedModal(interaction) {
  const channelId = interaction.customId.replace("sayembed_modal_", "");
  await interaction.deferReply({ ephemeral: true });

  const title  = interaction.fields.getTextInputValue("embed_title").trim();
  const body   = interaction.fields.getTextInputValue("embed_body").trim();
  const color  = interaction.fields.getTextInputValue("embed_color").trim();
  const image  = interaction.fields.getTextInputValue("embed_image").trim();
  const footer = interaction.fields.getTextInputValue("embed_footer").trim();

  // Parse color
  let parsedColor = config.embedColor ?? 0x5865f2;
  if (color) {
    const n = parseInt(color.replace("#", ""), 16);
    if (!isNaN(n)) parsedColor = n;
  }

  const embed = new EmbedBuilder()
    .setDescription(body)
    .setColor(parsedColor);

  if (title)  embed.setTitle(title);
  if (image)  {
    try { new URL(image); embed.setImage(image); } catch (_) {}
  }
  if (footer) embed.setFooter({ text: footer });

  // Preview first
  await interaction.editReply({
    content: "**Preview:**",
    embeds: [embed],
  });

  // Send to channel after confirmation
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return interaction.followUp({ content: "❌ Channel not found.", ephemeral: true });

  await channel.send({ embeds: [embed] });
  await interaction.followUp({ content: `✅ Embed sent in ${channel}.`, ephemeral: true });
}

// ─── /edit ────────────────────────────────────────────────────────────────────
// Edit a previously bot-sent message
export const editData = new SlashCommandBuilder()
  .setName("editmsg")
  .setDescription("Edit a message previously sent by the bot.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addStringOption(o => o.setName("message_id").setDescription("ID of the bot message to edit").setRequired(true))
  .addStringOption(o => o.setName("new_content").setDescription("New message content").setRequired(true).setMaxLength(2000))
  .addChannelOption(o => o.setName("channel").setDescription("Channel the message is in (default: current)").addChannelTypes(ChannelType.GuildText).setRequired(false));

export async function executeEdit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const msgId   = interaction.options.getString("message_id");
  const content = interaction.options.getString("new_content");
  const channel = interaction.options.getChannel("channel") ?? interaction.channel;

  const msg = await channel.messages.fetch(msgId).catch(() => null);
  if (!msg) return interaction.editReply({ content: "❌ Message not found." });
  if (msg.author.id !== interaction.client.user.id) return interaction.editReply({ content: "❌ I can only edit my own messages." });

  await msg.edit({ content }).catch(e => { console.error(e); });
  await interaction.editReply({ content: "✅ Message edited." });
}