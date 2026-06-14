import fs from "fs";
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} from "discord.js";
import {
  getGiveaway, saveGiveaway, deleteGiveaway,
  getAllActiveGiveaways, getGiveaways, saveGiveaways
} from "./giveawayStorage.js";
import * as joinServer   from "./requirements/joinServer.js";
import * as accountAge   from "./requirements/accountAge.js";
import * as hasRole      from "./requirements/hasRole.js";
import * as triviaReq    from "./requirements/trivia.js";
import * as wordleReq    from "./requirements/wordle.js";
import * as shortAnswer  from "./requirements/shortAnswer.js";
import * as messageCount from "./requirements/messageCount.js";

const config   = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));
const OWNER_ID = config.ownerId;

export const REQUIREMENT_TYPES = {
  join_server:    joinServer,
  account_age:    accountAge,
  has_role:       hasRole,
  trivia:         triviaReq,
  wordle:         wordleReq,
  short_answer:   shortAnswer,
  message_count:  messageCount,
};

// ─── Build giveaway embed ─────────────────────────────────────────────────────
export function buildGiveawayEmbed(giveaway, guild) {
  const endsTs    = Math.floor(new Date(giveaway.endsAt).getTime() / 1000);
  const entryCount = Object.keys(giveaway.entries ?? {}).length;

  const reqLines = (giveaway.requirements ?? []).map(r => {
    const mod = REQUIREMENT_TYPES[r.type];
    return `• ${mod?.LABEL ?? r.type}${r.options?.minDays ? ` (${r.options.minDays}d)` : ""}${r.options?.minMessages ? ` (${r.options.minMessages} msgs)` : ""}`;
  });

  const embed = new EmbedBuilder()
    .setColor(giveaway.ended ? 0x808080 : 0xff6b6b)
    .setTitle(`🎉 ${giveaway.prize}`)
    .addFields(
      { name: "🏆 Winners",     value: `${giveaway.winnerCount}`,               inline: true },
      { name: "👥 Entries",     value: `${entryCount}`,                         inline: true },
      { name: "🕐 Ends",        value: giveaway.ended ? "Ended" : `<t:${endsTs}:R>`, inline: true },
      { name: "👤 Hosted by",   value: `<@${giveaway.hostId}>`,                 inline: true },
    );

  if (reqLines.length) {
    embed.addFields({ name: "📋 Requirements to Enter", value: reqLines.join("\n"), inline: false });
  }

  if (giveaway.ended && giveaway.winners?.length) {
    embed.addFields({ name: "🎊 Winners", value: giveaway.winners.map(w => `<@${w}>`).join(", "), inline: false });
    embed.setColor(0x57f287);
  } else if (giveaway.ended && !giveaway.winners?.length) {
    embed.addFields({ name: "😔 No Winner", value: "Not enough entries.", inline: false });
    embed.setColor(0xed4245);
  } else {
    embed.setFooter({ text: "Press 🎉 to enter!" });
  }

  return embed;
}

function buildGiveawayRow(ended = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("giveaway_enter")
      .setLabel(ended ? "Giveaway Ended" : "🎉 Enter")
      .setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(ended),
    new ButtonBuilder()
      .setCustomId("giveaway_myentries")
      .setLabel("📋 My Status")
      .setStyle(ButtonStyle.Secondary)
  );
}

// ─── Start a giveaway ─────────────────────────────────────────────────────────
export async function startGiveaway(channel, guild, hostId, options) {
  const { prize, winnerCount, durationMs, requirements } = options;
  const endsAt = new Date(Date.now() + durationMs).toISOString();

  const giveaway = {
    messageId:   null,
    channelId:   channel.id,
    guildId:     guild.id,
    hostId,
    prize,
    winnerCount: winnerCount ?? 1,
    endsAt,
    ended:       false,
    cancelled:   false,
    entries:     {},
    winners:     [],
    requirements: requirements ?? [],
    messageCounts: {}  // for message_count requirement
  };

  const embed = buildGiveawayEmbed(giveaway, guild);
  const row   = buildGiveawayRow(false);
  const msg   = await channel.send({ embeds: [embed], components: [row] });

  giveaway.messageId = msg.id;
  await saveGiveaway(msg.id, giveaway);

  return msg;
}

