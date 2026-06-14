// ── Trivia Battle Royale (AI, HP elimination, configurable questions) ──────────
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { setActiveGame, clearActiveGame, saveTranscript } from "../gamesStorage.js";
import { announceWinner, cleanGameMessages, repostAdminPanel } from "../gamesHost.js";
import { generateTriviaQuestion } from "../../utils/aiHelper.js";
import { lockGamesChannel } from "../gamesSetup.js";

export const META = { name: "Trivia Battle Royale", emoji: "🧠", description: "AI questions. Wrong answer = eliminated. Last standing wins.", supportsHints: false };

export async function start(channel, guild, hostId, options, gameMsgIds) {
  const maxPlayers    = options.maxPlayers    ?? 10;
  const difficulty    = options.difficulty    ?? "medium";
  const timeLimitSecs = options.timeLimit     ?? 20;
  const questionCount = options.questionCount ?? 5; // max questions, game can end sooner by elimination

  const state = {
    phase: "joining", players: {},
    maxPlayers, difficulty, timeLimitSecs, questionCount,
    category: options.category ?? null,
    currentPlayerId: null, currentQuestion: null, currentMsgId: null,
    adminMsgId: null, joinMsgId: null,
    started: new Date().toISOString(), messages: [], roundNum: 0,
    prize: options.prize ?? null
  };

  await setActiveGame(guild.id, { gameMode: "trivia", hostId, channelId: channel.id, state, gameMsgIds });

  // Admin panel embed
  const adminRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`game_trivia_start_${guild.id}`).setLabel("▶️ Start Game").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`game_end_${guild.id}`).setLabel("⏹ End Game").setStyle(ButtonStyle.Danger)
  );
  const adminEmbed = new EmbedBuilder().setColor(0xfaa61a)
    .setTitle("🛠 Host Panel — Trivia Battle Royale")
    .setDescription(
      `**Max players:** ${maxPlayers}\n**Difficulty:** ${difficulty}\n` +
      `**Time per question:** ${timeLimitSecs}s\n**Max questions:** ${questionCount}\n` +
      `**Prize:** ${state.prize ?? "Just for fun"}\n\n` +
      "Wrong answer = **instant elimination**.\nLast player standing wins.\nIf multiple survive all questions, they all win!"
    );
  const adminMsg = await channel.send({ embeds: [adminEmbed], components: [adminRow] });
  gameMsgIds.push(adminMsg.id);
  state.adminMsgId = adminMsg.id;

  // Join embed
  const joinEmbed = new EmbedBuilder().setColor(0x5865f2).setTitle("🧠 Trivia Battle Royale — Join Now!")
    .setDescription(
      `**${maxPlayers} players max** · **${difficulty}** difficulty · **${timeLimitSecs}s** per question · **${questionCount}** questions max\n\n` +
      (state.prize ? `🎁 **Prize:** ${state.prize}\n\n` : "🎮 Just for fun!\n\n") +
      "Press **Join** to enter!\n\n**How it works:**\n" +
      "• Bot picks one player at a time\n• Type A, B, C, or D to answer\n" +
      "• **Wrong answer = instant elimination** ❌\n• Last one standing wins!"
    ).setFooter({ text: "Players joined: 0" });
  const joinRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`game_trivia_join_${guild.id}`).setLabel("✋ Join Game").setStyle(ButtonStyle.Primary)
  );
  const joinMsg = await channel.send({ embeds: [joinEmbed], components: [joinRow] });
  gameMsgIds.push(joinMsg.id);
  state.joinMsgId = joinMsg.id;

  await setActiveGame(guild.id, { gameMode: "trivia", hostId, channelId: channel.id, state, gameMsgIds });
}

