import fs from "fs";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import {
  getWorker,
  saveWorker,
  getWorkerConfig,
  getTicket,
  saveTicket,
  getTickets,
  saveTickets
} from "../workerStorage.js";
import { sendLog } from "./logHandler.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

const POINTS_TO_REDEEM = 15;

// ─── Button: worker_claim_reward ──────────────────────────────────────────────

export async function handleClaimReward(interaction) {
  const userId  = interaction.user.id;
  const guildId = interaction.guild.id;

  const worker = await getWorker(userId);
  if (!worker || worker.status !== "accepted") {
    return interaction.reply({
      content: "❌ You are not an accepted worker.",
      ephemeral: true
    });
  }

  if ((worker.points ?? 0) < POINTS_TO_REDEEM) {
    return interaction.reply({
      content: `❌ You need **${POINTS_TO_REDEEM} points** to claim a reward. You currently have **${worker.points ?? 0}**.`,
      ephemeral: true
    });
  }

  // Check for existing open ticket for this user
  const tickets = await getTickets();
  const existingTicket = Object.values(tickets).find(
    t => t.userId === userId && t.guildId === guildId && t.status === "open"
  );
  if (existingTicket) {
    return interaction.reply({
      content: `❌ You already have an open reward ticket: <#${existingTicket.channelId}>`,
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const cfg = (await getWorkerConfig())[guildId];
  if (!cfg) {
    return interaction.editReply({ content: "❌ Worker system not configured." });
  }

  // ── Create ticket channel ─────────────────────────────────────────────────
  let ticketChannel;
  try {
    ticketChannel = await interaction.guild.channels.create({
      name:   `reward-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      type:   ChannelType.GuildText,
      topic:  `Reward claim ticket for ${interaction.user.tag}`,
      permissionOverwrites: [
        {
          id:   interaction.guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id:    userId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        },
        {
          id:    config.ownerId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels]
        },
        {
          id:    interaction.client.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages]
        }
      ]
    });
  } catch (e) {
    console.error("Ticket channel creation error:", e);
    return interaction.editReply({ content: "❌ Failed to create ticket channel. Check bot permissions." });
  }

  // ── Save ticket record ────────────────────────────────────────────────────
  await saveTicket(ticketChannel.id, {
    channelId: ticketChannel.id,
    userId,
    guildId,
    openedAt:  new Date().toISOString(),
    status:    "open",
    points:    worker.points
  });

  // ── Post ticket embed with owner panel ────────────────────────────────────
  const userEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎁 Reward Claim Ticket")
    .setDescription(
      `Hello <@${userId}>! Your reward claim has been opened.\n\n` +
      `You have **${worker.points} points**. The owner will be with you shortly to process your reward.\n\n` +
      "Please be patient and **do not spam** this channel."
    )
    .addFields(
      { name: "⭐ Points at claim", value: `${worker.points}`, inline: true },
      { name: "📅 Opened",          value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true }
    )
    .setTimestamp();

  const ownerPanel = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle("🛠 Owner Panel")
    .setDescription(
      `**Worker:** <@${userId}> (\`${userId}\`)\n` +
      `**Points:** ${worker.points}\n\n` +
      "Use the buttons below to manage this ticket."
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_fulfill_${ticketChannel.id}`)
      .setLabel("✅ Confirm Reward Given (−15 pts)")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ticket_close_${ticketChannel.id}`)
      .setLabel("🔒 Close Ticket")
      .setStyle(ButtonStyle.Danger)
  );

  await ticketChannel.send({ embeds: [userEmbed, ownerPanel], components: [row] });

  // ── Log ───────────────────────────────────────────────────────────────────
  await sendLog(interaction.client, guildId, cfg.logChannelId, {
    type:      "reward_claimed",
    userId,
    points:    worker.points,
    channelId: ticketChannel.id
  });

  await interaction.editReply({
    content: `✅ Your reward ticket has been created: <#${ticketChannel.id}>`
  });
}

// ─── Button: ticket_fulfill_<channelId> ──────────────────────────────────────

export async function handleTicketFulfill(interaction) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: "❌ Only the owner can do this.", ephemeral: true });
  }

  const channelId = interaction.customId.replace("ticket_fulfill_", "");
  const ticket    = await getTicket(channelId);

  if (!ticket) {
    return interaction.reply({ content: "❌ Ticket record not found.", ephemeral: true });
  }
  if (ticket.status !== "open") {
    return interaction.reply({ content: "⚠️ This ticket is already closed.", ephemeral: true });
  }

  await interaction.deferUpdate();

  const worker = await getWorker(ticket.userId);
  if (!worker) {
    return interaction.followUp({ content: "❌ Worker record not found.", ephemeral: true });
  }

  // Deduct 15 points atomically
  const newPoints = Math.max(0, (worker.points ?? 0) - POINTS_TO_REDEEM);
  await saveWorker(ticket.userId, { ...worker, points: newPoints });

  // Mark ticket fulfilled
  await saveTicket(channelId, { ...ticket, status: "fulfilled", fulfilledAt: new Date().toISOString() });

  const cfg = (await getWorkerConfig())[ticket.guildId];

  await sendLog(interaction.client, ticket.guildId, cfg?.logChannelId, {
    type:      "reward_fulfilled",
    userId:    ticket.userId,
    newPoints,
    channelId
  });

  // DM the worker
  try {
    const user = await interaction.client.users.fetch(ticket.userId);
    await user.send(
      `🎁 **Your reward has been confirmed!**\n` +
      `**−${POINTS_TO_REDEEM} points** deducted.\n` +
      `**Remaining points:** ${newPoints}`
    );
  } catch (_) {}

  // Update ticket message
  const fulfilledEmbed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("✅ Reward Fulfilled")
    .setDescription(
      `Reward confirmed for <@${ticket.userId}>.\n` +
      `**Points deducted:** ${POINTS_TO_REDEEM}\n` +
      `**Remaining points:** ${newPoints}`
    )
    .setTimestamp();

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_close_${channelId}`)
      .setLabel("🔒 Close Ticket")
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.message.edit({ embeds: [fulfilledEmbed], components: [closeRow] });

  await interaction.followUp({
    content: `✅ Reward confirmed. <@${ticket.userId}> now has **${newPoints} points**.`,
    ephemeral: true
  });
}

// ─── Button: ticket_close_<channelId> ────────────────────────────────────────

export async function handleTicketClose(interaction) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: "❌ Only the owner can close tickets.", ephemeral: true });
  }

  const channelId = interaction.customId.replace("ticket_close_", "");
  const ticket    = await getTicket(channelId);

  if (!ticket) {
    return interaction.reply({ content: "❌ Ticket record not found.", ephemeral: true });
  }

  await interaction.deferUpdate();

  // Mark closed
  await saveTicket(channelId, { ...ticket, status: "closed", closedAt: new Date().toISOString() });

  // Notify user
  try {
    const user = await interaction.client.users.fetch(ticket.userId);
    await user.send("🔒 Your reward ticket has been closed.");
  } catch (_) {}

  // Delete channel after short delay
  setTimeout(async () => {
    const ch = interaction.guild.channels.cache.get(channelId);
    if (ch) await ch.delete("Ticket closed").catch(() => {});
  }, 3000);
}
// ─── Button: offer_buy_<idx>_<itemName>_<cost> ────────────────────────────────

export async function handleOfferBuy(interaction) {
  const userId  = interaction.user.id;
  const guildId = interaction.guild.id;

  const worker = await getWorker(userId);
  if (!worker || worker.status !== "accepted") {
    return interaction.reply({ content: "❌ You are not an accepted worker.", ephemeral: true });
  }

  // Parse customId: offer_buy_<idx>_<encodedName>_<cost>
  // Format: offer_buy_0_ItemName_5
  const parts = interaction.customId.split("_");
  // parts: ["offer","buy","0","ItemName","5"]
  const cost     = parseInt(parts[parts.length - 1], 10);
  const itemName = parts.slice(3, parts.length - 1).join("_");

  if (isNaN(cost) || cost < 1) {
    return interaction.reply({ content: "❌ Invalid offer data.", ephemeral: true });
  }

  if ((worker.points ?? 0) < cost) {
    return interaction.reply({
      content: `❌ You need **${cost} points** for this item. You have **${worker.points ?? 0}**.`,
      ephemeral: true
    });
  }

  const cfg = (await getWorkerConfig())[guildId];
  if (!cfg) {
    return interaction.reply({ content: "❌ Worker config not found.", ephemeral: true });
  }

  // Check existing open offer ticket
  const tickets = await getTickets();
  const existing = Object.values(tickets).find(
    t => t.userId === userId && t.guildId === guildId && t.status === "open" && t.type === "offer"
  );
  if (existing) {
    return interaction.reply({
      content: `❌ You already have an open offer ticket: <#${existing.channelId}>`,
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  // Create private ticket channel
  const guild  = interaction.guild;
  const member = await guild.members.fetch(userId).catch(() => null);

  let ticketChannel;
  try {
    ticketChannel = await guild.channels.create({
      name:   `offer-${interaction.user.username}`,
      topic:  `Offer ticket for ${interaction.user.tag} — ${itemName} (${cost} pts)`,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
        { id: userId,                  allow: ["ViewChannel", "ReadMessageHistory", "SendMessages"] },
        { id: interaction.client.user.id, allow: ["ViewChannel", "ReadMessageHistory", "SendMessages", "ManageMessages"] }
      ]
    });
  } catch (e) {
    return interaction.editReply({ content: "❌ Failed to create ticket channel." });
  }

  const ticketId = ticketChannel.id;

  await saveTicket(ticketId, {
    ticketId,
    channelId: ticketId,
    guildId,
    userId,
    type:     "offer",
    item:     itemName,
    cost,
    status:   "open",
    openedAt: new Date().toISOString()
  });

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle("🛒 Offer Ticket")
    .setDescription(
      [
        `Hello <@${userId}>! You've requested to purchase:`,
        "",
        `**Item:** ${itemName}`,
        `**Cost:** ${cost} point${cost !== 1 ? "s" : ""}`,
        `**Your current points:** ${worker.points}`,
        "",
        "The owner will deliver your item and then mark it as fulfilled.",
        "**Points are deducted only when the owner confirms delivery.**"
      ].join("\n")
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`offer_fulfill_${ticketId}`)
      .setLabel("✅ Mark as Fulfilled (Owner)")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ticket_close_${ticketId}`)
      .setLabel("🔒 Close Ticket")
      .setStyle(ButtonStyle.Danger)
  );

  await ticketChannel.send({ content: `<@${userId}>`, embeds: [embed], components: [row] });

  // DM owner
  try {
    const ownerUser = await interaction.client.users.fetch(config.ownerId);
    await ownerUser.send(
      `🛒 **New offer purchase request!**\n` +
      `**User:** <@${userId}> (${interaction.user.tag})\n` +
      `**Item:** ${itemName}\n` +
      `**Cost:** ${cost} pts\n` +
      `**Ticket:** <#${ticketId}>`
    );
  } catch (_) {}

  await interaction.editReply({ content: `✅ Ticket opened: <#${ticketId}>` });
}