// ─── Enter giveaway button ────────────────────────────────────────────────────
export async function handleEnterButton(interaction) {
  const messageId = interaction.message.id;
  const giveaway  = await getGiveaway(messageId);

  if (!giveaway) return interaction.reply({ content: "❌ Giveaway not found.", ephemeral: true });
  if (giveaway.ended)      return interaction.reply({ content: "❌ This giveaway has ended.", ephemeral: true });
  if (giveaway.cancelled)  return interaction.reply({ content: "❌ This giveaway was cancelled.", ephemeral: true });
  if (new Date() > new Date(giveaway.endsAt)) return interaction.reply({ content: "❌ This giveaway has expired.", ephemeral: true });

  const userId  = interaction.user.id;
  const already = giveaway.entries[userId];

  // If no requirements — enter immediately
  if (!giveaway.requirements?.length) {
    if (already) return interaction.reply({ content: "✅ You're already entered!", ephemeral: true });
    giveaway.entries[userId] = { joinedAt: new Date().toISOString(), requirementsMet: [] };
    await saveGiveaway(messageId, giveaway);
    await updateGiveawayMessage(interaction.client, giveaway);
    return interaction.reply({ content: "🎉 You've entered the giveaway! Good luck!", ephemeral: true });
  }

  // Has requirements — show entry modal/info
  await showRequirementsEntry(interaction, giveaway, userId, already);
}

// ─── Show requirements entry flow ────────────────────────────────────────────
async function showRequirementsEntry(interaction, giveaway, userId, existingEntry) {
  const reqs      = giveaway.requirements ?? [];
  const metSoFar  = existingEntry?.requirementsMet ?? [];
  const unmet     = reqs.filter(r => !metSoFar.includes(r.type));

  if (!unmet.length) {
    if (existingEntry) {
      return interaction.reply({ content: "✅ You've met all requirements and are entered! Good luck!", ephemeral: true });
    }
  }

  // Check auto-checkable requirements first
  const autoReqs = unmet.filter(r => ["join_server","account_age","has_role","message_count"].includes(r.type));
  const autoResults = await Promise.all(
    autoReqs.map(async r => {
      const opts = { ...r.options, guildId: giveaway.guildId, counts: giveaway.messageCounts };
      const res  = await REQUIREMENT_TYPES[r.type].check(userId, opts, interaction.client);
      return { type: r.type, ...res };
    })
  );

  const autoFailed = autoResults.filter(r => !r.met);
  if (autoFailed.length) {
    const lines = autoFailed.map(r => `❌ ${r.reason}`).join("\n");
    return interaction.reply({ content: `**You don't meet all requirements:**\n${lines}`, ephemeral: true });
  }

  // All auto reqs met — mark them
  const newMet = [...metSoFar, ...autoReqs.map(r => r.type)];

  // Handle manual requirements (trivia, wordle, short_answer)
  const manualUnmet = unmet.filter(r => ["trivia","wordle","short_answer"].includes(r.type));

  if (!manualUnmet.length) {
    // All done — enter
    giveaway.entries[userId] = { joinedAt: new Date().toISOString(), requirementsMet: newMet };
    await saveGiveaway(giveaway.messageId, giveaway);
    await updateGiveawayMessage(interaction.client, giveaway);
    return interaction.reply({ content: "🎉 All requirements met! You're entered. Good luck!", ephemeral: true });
  }

  // Show modal for first manual requirement
  const first = manualUnmet[0];
  const modal = buildRequirementModal(first, giveaway.messageId, userId, newMet);
  if (modal) {
    await interaction.showModal(modal);
  } else {
    interaction.reply({ content: "⚠️ Could not process requirement. Contact the host.", ephemeral: true });
  }
}