export async function handleJoin(interaction, game) {
  const userId = interaction.user.id;
  if (game.state.phase !== "joining") return interaction.reply({ content: "❌ Game already started.", ephemeral: true });
  if (game.state.players[userId])     return interaction.reply({ content: "✅ Already joined!", ephemeral: true });
  if (Object.keys(game.state.players).length >= game.state.maxPlayers) return interaction.reply({ content: "❌ Game is full.", ephemeral: true });

  game.state.players[userId] = { hp: 100, alive: true, tag: interaction.user.tag, correct: 0 };
  await setActiveGame(interaction.guild.id, game);

  // Update join message
  try {
    const jm    = await interaction.channel.messages.fetch(game.state.joinMsgId);
    const count = Object.keys(game.state.players).length;
    const list  = Object.values(game.state.players).map(p => `• ${p.tag}`).join("\n");
    const newDesc = jm.embeds[0].description.split("\n\n**Players:**")[0] + `\n\n**Players:**\n${list}`;
    await jm.edit({ embeds: [EmbedBuilder.from(jm.embeds[0]).setDescription(newDesc).setFooter({ text: `Players joined: ${count}/${game.state.maxPlayers}` })] });
  } catch (_) {}

  await interaction.reply({ content: "✅ You joined Trivia Battle Royale!", ephemeral: true });
}

export async function handleStartRound(interaction, game) {
  if (interaction.user.id !== game.hostId && !interaction.member.permissions.has("Administrator")) {
    return interaction.reply({ content: "❌ Host only.", ephemeral: true });
  }
  if (Object.keys(game.state.players).length < 2) return interaction.reply({ content: "❌ Need at least 2 players.", ephemeral: true });
  if (game.state.phase !== "joining") return interaction.reply({ content: "❌ Already started.", ephemeral: true });

  game.state.phase = "playing";
  await setActiveGame(interaction.guild.id, game);
  await interaction.update({
    embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setDescription("🎮 Game in progress...")],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`game_end_${interaction.guild.id}`).setLabel("⏹ End Game").setStyle(ButtonStyle.Danger))]
  });

  await runNextRound(interaction.channel, interaction.guild.id);
}

async function runNextRound(channel, guildId) {
  const { getActiveGame, setActiveGame: sag } = await import("../gamesStorage.js");
  const game = await getActiveGame(guildId);
  if (!game || game.gameMode !== "trivia") return;

  const alive = Object.entries(game.state.players).filter(([, p]) => p.alive);

  // End conditions
  if (alive.length === 0) { return endGame(channel, guildId, game, []); }
  if (alive.length === 1) { return endGame(channel, guildId, game, [alive[0][0]]); }
  if (game.state.roundNum >= game.state.questionCount) {
    // All questions done — all survivors win
    return endGame(channel, guildId, game, alive.map(([uid]) => uid));
  }

  game.state.roundNum++;
  const [pickedId, pickedData] = alive[Math.floor(Math.random() * alive.length)];

  // AI question (prefer category when available)
  let q;
  try {
    q = await generateTriviaQuestion(game.state.difficulty, game.state.category ?? null);
    if (!q) throw new Error('No question');
  } catch (err) {
    const e = await channel.send({ content: "⚠️ Trivia source error, trying again..." });
    game.gameMsgIds.push(e.id);
    return setTimeout(() => runNextRound(channel, guildId), 3000);
  }

  game.state.currentPlayerId = pickedId;
  game.state.currentQuestion = q;

  const hpBoard = Object.entries(game.state.players)
    .map(([uid, p]) => `${p.alive ? "❤️" : "💀"} <@${uid}> — ${p.alive ? "Alive" : "Eliminated"}`).join("\n");

  const embed = new EmbedBuilder().setColor(0x5865f2)
    .setTitle(`🧠 Question ${game.state.roundNum}/${game.state.questionCount} — <@${pickedId}>'s Turn`)
    .setDescription(
      `**${q.question}**\n\n` +
      q.options.map((o, i) => `${["A","B","C","D"][i]}) ${o}`).join("\n") +
      `\n\n⏱ **${game.state.timeLimitSecs} seconds!** Type A, B, C, or D.\n⚠️ Wrong = **eliminated instantly!**`
    )
    .addFields({ name: "❤️ Status Board", value: hpBoard });

  const qMsg = await channel.send({ content: `<@${pickedId}> — your turn!`, embeds: [embed] });
  game.gameMsgIds.push(qMsg.id);
  game.state.currentMsgId = qMsg.id;
  game.state.questionStartedAt = Date.now();
  await sag(guildId, game);

  // Timeout
  setTimeout(async () => {
    const fresh = await getActiveGame(guildId);
    if (!fresh || fresh.state.currentMsgId !== qMsg.id) return;
    // No answer — eliminate
    await eliminate(channel, guildId, pickedId, `⏰ <@${pickedId}> didn't answer in time — **eliminated!**`);
  }, game.state.timeLimitSecs * 1000);
}

