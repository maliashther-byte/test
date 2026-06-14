// ── Gamemode 7: Emoji Chain ───────────────────────────────────────────────────
// Bot starts a chain with an emoji. Each player must send ONE emoji that is
// thematically related to the last one. After 60s the player with most valid
// links wins. Anti-cheat: single emoji only, no repeats, 5s cooldown.

import { EmbedBuilder } from "discord.js";
import { setActiveGame, clearActiveGame, saveTranscript } from "../gamesStorage.js";
import { announceWinner, cleanGameMessages } from "../gamesHost.js";

export const META = { name: "Emoji Chain", emoji: "🔗", description: "Keep the emoji chain going! Add ONE emoji. Most valid links in 60s wins." };

const STARTERS = ["🌊","🔥","⚡","🌙","🎵","🌺","🏔️","🐉","💎","🚀"];
const EMOJI_REGEX = /^\p{Emoji_Presentation}$/u;

const userCooldowns = new Map();

export async function start(channel, guild, hostId, options, gameMsgIds) {
  userCooldowns.clear();
  const starter = STARTERS[Math.floor(Math.random() * STARTERS.length)];
  const state   = {
    chain: [starter], lastEmoji: starter, usedEmojis: new Set([starter]),
    scores: {}, started: new Date().toISOString(), messages: [], endsAt: Date.now() + 60000
  };

  await setActiveGame(guild.id, { gameMode: "emojiChain", hostId, channelId: channel.id, state: { ...state, usedEmojis: [starter] }, gameMsgIds });

  const embed = new EmbedBuilder()
    .setColor(0xf0a500)
    .setTitle("🔗 Emoji Chain!")
    .setDescription(
      `Keep the chain going! Add ONE emoji after the last one.\n\n` +
      `**Starting emoji:** ${starter}\n\n` +
      `**Rules:**\n• Send exactly ONE emoji per message\n• No repeating emojis\n• 5 second cooldown per person\n• Game ends in **60 seconds**\n• Most valid links wins!`
    )
    .setFooter({ text: `Chain starts with: ${starter}` });

  const m = await channel.send({ embeds: [embed] });
  gameMsgIds.push(m.id);
  await setActiveGame(guild.id, { gameMode: "emojiChain", hostId, channelId: channel.id, state: { ...state, usedEmojis: [starter] }, gameMsgIds });

  // End game after 60s
  setTimeout(() => endEmojiChain(channel, guild.id), 60000);
}

export async function onMessage(message, game, client) {
  const { state } = game;
  const content   = message.content.trim();

  // Must be a single emoji
  const isEmoji = content.length <= 8 && (EMOJI_REGEX.test(content) || /^<a?:[a-zA-Z0-9_]+:[0-9]+>$/.test(content));
  if (!isEmoji) { await message.delete().catch(() => {}); return; }

  // Cooldown
  const last = userCooldowns.get(message.author.id) ?? 0;
  if (Date.now() - last < 5000) { await message.delete().catch(() => {}); return; }
  userCooldowns.set(message.author.id, Date.now());

  // Check if already used
  const used = state.usedEmojis ?? [];
  if (used.includes(content)) {
    await message.delete().catch(() => {});
    const w = await message.channel.send({ content: `<@${message.author.id}> ❌ That emoji was already used!` });
    setTimeout(() => w.delete().catch(() => {}), 3000);
    return;
  }

  // Valid addition
  state.usedEmojis = [...used, content];
  state.chain      = [...(state.chain ?? []), content];
  state.lastEmoji  = content;
  state.scores[message.author.id] = (state.scores[message.author.id] ?? 0) + 1;
  state.messages.push({ userId: message.author.id, content, ts: new Date().toISOString() });
  game.gameMsgIds.push(message.id);

  await setActiveGame(message.guild.id, game);
}

async function endEmojiChain(channel, guildId) {
  const { getActiveGame, clearActiveGame: cag, saveTranscript: st } = await import("../gamesStorage.js");
  const game = await getActiveGame(guildId);
  if (!game || game.gameMode !== "emojiChain") return;

  const { state } = game;
  let topScore = 0, winner = null;
  for (const [uid, score] of Object.entries(state.scores ?? {})) {
    if (score > topScore) { topScore = score; winner = uid; }
  }

  await cag(guildId);
  await st({
    guildId, gameMode: "emojiChain", hostId: game.hostId,
    startedAt: state.started, endedAt: new Date().toISOString(),
    winner, messages: state.messages,
    meta: { chain: state.chain, scores: state.scores }
  });

  const guild      = await channel.client.guilds.fetch(guildId).catch(() => null);
  const winnerUser = winner ? await channel.client.users.fetch(winner).catch(() => null) : null;

  if (winnerUser) {
    await announceWinner(channel, winnerUser, "Emoji Chain", guild, `Added **${topScore}** emoji${topScore !== 1 ? "s" : ""} to the chain!`);
  } else {
    const m = await channel.send({ embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle("🔗 Emoji Chain Over!").setDescription("No one added any emojis!")] });
    game.gameMsgIds.push(m.id);
  }
  await cleanGameMessages(channel, game.gameMsgIds);
}