function buildRequirementModal(req, messageId, userId, metSoFar) {
  if (req.type === "trivia") {
    const modal = new ModalBuilder()
      .setCustomId(`giveaway_req_trivia_${messageId}`)
      .setTitle("Trivia Question");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("trivia_answer")
          .setLabel(req.options?.question ?? "Answer the trivia question")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
    return modal;
  }

  if (req.type === "wordle") {
    const modal = new ModalBuilder()
      .setCustomId(`giveaway_req_wordle_${messageId}`)
      .setTitle("Submit Your Wordle Result");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("wordle_result")
          .setLabel("Paste your Wordle share result")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("Wordle 1,234 4/6\n\n🟨⬛🟩⬛⬛\n...")
          .setRequired(true)
      )
    );
    return modal;
  }

  if (req.type === "short_answer") {
    const modal = new ModalBuilder()
      .setCustomId(`giveaway_req_shortanswer_${messageId}`)
      .setTitle("Answer Required");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("short_answer")
          .setLabel(req.options?.question ?? "Answer the question below")
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(5)
          .setMaxLength(500)
          .setRequired(true)
      )
    );
    return modal;
  }

  return null;
}

// ─── Modal submissions ────────────────────────────────────────────────────────
export async function handleRequirementModal(interaction) {
  const id        = interaction.customId;
  const messageId = id.split("_").slice(-1)[0];
  const giveaway  = await getGiveaway(messageId);
  if (!giveaway)  return interaction.reply({ content: "❌ Giveaway not found.", ephemeral: true });

  await interaction.deferReply({ ephemeral: true });
  const userId = interaction.user.id;

  if (id.startsWith("giveaway_req_trivia_")) {
    const answer = interaction.fields.getTextInputValue("trivia_answer").trim().toLowerCase();
    const req    = giveaway.requirements.find(r => r.type === "trivia");
    const correct = answer === (req?.options?.answer ?? "").toLowerCase();

    if (!correct) return interaction.editReply({ content: `❌ Wrong answer! The correct answer was: **${req?.options?.answer}**` });

    await markRequirementMet(userId, giveaway, "trivia", interaction.client);
    return interaction.editReply({ content: "✅ Correct! Checking remaining requirements..." });
  }

  if (id.startsWith("giveaway_req_wordle_")) {
    const result = interaction.fields.getTextInputValue("wordle_result").trim();
    const check  = await wordleReq.check(userId, { wordleResult: result }, interaction.client);
    if (!check.met) return interaction.editReply({ content: `❌ ${check.reason}` });

    await markRequirementMet(userId, giveaway, "wordle", interaction.client);
    return interaction.editReply({ content: "✅ Wordle result accepted! You're entered." });
  }

  if (id.startsWith("giveaway_req_shortanswer_")) {
    const answer = interaction.fields.getTextInputValue("short_answer").trim();
    const req    = giveaway.requirements.find(r => r.type === "short_answer");

    // Save answer for host review
    if (!giveaway.pendingAnswers) giveaway.pendingAnswers = {};
    giveaway.pendingAnswers[userId] = { answer, submittedAt: new Date().toISOString() };
    await saveGiveaway(messageId, giveaway);

    // DM host with approve/reject buttons
    try {
      const host = await interaction.client.users.fetch(giveaway.hostId);
      const embed = new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle("📋 Giveaway Entry Review")
        .addFields(
          { name: "🎉 Giveaway", value: giveaway.prize,                              inline: true },
          { name: "👤 User",     value: `<@${userId}> (\`${userId}\`)`,              inline: true },
          { name: "❓ Question", value: req?.options?.question ?? "Short answer",    inline: false },
          { name: "💬 Answer",   value: answer,                                       inline: false }
        );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`giveaway_approve_${messageId}_${userId}`).setLabel("✅ Approve").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`giveaway_reject_${messageId}_${userId}`).setLabel("❌ Reject").setStyle(ButtonStyle.Danger)
      );
      await host.send({ embeds: [embed], components: [row] });
    } catch (_) {}

    return interaction.editReply({ content: "✅ Answer submitted! The host will review it. You'll be DM'd when approved or rejected." });
  }
}

async function markRequirementMet(userId, giveaway, reqType, client) {
  const entry = giveaway.entries[userId] ?? { joinedAt: new Date().toISOString(), requirementsMet: [] };
  if (!entry.requirementsMet.includes(reqType)) entry.requirementsMet.push(reqType);

  // Check if all requirements are now met
  const allMet = (giveaway.requirements ?? []).every(r => entry.requirementsMet.includes(r.type));
  if (allMet) {
    giveaway.entries[userId] = entry;
    await saveGiveaway(giveaway.messageId, giveaway);
    await updateGiveawayMessage(client, giveaway);
  } else {
    giveaway.entries[userId] = entry;
    await saveGiveaway(giveaway.messageId, giveaway);
  }
}