async function eliminate(channel, guildId, userId, reason) {
  const { getActiveGame, setActiveGame: sag } = await import("../gamesStorage.js");
  const game = await getActiveGame(guildId);
  if (!game || game.gameMode !== "trivia") return;

  const player = game.state.players[userId];
  if (!player?.alive) return;

  player.alive = false;
  player.hp    = 0;
  const m = await channel.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setDescription(`💀 ${reason}`)] });
  game.gameMsgIds.push(m.id);

  game.state.currentPlayerId = null;
  game.state.currentMsgId    = null;
  game.state.currentQuestion = null;
  await sag(guildId, game);

  await new Promise(r => setTimeout(r, 2000));
  await runNextRound(channel, guildId);
}

async function endGame(channel, guildId, game, winnerIds) {
  await clearActiveGame(guildId);
  await saveTranscript({
    guildId, gameMode: "trivia", hostId: game.hostId,
    startedAt: game.state.started, endedAt: new Date().toISOString(),
    winner: winnerIds[0] ?? null, messages: game.state.messages,
    meta: { players: game.state.players, questionCount: game.state.roundNum, difficulty: game.state.difficulty, prize: game.state.prize }
  });

  const guild = await channel.client.guilds.fetch(guildId).catch(() => null);

  if (winnerIds.length === 0) {
    const m = await channel.send({ embeds: [new EmbedBuilder().setColor(0x808080).setTitle("🧠 Trivia Over!").setDescription("Everyone was eliminated! No winner.")] });
    game.gameMsgIds.push(m.id);
  } else if (winnerIds.length === 1) {
    const u = await channel.client.users.fetch(winnerIds[0]).catch(() => null);
    if (u) await announceWinner(channel, u, "Trivia Battle Royale", guild, game.state.prize ? `🎁 Prize: **${game.state.prize}**` : "");
  } else {
    // Multiple winners (all survived all questions)
    const mentions = winnerIds.map(id => `<@${id}>`).join(", ");
    const m = await channel.send({ embeds: [new EmbedBuilder().setColor(0xf0a500).setTitle("🏆 Trivia — Multiple Winners!").setDescription(`🎊 All survivors win!\n\n**Winners:** ${mentions}${game.state.prize ? `\n\n🎁 Prize: **${game.state.prize}**` : ""}`)] });
    game.gameMsgIds.push(m.id);
  }

  const cfg = await (await import("../gamesStorage.js")).getGuildGamesConfig ? null : null;
  const gCfg = await (await import("../gamesStorage.js")).getActiveGame(guildId).catch(() => null);

  await cleanGameMessages(channel, game.gameMsgIds);
  if (guild) {
    const { getGuildGamesConfig } = await import("../gamesStorage.js");
    const gcfg = await getGuildGamesConfig(guildId);
    if (gcfg) {
      await lockGamesChannel(channel, guild, channel.client);
      await (await import("../gamesHost.js")).repostAdminPanel(channel, guild, gcfg, channel.client);
    }
  }
}

export async function onMessage(message, game, client) {
  if (game.state.phase !== "playing") return;
  if (message.author.id !== game.state.currentPlayerId) return;

  const answer = message.content.trim().toUpperCase();
  if (!["A","B","C","D"].includes(answer)) return;

  game.gameMsgIds.push(message.id);
  game.state.messages.push({ userId: message.author.id, content: message.content, ts: new Date().toISOString() });

  const q      = game.state.currentQuestion;
  const idx    = ["A","B","C","D"].indexOf(answer);
  const chosen = q.options[idx];
  const correct = chosen === q.answer;

  if (correct) {
    game.state.players[message.author.id].correct = (game.state.players[message.author.id].correct ?? 0) + 1;
    const m = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(`✅ <@${message.author.id}> got it! The answer was **${q.answer}**`)] });
    game.gameMsgIds.push(m.id);
    game.state.currentPlayerId = null; game.state.currentMsgId = null; game.state.currentQuestion = null;
    await setActiveGame(message.guild.id, game);
    await new Promise(r => setTimeout(r, 2000));
    await runNextRound(message.channel, message.guild.id);
  } else {
    await eliminate(message.channel, message.guild.id, message.author.id, `<@${message.author.id}> answered **${answer}** — wrong! The answer was **${q.answer}**. **Eliminated!** 💀`);
  }
}