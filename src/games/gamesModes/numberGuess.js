// ── Gamemode 4: Number Guess ──────────────────────────────────────────────────
// Host sets a range. Players guess. Bot says higher/lower. Closest guess gets a hint.

import { EmbedBuilder } from "discord.js";
import { setActiveGame, clearActiveGame, saveTranscript } from "../gamesStorage.js";
import { announceWinner, cleanGameMessages } from "../gamesHost.js";

export const META = { name: "Number Guess", emoji: "🔮", description: "Guess the secret number. The bot tells you higher or lower." };

const userCooldowns = new Map();

export async function start(channel, guild, hostId, options, gameMsgIds) {
  const min    = options.min ?? 1;
  const max    = options.max ?? 100;
  const secret = Math.floor(Math.random() * (max - min + 1)) + min;
  const state  = { secret, min, max, guesses: [], closestUserId: null, closestDiff: Infinity, started: new Date().toISOString(), messages: [] };

  await setActiveGame(guild.id, { gameMode: "numberGuess", hostId, channelId: channel.id, state, gameMsgIds });

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("🔮 Number Guess!")
    .setDescription(
      `I'm thinking of a number between **${min}** and **${max}**.\n\n` +
      "Type your guess! I'll tell you if it's higher or lower.\n\n" +
      "**Rules:**\n• 2 second cooldown between guesses\n• Closest guess at any time wins if the host ends the game early\n• First exact guess wins!"
    )
    .setFooter({ text: `Range: ${min}–${max}` });

  const m = await channel.send({ embeds: [embed] });
  gameMsgIds.push(m.id);
  await setActiveGame(guild.id, { gameMode: "numberGuess", hostId, channelId: channel.id, state, gameMsgIds });
}

export async function onMessage(message, game, client) {
  const { state } = game;
  const val = parseInt(message.content.trim(), 10);

  state.messages.push({ userId: message.author.id, content: message.content, ts: new Date().toISOString() });

  if (isNaN(val) || val < state.min || val > state.max) {
    await message.delete().catch(() => {});
    return;
  }

  // Cooldown (2s)
  const last = userCooldowns.get(message.author.id) ?? 0;
  if (Date.now() - last < 2000) { await message.delete().catch(() => {}); return; }
  userCooldowns.set(message.author.id, Date.now());

  game.gameMsgIds.push(message.id);
  state.guesses.push({ userId: message.author.id, guess: val, ts: new Date().toISOString() });

  const diff = Math.abs(val - state.secret);
  if (diff < state.closestDiff) {
    state.closestDiff   = diff;
    state.closestUserId = message.author.id;
  }

  await setActiveGame(message.guild.id, game);

  if (val === state.secret) {
    userCooldowns.clear();
    await clearActiveGame(message.guild.id);
    await saveTranscript({
      guildId: message.guild.id, gameMode: "numberGuess", hostId: game.hostId,
      startedAt: state.started, endedAt: new Date().toISOString(),
      winner: message.author.id, messages: state.messages,
      meta: { secret: state.secret, min: state.min, max: state.max }
    });
    await announceWinner(message.channel, message.author, "Number Guess", message.guild, `The number was **${state.secret}**!`);
    await cleanGameMessages(message.channel, game.gameMsgIds);
    return;
  }

  const hint = val < state.secret ? "📈 **Higher!**" : "📉 **Lower!**";
  const closestLine = state.closestUserId ? `\n🎯 Closest so far: <@${state.closestUserId}> (${state.closestDiff} away)` : "";
  const resp = await message.channel.send({ content: `${hint}${closestLine}` });
  game.gameMsgIds.push(resp.id);
  await setActiveGame(message.guild.id, game);
}