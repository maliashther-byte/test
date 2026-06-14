// ── Gamemode 1: Counting (1–100) ──────────────────────────────────────────────
// First person to say 1, then 2, then 3... up to 100 wins.
// Anti-cheat: one count per user in a row, delete wrong messages, rate limit.

import { EmbedBuilder } from "discord.js";
import { setActiveGame, clearActiveGame, saveTranscript } from "../gamesStorage.js";
import { announceWinner, cleanGameMessages } from "../gamesHost.js";

export const META = { name: "Counting (1–100)", emoji: "🔢", description: "First to count from 1 to 100 wins. You cannot count twice in a row." };

export async function start(channel, guild, hostId, options, gameMsgIds) {
  const state = { current: 0, lastUserId: null, messages: [], started: new Date().toISOString() };
  await setActiveGame(guild.id, { gameMode: "counting", hostId, channelId: channel.id, state, gameMsgIds });

  const embed = new EmbedBuilder()
    .setColor(0xf0a500)
    .setTitle("🔢 Counting Game!")
    .setDescription("Count from **1 to 100** to win!\n\n**Rules:**\n• Type the next number\n• You cannot count twice in a row\n• Wrong numbers are deleted\n• First to reach **100** wins!")
    .setFooter({ text: "Type 1 to start!" });

  const m = await channel.send({ embeds: [embed] });
  gameMsgIds.push(m.id);
  await setActiveGame(guild.id, { gameMode: "counting", hostId, channelId: channel.id, state, gameMsgIds });
}

// Called from messageCreate
export async function onMessage(message, game, client) {
  const { state } = game;
  const val = parseInt(message.content.trim(), 10);
  const expected = state.current + 1;

  // Track for transcript
  state.messages.push({ userId: message.author.id, content: message.content, ts: new Date().toISOString() });

  // Wrong number or not a number
  if (isNaN(val) || val !== expected) {
    await message.delete().catch(() => {});
    return;
  }

  // Same user counted twice in a row
  if (message.author.id === state.lastUserId) {
    await message.delete().catch(() => {});
    const warn = await message.channel.send({ content: `<@${message.author.id}> ❌ You can't count twice in a row!` });
    setTimeout(() => warn.delete().catch(() => {}), 4000);
    return;
  }

  state.current    = val;
  state.lastUserId = message.author.id;
  game.gameMsgIds.push(message.id);
  await setActiveGame(message.guild.id, game);

  // Progress milestones
  if ([25, 50, 75].includes(val)) {
    const m = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(`✅ **${val}/100** — Keep going!`)] });
    game.gameMsgIds.push(m.id);
  }

  // Win condition
  if (val === 100) {
    await clearActiveGame(message.guild.id);
    await saveTranscript({
      guildId: message.guild.id, gameMode: "counting", hostId: game.hostId,
      startedAt: state.started, endedAt: new Date().toISOString(),
      winner: message.author.id, messages: state.messages
    });
    await announceWinner(message.channel, message.author, "Counting (1–100)", message.guild);
    await cleanGameMessages(message.channel, game.gameMsgIds);
  }
}