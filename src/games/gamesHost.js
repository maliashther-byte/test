import fs from "fs";
import {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle
} from "discord.js";
import { getGuildGamesConfig, getActiveGame, setActiveGame, clearActiveGame, getGuildTranscripts } from "./gamesStorage.js";
import { lockGamesChannel, unlockGamesChannel, postAdminPanel } from "./gamesSetup.js";
import * as counting    from "./gamesModes/counting.js";
import * as wordGuess   from "./gamesModes/wordGuess.js";
import * as doATask     from "./gamesModes/doATask.js";
import * as numberGuess from "./gamesModes/numberGuess.js";
import * as trivia      from "./gamesModes/trivia.js";
import * as typeRace    from "./gamesModes/typeRace.js";

const config   = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));
const OWNER_ID = config.ownerId;

export const MODES = { counting, wordGuess, doATask, numberGuess, trivia, typeRace };

// ─── Permission check ─────────────────────────────────────────────────────────
export async function isHoster(member, guildId) {
  if (member.id === OWNER_ID) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const cfg = await getGuildGamesConfig(guildId);
  return cfg ? member.roles.cache.has(cfg.hosterRoleId) : false;
}

// ─── /host slash command ──────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("host")
  .setDescription("Host a game in the games channel.")
  .addStringOption(o => o.setName("gamemode").setDescription("Which game to host.").setRequired(true).addChoices(
    { name: "🔢 Counting (1–100)",            value: "counting"    },
    { name: "💬 Word Guess (AI)",              value: "wordGuess"   },
    { name: "🎬 Do a Task",                    value: "doATask"     },
    { name: "🔮 Number Guess",                 value: "numberGuess" },
    { name: "🧠 Trivia Battle Royale (AI)",    value: "trivia"      },
    { name: "⌨️ Type Race",                   value: "typeRace"    }
  ))
  .addStringOption(o => o.setName("prize").setDescription("What is the prize? Leave blank for just for fun.").setRequired(false))
  .addStringOption(o => o.setName("ping").setDescription("Which ping to use.").setRequired(false)
    .addChoices({ name: "No ping", value: "none" }, { name: "Ping 1", value: "ping1" }, { name: "Ping 2", value: "ping2" }))
  .addStringOption(o => o.setName("difficulty").setDescription("easy/medium/hard (AI modes, default: medium)").setRequired(false)
    .addChoices({ name: "Easy", value: "easy" }, { name: "Medium", value: "medium" }, { name: "Hard", value: "hard" }))
  .addStringOption(o => o.setName("category").setDescription("Trivia category (optional)").setRequired(false)
    .addChoices(
      { name: "General", value: "general" },
      { name: "Science", value: "science" },
      { name: "History", value: "history" },
      { name: "Geography", value: "geography" },
      { name: "Movies", value: "movies" },
      { name: "Sports", value: "sports" }
    ))
  .addStringOption(o => o.setName("word").setDescription("Custom word (Word Guess only, blank = AI picks)").setRequired(false))
  .addStringOption(o => o.setName("task").setDescription("Task description (Do a Task only)").setRequired(false))
  .addIntegerOption(o => o.setName("min").setDescription("Min number (Number Guess, default: 1)").setRequired(false))
  .addIntegerOption(o => o.setName("max").setDescription("Max number (Number Guess, default: 100)").setRequired(false))
  .addIntegerOption(o => o.setName("hint_interval").setDescription("Hint interval seconds (Word Guess, default: 30)").setMinValue(5).setRequired(false))
  .addIntegerOption(o => o.setName("max_players").setDescription("Max players (Battle Royale modes, default: 10)").setMinValue(2).setMaxValue(30).setRequired(false))
  .addIntegerOption(o => o.setName("time_limit").setDescription("Seconds per question/round (Battle Royale, default: 20)").setMinValue(5).setMaxValue(120).setRequired(false))
  .addIntegerOption(o => o.setName("question_count").setDescription("Number of questions (Trivia, default: 5)").setMinValue(1).setMaxValue(20).setRequired(false));