// ─── Short answer approve/reject ──────────────────────────────────────────────
export async function handleShortAnswerApprove(interaction) {
  const parts     = interaction.customId.split("_");
  const messageId = parts[parts.length - 2];
  const userId    = parts[parts.length - 1];
  const giveaway  = await getGiveaway(messageId);
  if (!giveaway) return interaction.reply({ content: "❌ Giveaway not found.", ephemeral: true });

  await markRequirementMet(userId, giveaway, "short_answer", interaction.client);
  await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x57f287).setTitle("✅ Entry Approved")], components: [] });

  try { await (await interaction.client.users.fetch(userId)).send(`✅ Your entry for the **${giveaway.prize}** giveaway was approved! You're now entered.`); } catch (_) {}
}

export async function handleShortAnswerReject(interaction) {
  const parts     = interaction.customId.split("_");
  const messageId = parts[parts.length - 2];
  const userId    = parts[parts.length - 1];
  const giveaway  = await getGiveaway(messageId);
  if (!giveaway) return interaction.reply({ content: "❌ Giveaway not found.", ephemeral: true });

  await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xed4245).setTitle("❌ Entry Rejected")], components: [] });

  try { await (await interaction.client.users.fetch(userId)).send(`❌ Your entry for the **${giveaway.prize}** giveaway was not approved.`); } catch (_) {}
}

// ─── My Status button ─────────────────────────────────────────────────────────
export async function handleMyEntries(interaction) {
  const messageId = interaction.message.id;
  const giveaway  = await getGiveaway(messageId);
  if (!giveaway) return interaction.reply({ content: "❌ Giveaway not found.", ephemeral: true });

  const userId = interaction.user.id;
  const entry  = giveaway.entries[userId];
  const reqs   = giveaway.requirements ?? [];

  if (!entry) {
    const lines = reqs.map(r => `❌ ${REQUIREMENT_TYPES[r.type]?.LABEL ?? r.type}`).join("\n") || "None";
    return interaction.reply({ content: `**You are not entered.**\n\n**Requirements:**\n${lines}`, ephemeral: true });
  }

  const met    = entry.requirementsMet ?? [];
  const allMet = reqs.every(r => met.includes(r.type));
  const lines  = reqs.map(r => `${met.includes(r.type) ? "✅" : "❌"} ${REQUIREMENT_TYPES[r.type]?.LABEL ?? r.type}`).join("\n") || "None";

  await interaction.reply({
    content: `${allMet ? "✅ **You are entered!**" : "⏳ **Entry pending — complete all requirements:**"}\n\n${lines}`,
    ephemeral: true
  });
}

// ─── End giveaway ─────────────────────────────────────────────────────────────
export async function endGiveaway(messageId, client, forceWinner = null) {
  const giveaway = await getGiveaway(messageId);
  if (!giveaway || giveaway.ended) return null;

  // Get valid entries (all requirements met)
  const validEntries = Object.entries(giveaway.entries)
    .filter(([, e]) => {
      const reqs   = giveaway.requirements ?? [];
      const metAll = reqs.every(r => (e.requirementsMet ?? []).includes(r.type));
      return reqs.length === 0 || metAll;
    })
    .map(([uid]) => uid);

  let winners = [];

  if (forceWinner) {
    winners = [forceWinner];
  } else if (validEntries.length > 0) {
    const shuffled = [...validEntries].sort(() => Math.random() - 0.5);
    winners = shuffled.slice(0, Math.min(giveaway.winnerCount, validEntries.length));
  }

  giveaway.ended   = true;
  giveaway.winners = winners;
  await saveGiveaway(messageId, giveaway);

  // Update the giveaway message
  try {
    const guild   = await client.guilds.fetch(giveaway.guildId).catch(() => null);
    const channel = guild ? await guild.channels.fetch(giveaway.channelId).catch(() => null) : null;
    const msg     = channel ? await channel.messages.fetch(messageId).catch(() => null) : null;

    if (msg) {
      const embed = buildGiveawayEmbed(giveaway, guild);
      await msg.edit({ embeds: [embed], components: [buildGiveawayRow(true)] });
    }

    // Send winner announcement
    if (winners.length && channel) {
      const winnerMentions = winners.map(w => `<@${w}>`).join(", ");
      await channel.send({
        content: `🎊 Congratulations ${winnerMentions}! You won **${giveaway.prize}**!\n> [Jump to giveaway](https://discord.com/channels/${giveaway.guildId}/${giveaway.channelId}/${messageId})`,
        allowedMentions: { users: winners }
      });
    } else if (channel) {
      await channel.send({ content: `😔 No valid entries for **${giveaway.prize}**. No winner selected.` });
    }
  } catch (e) { console.error("[GiveawayEnd] Error:", e); }

  return winners;
}

