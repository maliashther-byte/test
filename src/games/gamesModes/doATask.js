// ── Gamemode 3: Do a Task (admin panel with Set Winner modal + hint) ───────────
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { setActiveGame, clearActiveGame, saveTranscript } from "../gamesStorage.js";
import { announceWinner, cleanGameMessages } from "../gamesHost.js";

export const META = { name: "Do a Task", emoji: "🎬", description: "Record yourself doing a task. Host sets winner via admin panel.", supportsHints: true };

export async function start(channel, guild, hostId, options, gameMsgIds) {
  const task  = options.task ?? "Do something creative and record it!";
  const hints = options.hints ?? [];
  const state = { task, hints, hintIndex: 0, submissions: [], open: true, started: new Date().toISOString(), messages: [], adminMsgId: null };

  await setActiveGame(guild.id, { gameMode: "doATask", hostId, channelId: channel.id, state, gameMsgIds });

  // Admin panel
  const adminRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`game_task_setwinner_${guild.id}`).setLabel("🏆 Set Winner (ID)").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`game_task_nowinner_${guild.id}`).setLabel("⏹ End (No Winner)").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`game_task_close_${guild.id}`).setLabel("🔒 Close Submissions").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`game_hint_${guild.id}`).setLabel("💡 Drop Hint").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`game_end_${guild.id}`).setLabel("⏹ End").setStyle(ButtonStyle.Danger)
  );
  const adminEmbed = new EmbedBuilder().setColor(0xfaa61a).setTitle("🛠 Host Panel — Do a Task")
    .setDescription(`**Task:** ${task}\n**Submissions:** 0\n**Status:** Open\n\nUse **Set Winner** to pick winner by user ID.`);
  const adminMsg = await channel.send({ embeds: [adminEmbed], components: [adminRow] });
  gameMsgIds.push(adminMsg.id);
  state.adminMsgId = adminMsg.id;

  const gameEmbed = new EmbedBuilder().setColor(0xed4245).setTitle("🎬 Do a Task!")
    .setDescription(`**Your task:**\n> ${task}\n\n**Upload a video** of yourself doing it as a file attachment.\n\n**Rules:**\n• Video must be a file (not a link)\n• One submission per person`)
    .setFooter({ text: "Upload your video below!" });
  const gameMsg = await channel.send({ embeds: [gameEmbed] });
  gameMsgIds.push(gameMsg.id);
  state.gameMsgId = gameMsg.id;

  await setActiveGame(guild.id, { gameMode: "doATask", hostId, channelId: channel.id, state, gameMsgIds });
}

// Button: game_task_setwinner_<guildId>
export async function handleSetWinner(interaction, game) {
  if (interaction.user.id !== game.hostId) return interaction.reply({ content: "❌ Host only.", ephemeral: true });

  const modal = new ModalBuilder().setCustomId(`game_task_winner_modal_${interaction.guild.id}`).setTitle("Set Winner");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("winner_id").setLabel("Paste the winner's Discord User ID").setStyle(TextInputStyle.Short).setMinLength(17).setMaxLength(20).setRequired(true)
    )
  );
  await interaction.showModal(modal);
}

// Modal: game_task_winner_modal_<guildId>
export async function handleSetWinnerModal(interaction, game) {
  await interaction.deferReply({ ephemeral: true });
  const winnerId = interaction.fields.getTextInputValue("winner_id").trim();

  const winner = await interaction.client.users.fetch(winnerId).catch(() => null);
  if (!winner) return interaction.editReply({ content: "❌ User not found. Check the ID." });

  await clearActiveGame(interaction.guild.id);
  await saveTranscript({
    guildId: interaction.guild.id, gameMode: "doATask", hostId: game.hostId,
    startedAt: game.state.started, endedAt: new Date().toISOString(),
    winner: winnerId, messages: game.state.messages,
    meta: { task: game.state.task, submissions: game.state.submissions.length }
  });

  await interaction.editReply({ content: `✅ Winner set to <@${winnerId}>!` });
  await announceWinner(interaction.channel, winner, "Do a Task", interaction.guild);
  await cleanGameMessages(interaction.channel, game.gameMsgIds);
}

// Button: game_task_close_<guildId>
export async function handleCloseSubmissions(interaction, game) {
  if (interaction.user.id !== game.hostId) return interaction.reply({ content: "❌ Host only.", ephemeral: true });
  game.state.open = false;
  await setActiveGame(interaction.guild.id, game);
  await interaction.reply({ content: "🔒 Submissions closed.", ephemeral: true });

  // Update admin panel
  try {
    const adminMsg = await interaction.channel.messages.fetch(game.state.adminMsgId);
    await adminMsg.edit({ embeds: [EmbedBuilder.from(adminMsg.embeds[0]).setDescription(`**Task:** ${game.state.task}\n**Submissions:** ${game.state.submissions.length}\n**Status:** 🔒 Closed`)] });
  } catch (_) {}
}

// Drop hint (called by game_hint_ button or /hint)
export async function dropHint(channel, guildId, game) {
  const idx = game.state.hintIndex ?? 0;
  const hints = game.state.hints ?? [];
  if (idx >= hints.length || !hints.length) {
    // No preset hints — just remind of the task
    const m = await channel.send({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle("💡 Task Reminder").setDescription(`**Your task:** ${game.state.task}`)] });
    game.gameMsgIds.push(m.id);
    await setActiveGame(guildId, game);
    return true;
  }
  const m = await channel.send({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle(`💡 Hint ${idx + 1}`).setDescription(hints[idx])] });
  game.gameMsgIds.push(m.id);
  game.state.hintIndex = idx + 1;
  await setActiveGame(guildId, game);
  return true;
}

export async function onMessage(message, game, client) {
  const { state } = game;
  if (!state.open) { await message.delete().catch(() => {}); return; }

  const videoAttachment = [...message.attachments.values()].find(a =>
    a.contentType?.startsWith("video/") || a.name?.match(/\.(mp4|mov|webm|avi|mkv)$/i)
  );

  if (!videoAttachment) { await message.delete().catch(() => {}); const w = await message.channel.send({ content: `<@${message.author.id}> ❌ Upload a **video file**.` }); setTimeout(() => w.delete().catch(() => {}), 5000); return; }
  if (state.submissions.find(s => s.userId === message.author.id)) { await message.delete().catch(() => {}); const w = await message.channel.send({ content: `<@${message.author.id}> ❌ Already submitted!` }); setTimeout(() => w.delete().catch(() => {}), 4000); return; }

  state.submissions.push({ userId: message.author.id, videoUrl: videoAttachment.url, msgId: message.id, submittedAt: new Date().toISOString() });
  state.messages.push({ userId: message.author.id, content: `[Video]`, ts: new Date().toISOString() });
  game.gameMsgIds.push(message.id);

  try {
    const adminMsg = await message.channel.messages.fetch(state.adminMsgId);
    await adminMsg.edit({ embeds: [EmbedBuilder.from(adminMsg.embeds[0]).setDescription(`**Task:** ${state.task}\n**Submissions:** ${state.submissions.length}\n**Status:** Open`)] });
  } catch (_) {}

  await setActiveGame(message.guild.id, game);
  const c = await message.channel.send({ content: `✅ <@${message.author.id}> submission #${state.submissions.length} received!` });
  setTimeout(() => c.delete().catch(() => {}), 5000);
}