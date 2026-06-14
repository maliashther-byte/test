// ── Gamemode 2: Word Guess ────────────────────────────────────────────────────
// Bot picks a secret word. Hints get more specific every 30s.
// Anti-cheat: 3s cooldown per user, guesses deleted, no showing others' guesses.

import { EmbedBuilder } from "discord.js";
import { setActiveGame, clearActiveGame, saveTranscript } from "../gamesStorage.js";
import { announceWinner, cleanGameMessages } from "../gamesHost.js";

export const META = { name: "Word Guess", emoji: "💬", description: "Guess the secret word from hints. Hints get more specific every 30s." };

const WORD_BANK = [
  { word: "elephant",  hints: ["It's an animal", "It's the largest land animal", "It has a long trunk", "It's grey and lives in Africa or Asia"] },
  { word: "volcano",   hints: ["It's a natural feature", "It's found on Earth and other planets", "It can be dormant or active", "It erupts with lava and ash"] },
  { word: "piano",     hints: ["It's an object", "It's used for entertainment", "It has 88 keys", "You press keys to make music with it"] },
  { word: "submarine", hints: ["It's a vehicle", "It travels through something", "It operates underwater", "It's a military or research vessel that dives beneath the sea"] },
  { word: "compass",   hints: ["It's a tool", "People use it when travelling", "It always points the same direction", "It uses Earth's magnetic field to show North"] },
  { word: "cactus",    hints: ["It's a living thing", "It grows in a dry environment", "It stores water inside it", "It has sharp spines and rarely needs watering"] },
  { word: "telescope", hints: ["It's a device", "Scientists and hobbyists use it", "It makes far away things look closer", "You point it at the night sky to see stars and planets"] },
  { word: "avalanche", hints: ["It's an event", "It happens in cold mountainous areas", "It moves very fast and is dangerous", "A mass of snow suddenly slides down a mountain slope"] },
  { word: "lightning",  hints: ["It's a natural phenomenon", "It happens during storms", "It produces a bright flash", "It's an electrical discharge between clouds and the ground"] },
  { word: "hourglass", hints: ["It's an object", "It measures something", "It contains sand", "Sand falls from one glass chamber to another to track time"] },
];

// Per-user guess cooldowns (in-memory, reset per game)
const cooldowns = new Map();

export async function start(channel, guild, hostId, options, gameMsgIds) {
  cooldowns.clear();
  const entry = WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
  const state = {
    word: entry.word, hints: entry.hints, hintIndex: 0,
    messages: [], started: new Date().toISOString(), guessers: []
  };

  await setActiveGame(guild.id, { gameMode: "wordGuess", hostId, channelId: channel.id, state, gameMsgIds });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("💬 Word Guess!")
    .setDescription(`Guess the secret word!\n\n**Hint 1:** ${entry.hints[0]}\n\nType your guess below. New hints every **30 seconds**.\n\n**Rules:**\n• 3 second cooldown between guesses\n• Guesses are deleted to keep it fair`)
    .setFooter({ text: "Good luck!" });

  const m = await channel.send({ embeds: [embed] });
  gameMsgIds.push(m.id);

  // Schedule hints every 30s
  const hintInterval = setInterval(async () => {
    const game = (await import("../gamesStorage.js")).getActiveGame ? null : null;
    // We'll handle via the hint timer stored in state
  }, 30000);

  // Store interval ref — we use a timeout chain instead for reliability
  scheduleNextHint(channel, guild.id, state, gameMsgIds, 1);

  await setActiveGame(guild.id, { gameMode: "wordGuess", hostId, channelId: channel.id, state, gameMsgIds });
}

async function scheduleNextHint(channel, guildId, state, gameMsgIds, nextIndex) {
  if (nextIndex >= state.hints.length) return;
  setTimeout(async () => {
    const { getActiveGame, setActiveGame } = await import("../gamesStorage.js");
    const game = await getActiveGame(guildId);
    if (!game || game.gameMode !== "wordGuess") return; // game ended

    const embed = new EmbedBuilder()
      .setColor(0xfaa61a)
      .setTitle(`💡 Hint ${nextIndex + 1}`)
      .setDescription(game.state.hints[nextIndex])
      .setFooter({ text: `${state.hints.length - nextIndex - 1} more hints remaining` });

    const m = await channel.send({ embeds: [embed] }).catch(() => null);
    if (m) { game.gameMsgIds.push(m.id); await setActiveGame(guildId, game); }

    scheduleNextHint(channel, guildId, game.state, game.gameMsgIds, nextIndex + 1);
  }, 30000);
}

export async function onMessage(message, game, client) {
  const { state } = game;
  const guess = message.content.trim().toLowerCase();

  // Cooldown check (3s per user)
  const lastGuess = cooldowns.get(message.author.id) ?? 0;
  if (Date.now() - lastGuess < 3000) {
    await message.delete().catch(() => {});
    return;
  }
  cooldowns.set(message.author.id, Date.now());

  state.messages.push({ userId: message.author.id, content: message.content, ts: new Date().toISOString() });

  // Delete guess to keep it hidden from others
  await message.delete().catch(() => {});

  if (guess === state.word.toLowerCase()) {
    await clearActiveGame(message.guild.id);
    cooldowns.clear();
    await saveTranscript({
      guildId: message.guild.id, gameMode: "wordGuess", hostId: game.hostId,
      startedAt: state.started, endedAt: new Date().toISOString(),
      winner: message.author.id, messages: state.messages,
      meta: { word: state.word }
    });
    await announceWinner(message.channel, message.author, "Word Guess", message.guild, `The word was **${state.word}**!`);
    await cleanGameMessages(message.channel, game.gameMsgIds);
  } else {
    // Ephemeral-style wrong guess — DM the user (can't do ephemeral on messageCreate)
    const dm = await message.channel.send({ content: `<@${message.author.id}> ❌ That's not it! Keep trying.` });
    setTimeout(() => dm.delete().catch(() => {}), 3000);
  }
}