// ─── Reroll ───────────────────────────────────────────────────────────────────
export async function rerollGiveaway(messageId, client) {
  const giveaway = await getGiveaway(messageId);
  if (!giveaway || !giveaway.ended) return null;

  const validEntries = Object.entries(giveaway.entries)
    .filter(([uid, e]) => {
      if (giveaway.winners.includes(uid)) return false;
      const reqs   = giveaway.requirements ?? [];
      const metAll = reqs.every(r => (e.requirementsMet ?? []).includes(r.type));
      return reqs.length === 0 || metAll;
    })
    .map(([uid]) => uid);

  if (!validEntries.length) return null;

  const newWinner = validEntries[Math.floor(Math.random() * validEntries.length)];
  giveaway.winners.push(newWinner);
  await saveGiveaway(messageId, giveaway);
  return newWinner;
}

// ─── Handle member leave (join_server requirement) ────────────────────────────
export async function handleMemberLeaveCheck(member, client) {
  const all = await getGiveaways();
  for (const [msgId, giveaway] of Object.entries(all)) {
    if (giveaway.ended || giveaway.cancelled) continue;

    const joinReq = giveaway.requirements?.find(r => r.type === "join_server" && r.options?.guildId === member.guild.id);
    if (!joinReq) continue;

    const userId = member.id;
    if (giveaway.entries[userId]) {
      // Remove their entry
      delete giveaway.entries[userId];
      await saveGiveaway(msgId, giveaway);

      // Update message
      await updateGiveawayMessage(client, giveaway).catch(() => {});

      // DM the user
      try {
        await member.user.send(`⚠️ You left **${member.guild.name}** so your entry for the **${giveaway.prize}** giveaway was removed.`);
      } catch (_) {}
    }
  }
}

// ─── Track message count ──────────────────────────────────────────────────────
export async function trackMessageCount(message) {
  if (!message.guild || message.author.bot) return;
  const all = await getGiveaways();
  let changed = false;
  for (const [msgId, giveaway] of Object.entries(all)) {
    if (giveaway.ended || giveaway.guildId !== message.guild.id) continue;
    const hasCountReq = giveaway.requirements?.some(r => r.type === "message_count");
    if (!hasCountReq) continue;
    if (!giveaway.messageCounts) giveaway.messageCounts = {};
    giveaway.messageCounts[message.author.id] = (giveaway.messageCounts[message.author.id] ?? 0) + 1;
    changed = true;
  }
  if (changed) await saveGiveaways(all);
}

// ─── Update giveaway message ──────────────────────────────────────────────────
export async function updateGiveawayMessage(client, giveaway) {
  try {
    const guild   = await client.guilds.fetch(giveaway.guildId).catch(() => null);
    const channel = guild ? await guild.channels.fetch(giveaway.channelId).catch(() => null) : null;
    const msg     = channel ? await channel.messages.fetch(giveaway.messageId).catch(() => null) : null;
    if (!msg) return;
    const embed = buildGiveawayEmbed(giveaway, guild);
    await msg.edit({ embeds: [embed] });
  } catch (_) {}
}

// ─── Cron: check expired giveaways ───────────────────────────────────────────
export async function checkExpiredGiveaways(client) {
  const all = await getAllActiveGiveaways();
  for (const giveaway of all) {
    if (new Date() >= new Date(giveaway.endsAt)) {
      await endGiveaway(giveaway.messageId, client);
    }
  }
}