export async function execute(interaction) {
  if (!await isHoster(interaction.member, interaction.guild.id)) {
    return interaction.reply({ content: "❌ You need the Hoster role to host games.", ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const cfg = await getGuildGamesConfig(interaction.guild.id);
  if (!cfg) return interaction.editReply({ content: "❌ Run `/gamessetup` first." });

  const existing = await getActiveGame(interaction.guild.id);
  if (existing) return interaction.editReply({ content: `❌ A game is already running (**${MODES[existing.gameMode]?.META.name}**). End it first.` });

  const gameMode = interaction.options.getString("gamemode");
  const prize    = interaction.options.getString("prize") ?? null;
  const ping     = interaction.options.getString("ping") ?? "none";
  const options  = {
    prize,
    difficulty:   interaction.options.getString("difficulty")    ?? "medium",
    category:     interaction.options.getString("category")      ?? null,
    word:         interaction.options.getString("word"),
    task:         interaction.options.getString("task"),
    min:          interaction.options.getInteger("min"),
    max:          interaction.options.getInteger("max"),
    hintInterval: interaction.options.getInteger("hint_interval") ?? 30,
    maxPlayers:   interaction.options.getInteger("max_players")   ?? 10,
    timeLimit:    interaction.options.getInteger("time_limit")    ?? 20,
    questionCount: interaction.options.getInteger("question_count") ?? 5,
  };

  const channel = await interaction.guild.channels.fetch(cfg.gamesChannelId).catch(() => null);
  if (!channel) return interaction.editReply({ content: "❌ Games channel not found." });

  await startGame(channel, interaction.guild, interaction.user.id, gameMode, ping, options, cfg);
  await interaction.editReply({ content: `✅ **${MODES[gameMode].META.name}** started!${prize ? ` Prize: **${prize}**` : " (Just for fun)"}` });
}

// ─── /hint command ────────────────────────────────────────────────────────────
export const hintData = new SlashCommandBuilder()
  .setName("hint")
  .setDescription("Drop a hint for the current game (hosters only).");

export async function executeHint(interaction) {
  if (!await isHoster(interaction.member, interaction.guild.id)) {
    return interaction.reply({ content: "❌ Hosters only.", ephemeral: true });
  }
  const game = await getActiveGame(interaction.guild.id);
  if (!game) return interaction.reply({ content: "❌ No game running.", ephemeral: true });

  const mode = MODES[game.gameMode];
  if (!mode?.META?.supportsHints || !mode?.dropHint) {
    return interaction.reply({ content: "❌ This gamemode doesn't support hints.", ephemeral: true });
  }

  const cfg     = await getGuildGamesConfig(interaction.guild.id);
  const channel = await interaction.guild.channels.fetch(cfg.gamesChannelId).catch(() => null);
  if (!channel) return interaction.reply({ content: "❌ Games channel not found.", ephemeral: true });

  const dropped = await mode.dropHint(channel, interaction.guild.id, game);
  await interaction.reply({ content: dropped ? "💡 Hint dropped!" : "❌ No more hints available.", ephemeral: true });
}

// ─── Start a game ─────────────────────────────────────────────────────────────
export async function startGame(channel, guild, hostId, gameMode, ping, options, cfg) {
  const gameMsgIds = [];

  // Ping
  if (ping !== "none") {
    const roleId = ping === "ping1" ? cfg.ping1RoleId : cfg.ping2RoleId;
    if (roleId) { const pm = await channel.send({ content: `<@&${roleId}>` }); setTimeout(() => pm.delete().catch(() => {}), 5000); }
  }

  // Unlock channel
  await unlockGamesChannel(channel, guild, channel.client);

  // Post prize banner if prize set
  if (options?.prize) {
    const prizeEmbed = new EmbedBuilder()
      .setColor(0xf0a500)
      .setTitle("🏆 Prize")
      .setDescription(`**${options.prize}**`)
      .setFooter({ text: "Win the game to claim!" });
    const pm = await channel.send({ embeds: [prizeEmbed] });
    gameMsgIds.push(pm.id);
  }

  const mode = MODES[gameMode];
  if (mode) await mode.start(channel, guild, hostId, options ?? {}, gameMsgIds);
}

// ─── Button: games_hint_<guildId> ─────────────────────────────────────────────
export async function handleHintButton(interaction) {
  if (!await isHoster(interaction.member, interaction.guild.id)) {
    return interaction.reply({ content: "❌ Hosters only.", ephemeral: true });
  }
  const game = await getActiveGame(interaction.guild.id);
  if (!game) return interaction.reply({ content: "❌ No game running.", ephemeral: true });

  const mode = MODES[game.gameMode];
  if (!mode?.dropHint) return interaction.reply({ content: "❌ No hints for this mode.", ephemeral: true });

  const dropped = await mode.dropHint(interaction.channel, interaction.guild.id, game);
  await interaction.reply({ content: dropped ? "💡 Hint dropped!" : "❌ No more hints.", ephemeral: true });
}

// ─── Button: game_end_<guildId> ───────────────────────────────────────────────
export async function handleEndGame(interaction) {
  if (!await isHoster(interaction.member, interaction.guild.id)) {
    return interaction.reply({ content: "❌ Hosters only.", ephemeral: true });
  }
  const game = await getActiveGame(interaction.guild.id);
  if (!game) return interaction.reply({ content: "❌ No game running.", ephemeral: true });

  await clearActiveGame(interaction.guild.id);

  const cfg = await getGuildGamesConfig(interaction.guild.id);
  const channel = interaction.channel;

  // Clean messages, repost admin panel, relock
  await cleanGameMessages(channel, game.gameMsgIds);
  await lockGamesChannel(channel, interaction.guild, interaction.client);
  await repostAdminPanel(channel, interaction.guild, cfg, interaction.client);

  await interaction.reply({ content: "⏹ Game ended.", ephemeral: true });
}

// ─── Repost admin panel after game ends ──────────────────────────────────────
export async function repostAdminPanel(channel, guild, cfg, client) {
  try {
    const hosterRole = guild.roles.cache.get(cfg.hosterRoleId) ?? { name: "Hoster" };
    const ping1Role  = guild.roles.cache.get(cfg.ping1RoleId)  ?? { name: cfg.ping1Name ?? "Ping1" };
    const ping2Role  = cfg.ping2RoleId ? (guild.roles.cache.get(cfg.ping2RoleId) ?? { name: cfg.ping2Name ?? "Ping2" }) : null;
    const panelMsg   = await postAdminPanel(channel, guild, hosterRole, ping1Role, ping2Role);
    await setGuildGamesConfig(guild.id, { ...cfg, adminPanelMsgId: panelMsg.id });
  } catch (e) { console.error("[repostAdminPanel] Error:", e); }
}

// ─── Battle royale join/start buttons ─────────────────────────────────────────
export async function handleBattleRoyaleButton(interaction) {
  const id      = interaction.customId;
  const guildId = interaction.guild.id;
  const game    = await getActiveGame(guildId);
  if (!game) return interaction.reply({ content: "❌ No active game.", ephemeral: true });

  if (id.startsWith("game_trivia_join_"))      return trivia.handleJoin(interaction, game);
  if (id.startsWith("game_trivia_start_"))     return trivia.handleStartRound(interaction, game);
  if (id.startsWith("game_task_setwinner_"))   return doATask.handleSetWinner(interaction, game);
  if (id.startsWith("game_task_close_"))       return doATask.handleCloseSubmissions(interaction, game);
  if (id.startsWith("game_task_nowinner_"))    return handleEndGameNoWinner(interaction, game);
}

// ─── End game with no winner (Do a Task) ──────────────────────────────────────
async function handleEndGameNoWinner(interaction, game) {
  if (interaction.user.id !== game.hostId && !await isHoster(interaction.member, interaction.guild.id)) {
    return interaction.reply({ content: "❌ Hosters only.", ephemeral: true });
  }
  await clearActiveGame(interaction.guild.id);
  const cfg = await getGuildGamesConfig(interaction.guild.id);

  const embed = new EmbedBuilder().setColor(0x808080).setTitle("🎬 Do a Task — Ended")
    .setDescription("Game ended with **no winner** selected.");
  await interaction.update({ embeds: [embed], components: [] });

  await cleanGameMessages(interaction.channel, game.gameMsgIds);
  await lockGamesChannel(interaction.channel, interaction.guild, interaction.client);
  await repostAdminPanel(interaction.channel, interaction.guild, cfg, interaction.client);
}

// ─── Game modal router ────────────────────────────────────────────────────────
export async function handleGameModal(interaction) {
  const id      = interaction.customId;
  const guildId = interaction.guild.id;
  const game    = await getActiveGame(guildId);
  if (!game) return interaction.reply({ content: "❌ No active game.", ephemeral: true });
  if (id.startsWith("game_task_winner_modal_")) return doATask.handleSetWinnerModal(interaction, game);
}

// ─── Admin panel buttons ──────────────────────────────────────────────────────
export async function handleHostPanel(interaction) {
  if (!await isHoster(interaction.member, interaction.guild.id)) {
    return interaction.reply({ content: "❌ You need the Hoster role.", ephemeral: true });
  }
  const existing = await getActiveGame(interaction.guild.id);
  if (existing) return interaction.reply({ content: `❌ Game already running: **${MODES[existing.gameMode]?.META.name}**.`, ephemeral: true });

  const select = new StringSelectMenuBuilder()
    .setCustomId("games_select_mode").setPlaceholder("Choose a gamemode...")
    .addOptions(Object.entries(MODES).map(([key, mod]) => ({
      label: mod.META.name, value: key, emoji: mod.META.emoji,
      description: mod.META.description.slice(0, 50)
    })));

  await interaction.reply({
    content: "🎮 **Select a gamemode:**",
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: true
  });
}

export async function handleSelectMode(interaction) {
  if (!await isHoster(interaction.member, interaction.guild.id)) {
    return interaction.reply({ content: "❌ No.", ephemeral: true });
  }
  const gameMode = interaction.values[0];
  const cfg      = await getGuildGamesConfig(interaction.guild.id);
  if (!cfg) return interaction.reply({ content: "❌ Not set up.", ephemeral: true });

  // Ask for prize
  const modal = new ModalBuilder().setCustomId(`games_prize_modal_${gameMode}`).setTitle("Set Prize (Optional)");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("prize").setLabel("Prize (optional)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("ping_choice").setLabel("Ping choice (none/ping1/ping2)")
        .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10).setPlaceholder("none")
    )
  );
  await interaction.showModal(modal);
}

// Modal: games_prize_modal_<gameMode>
export async function handlePrizeModal(interaction) {
  if (!await isHoster(interaction.member, interaction.guild.id)) {
    return interaction.reply({ content: "❌ No.", ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const gameMode   = interaction.customId.replace("games_prize_modal_", "");
  const prize      = interaction.fields.getTextInputValue("prize").trim() || null;
  const pingChoice = interaction.fields.getTextInputValue("ping_choice").trim().toLowerCase() || "none";
  const ping       = ["ping1","ping2"].includes(pingChoice) ? pingChoice : "none";

  const cfg     = await getGuildGamesConfig(interaction.guild.id);
  const channel = await interaction.guild.channels.fetch(cfg.gamesChannelId).catch(() => null);
  if (!channel) return interaction.editReply({ content: "❌ Games channel not found." });

  await startGame(channel, interaction.guild, interaction.user.id, gameMode, ping, {
    prize, difficulty: "medium", hintInterval: 30, maxPlayers: 10, timeLimit: 20, questionCount: 5
  }, cfg);

  await interaction.editReply({ content: `✅ **${MODES[gameMode].META.name}** started!${prize ? ` Prize: **${prize}**` : " (Just for fun)"}` });
}

export async function handleStartGame(interaction) {
  if (!await isHoster(interaction.member, interaction.guild.id)) return interaction.reply({ content: "❌ No.", ephemeral: true });
  await interaction.deferUpdate();
  const parts    = interaction.customId.split("_");
  const gameMode = parts[2];
  const ping     = parts[3];
  const cfg      = await getGuildGamesConfig(interaction.guild.id);
  const channel  = await interaction.guild.channels.fetch(cfg.gamesChannelId).catch(() => null);
  if (!channel) return interaction.followUp({ content: "❌ Channel not found.", ephemeral: true });
  await startGame(channel, interaction.guild, interaction.user.id, gameMode, ping, { difficulty: "medium", hintInterval: 30, maxPlayers: 10, timeLimit: 20, questionCount: 5 }, cfg);
  await interaction.editReply({ content: `✅ **${MODES[gameMode].META.name}** started!`, components: [] });
}

// ─── Last 3 Winners (detailed) ────────────────────────────────────────────────
export async function handleLastWinners(interaction) {
  const transcripts = await getGuildTranscripts(interaction.guild.id);
  const last3       = transcripts.slice(0, 3);
  if (!last3.length) return interaction.reply({ content: "No games have been played yet!", ephemeral: true });

  const fields = await Promise.all(last3.map(async (t, i) => {
    const mode    = MODES[t.gameMode];
    const emoji   = mode?.META.emoji ?? "🎮";
    const name    = mode?.META.name  ?? t.gameMode;
    const winUser = t.winner ? await interaction.client.users.fetch(t.winner).catch(() => null) : null;

    // Build detail line from meta
    const meta = t.meta ?? {};
    const details = [];
    if (meta.secret    !== undefined) details.push(`Number: **${meta.secret}** (${meta.min}–${meta.max})`);
    if (meta.word)                    details.push(`Word: **${meta.word}** (${meta.difficulty ?? "?"})`);
    if (meta.sentence)                details.push(`Sentence: "${meta.sentence.slice(0, 40)}..."`);
    if (meta.timeTaken)               details.push(`Time: **${(meta.timeTaken / 1000).toFixed(2)}s**`);
    if (meta.task)                    details.push(`Task: ${meta.task.slice(0, 40)}`);
    if (meta.scores) {
      const top = Object.entries(meta.scores).sort(([, a], [, b]) => b - a)[0];
      if (top) details.push(`Score: **${top[1]}** correct`);
    }
    if (meta.chain)                   details.push(`Chain: ${meta.chain.length} emojis`);

    const endedTs = t.endedAt ? `<t:${Math.floor(new Date(t.endedAt).getTime() / 1000)}:R>` : "Unknown";

    return {
      name:  `${i + 1}. ${emoji} ${name}`,
      value: [
        `🏆 **Winner:** ${winUser ? `${winUser.tag} (<@${t.winner}>)` : "No winner"}`,
        `📅 **Ended:** ${endedTs}`,
        `💬 **Messages:** ${t.messages?.length ?? 0}`,
        ...(details.length ? [`📊 **Details:** ${details.join(" · ")}`] : []),
        ...(t.meta?.prize ? [`🎁 **Prize:** ${t.meta.prize}`] : []),
      ].join("\n"),
      inline: false
    };
  }));

  const embed = new EmbedBuilder()
    .setColor(0xf0a500)
    .setTitle("🏆 Last 3 Game Results")
    .addFields(fields)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export async function handleRules(interaction) {
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📋 Games Rules")
    .setDescription(
      "**General Rules:**\n" +
      "• No automating, botting, or scripting — instant disqualification\n" +
      "• No cheating of any kind\n" +
      "• Respect other players and the host\n" +
      "• Host's decision is final\n\n" +
      "**Mode-Specific:**\n" +
      "• **Counting:** No counting twice in a row\n" +
      "• **Word Guess:** Guesses deleted — fair for everyone\n" +
      "• **Type Race:** Copy-pasting detected → disqualified\n" +
      "• **Do a Task:** Video file uploads only, no links\n" +
      "• **Battle Royale modes:** Only the picked player may answer\n" +
      "• **Trivia:** Wrong answer = eliminated immediately\n" +
      "• Messages in this channel while no game runs are auto-deleted"
    );
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export async function handleLeaderboard(interaction) {
  const transcripts = await getGuildTranscripts(interaction.guild.id);
  const wins = {};
  for (const t of transcripts) { if (t.winner) wins[t.winner] = (wins[t.winner] ?? 0) + 1; }
  const sorted = Object.entries(wins).sort(([, a], [, b]) => b - a).slice(0, 10);
  if (!sorted.length) return interaction.reply({ content: "No games played yet!", ephemeral: true });
  const medals = ["🥇","🥈","🥉"];
  const embed  = new EmbedBuilder().setColor(0xf0a500).setTitle("📊 Games Leaderboard — All Time")
    .setDescription(sorted.map(([uid, w], i) => `${medals[i] ?? `**${i+1}.**`} <@${uid}> — **${w}** win${w !== 1 ? "s" : ""}`).join("\n"))
    .setTimestamp();
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ─── Winner announcement ──────────────────────────────────────────────────────
export async function announceWinner(channel, user, gameName, guild, extra = "") {
  const embed = new EmbedBuilder().setColor(0xf0a500)
    .setTitle("🏆 We have a winner!")
    .setDescription(`<@${user.id}> won **${gameName}**!${extra ? `\n${extra}` : ""}`)
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();
  return channel.send({ content: `🎉 <@${user.id}>`, embeds: [embed] });
}

// ─── Clean game messages (preserve admin panel) ───────────────────────────────
export async function cleanGameMessages(channel, msgIds) {
  await new Promise(r => setTimeout(r, 5000));

  const cfg = await getGuildGamesConfig(channel.guild?.id ?? channel.guildId);
  const adminPanelMsgId = cfg?.adminPanelMsgId;

  // Filter out the admin panel from deletion
  const toDelete = (msgIds ?? []).filter(id => id !== adminPanelMsgId);

  const now = Date.now(), twoWeeks = 14 * 24 * 60 * 60 * 1000;
  const recent = [], old = [];
  for (const id of toDelete) {
    const ts = Number((BigInt(id) >> 22n) + 1420070400000n);
    (ts > now - twoWeeks ? recent : old).push(id);
  }

  for (let i = 0; i < recent.length; i += 100) {
    await channel.bulkDelete(recent.slice(i, i + 100), true).catch(() => {});
  }
  for (const id of old) {
    await channel.messages.delete(id).catch(() => {});
    await new Promise(r => setTimeout(r, 300));
  }

  // Delete any remaining non-pinned, non-admin-panel messages
  try {
    const msgs = await channel.messages.fetch({ limit: 50 });
    const del  = msgs.filter(m => !m.pinned && m.id !== adminPanelMsgId);
    if (del.size > 0) await channel.bulkDelete(del, true).catch(() => {});
  } catch (_) {}
}

// ─── Message router ───────────────────────────────────────────────────────────
export async function handleGameMessage(message) {
  if (!message.guild) return;

  const cfg = await getGuildGamesConfig(message.guild.id);
  if (!cfg || message.channelId !== cfg.gamesChannelId) return;
  if (message.author.bot) return;

  const game = await getActiveGame(message.guild.id);

  // No game running — delete the message
  if (!game) {
    await message.delete().catch(() => {});
    return;
  }

  // Game running — route to gamemode
  if (message.channelId !== game.channelId) return;
  const mode = MODES[game.gameMode];
  if (mode?.onMessage) await mode.onMessage(message, game, message.client);
}