// ─── Button: offer_fulfill_<ticketId> ────────────────────────────────────────

export async function handleOfferFulfill(interaction) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: "❌ Only the owner can fulfil offers.", ephemeral: true });
  }

  const ticketId = interaction.customId.replace("offer_fulfill_", "");
  const ticket   = await getTicket(ticketId);

  if (!ticket || ticket.type !== "offer") {
    return interaction.reply({ content: "❌ Offer ticket not found.", ephemeral: true });
  }
  if (ticket.status !== "open") {
    return interaction.reply({ content: "⚠️ This ticket is already closed.", ephemeral: true });
  }

  await interaction.deferUpdate();

  // Deduct points
  const worker = await getWorker(ticket.userId);
  if (worker) {
    const newPoints = Math.max(0, (worker.points ?? 0) - ticket.cost);
    await saveWorker(ticket.userId, { ...worker, points: newPoints });

    // DM worker
    try {
      const user = await interaction.client.users.fetch(ticket.userId);
      await user.send(
        `✅ **Your offer purchase has been fulfilled!**\n` +
        `**Item:** ${ticket.item}\n` +
        `**Points deducted:** ${ticket.cost}\n` +
        `**Remaining points:** ${newPoints}`
      );
    } catch (_) {}
  }

  await saveTicket(ticketId, {
    ...ticket,
    status:      "fulfilled",
    fulfilledAt: new Date().toISOString()
  });

  // Update message
  const disabledRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`offer_fulfill_${ticketId}`)
      .setLabel("✅ Fulfilled")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`ticket_close_${ticketId}`)
      .setLabel("🔒 Close Ticket")
      .setStyle(ButtonStyle.Danger)
  );
  await interaction.message.edit({ components: [disabledRow] });

  // Auto-close after 10 seconds
  setTimeout(async () => {
    const ch = interaction.guild.channels.cache.get(ticketId);
    if (ch) await ch.delete("Offer fulfilled").catch(() => {});
  }, 10000);
}
