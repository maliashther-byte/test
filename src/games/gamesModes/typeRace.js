// ── Gamemode 6: Type Race ─────────────────────────────────────────────────────
// Bot shows a sentence. First to type it exactly wins.
// Anti-cheat: minimum typing time (too fast = bot), must be exact match.

import { EmbedBuilder } from "discord.js";
import { setActiveGame, clearActiveGame, saveTranscript } from "../gamesStorage.js";
import { announceWinner, cleanGameMessages } from "../gamesHost.js";

export const META = { name: "Type Race", emoji: "⌨️", description: "Type the sentence exactly as shown. Fastest correct typer wins!" };

const SENTENCES = [
  "The quick brown fox jumps over the lazy dog",
  "Pack my box with five dozen liquor jugs",
  "How vexingly quick daft zebras jump",
  "The five boxing wizards jump quickly",
  "Sphinx of black quartz judge my vow",
  "Crazy Fredrick bought many very exquisite opal jewels",
  "We promptly judged antique ivory buckles for the next prize",
  "A wizard's job is to vex chumps quickly in fog",
  "Six big juicy steaks sizzled in a pan as five workmen left the quarry",
  "Few quips galvanized the mock jury box",
];

// Minimum ms to type (anti-bot): assume min 1 char/100ms
function minTypingTime(sentence) { return sentence.length * 80; }

export async function start(channel, guild, hostId, options, gameMsgIds) {
  const sentence = SENTENCES[Math.floor(Math.random() * SENTENCES.length)];
  const state    = { sentence, startedAt: Date.now(), messages: [], started: new Date().toISOString() };

  await setActiveGame(guild.id, { gameMode: "typeRace", hostId, channelId: channel.id, state, gameMsgIds });

  // Build a "hidden" preview first, then reveal after 3s
  const readyEmbed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle("⌨️ Type Race — Get Ready!")
    .setDescription("**The sentence will appear in 3 seconds...**\n\nDO NOT type yet!")
    .setFooter({ text: "Hands off the keyboard!" });

  const readyMsg = await channel.send({ embeds: [readyEmbed] });
  gameMsgIds.push(readyMsg.id);

  setTimeout(async () => {
    const { getActiveGame, setActiveGame: sag } = await import("../gamesStorage.js");
    const game = await getActiveGame(guild.id);
    if (!game) return;

    const revealEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("⌨️ TYPE THIS NOW!")
      .setDescription(`\`\`\`${sentence}\`\`\``)
      .setFooter({ text: "Type it exactly as shown — capitalisation, spacing, everything!" });

    game.state.revealedAt = Date.now();
    await sag(guild.id, game);

    const revealMsg = await channel.send({ embeds: [revealEmbed] });
    game.gameMsgIds.push(revealMsg.id);
    await sag(guild.id, game);
  }, 3000);
}

export async function onMessage(message, game, client) {
  const { state } = game;
  if (!state.revealedAt) { await message.delete().catch(() => {}); return; }

  state.messages.push({ userId: message.author.id, content: message.content, ts: new Date().toISOString() });

  const timeTaken = Date.now() - state.revealedAt;
  const minTime   = minTypingTime(state.sentence);

  // Exact match check
  if (message.content.trim() !== state.sentence) {
    await message.delete().catch(() => {});
    return;
  }

  // Too fast — likely copy-pasted or bot
  if (timeTaken < minTime) {
    await message.delete().catch(() => {});
    const warn = await message.channel.send({ content: `<@${message.author.id}> ⚡ Too fast! That looks automated — disqualified.` });
    setTimeout(() => warn.delete().catch(() => {}), 5000);
    return;
  }

  // Winner!
  game.gameMsgIds.push(message.id);
  await clearActiveGame(message.guild.id);
  await saveTranscript({
    guildId: message.guild.id, gameMode: "typeRace", hostId: game.hostId,
    startedAt: state.started, endedAt: new Date().toISOString(),
    winner: message.author.id, messages: state.messages,
    meta: { sentence: state.sentence, timeTaken }
  });

  await announceWinner(message.channel, message.author, "Type Race", message.guild, `Finished in **${(timeTaken / 1000).toFixed(2)}s**!`);
  await cleanGameMessages(message.channel, game.gameMsgIds);
}