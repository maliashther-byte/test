import fs from "fs";
import {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import cron from "node-cron";

import * as setupguild from "./commands/setupguild.js";
import * as ytsetup from "./commands/ytsetup.js";
import * as genkey from "./commands/genkey.js";
import * as redeem from "./commands/redeem.js";
import * as premium from "./commands/premium.js";
import * as help from "./commands/help.js";
import * as ping from "./commands/ping.js";
import * as admin from "./handlers/admin.js";
import * as announce from "./commands/announce.js";
import * as workersetup from "./commands/workersetup.js";
import * as limitedoffer from "./commands/limitedoffer.js";

import { handleApplyButton, handleApplyModal, handleAcceptButton, handleRejectButton, handleMyStats } from "./handlers/applicationHandler.js";
import { handleLogProofButton, handleProofModal } from "./handlers/proofHandler.js";
import { handleCheckStatus, leaveNowData, executeLeavenow, checkDeadlines, checkEarlyLeaves } from "./handlers/announcementHandler.js";
import { handleClaimReward, handleTicketFulfill, handleTicketClose, handleOfferBuy, handleOfferFulfill } from "./handlers/ticketHandler.js";
import { handleAutoMod, checkAutoModRestores } from "./handlers/autoModHandler.js";
import { checkTimeouts } from "./handlers/admin.js";
import { resetAllStrikes } from "./handlers/strikeHandler.js";
import { handleOnBreakButton, handleBreakModal, handleBreakAccept, handleBreakDecline, handleEndBreakButton, checkBreaks } from "./handlers/breakHandler.js";

import {
  getYtRewards,
  getShops,
  saveShops,
  getGuildConfigs
} from "./storage.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../config.json", import.meta.url))
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

client.commands = new Collection();
client.commands.set(setupguild.data.name, setupguild);
client.commands.set(ytsetup.data.name, ytsetup);
client.commands.set(genkey.data.name, genkey);
client.commands.set(redeem.data.name, redeem);
client.commands.set(premium.data.name, premium);
client.commands.set(help.data.name, help);
client.commands.set(ping.data.name, ping);
client.commands.set(admin.data.name, admin);
client.commands.set(announce.data.name, announce);
client.commands.set(workersetup.data.name, workersetup);
client.commands.set(limitedoffer.data.name, limitedoffer);
// /leavenow is a standalone command registered via its own data object
client.commands.set(leaveNowData.name, { data: leaveNowData, execute: executeLeavenow });

client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Slash commands / buttons / modals
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;
      await cmd.execute(interaction);
    } else if (interaction.isButton()) {
      // ── Worker system buttons ───────────────────────────────────────────
      if (interaction.customId === "worker_apply") {
        return handleApplyButton(interaction);
      }
      if (interaction.customId.startsWith("worker_accept_")) {
        return handleAcceptButton(interaction);
      }
      if (interaction.customId.startsWith("worker_reject_")) {
        return handleRejectButton(interaction);
      }
      if (interaction.customId === "worker_my_stats") {
        return handleMyStats(interaction);
      }
      if (interaction.customId === "worker_log_proof") {
        return handleLogProofButton(interaction);
      }
      if (interaction.customId === "worker_check_status") {
        return handleCheckStatus(interaction);
      }
      if (interaction.customId === "worker_claim_reward") {
        return handleClaimReward(interaction);
      }
      if (interaction.customId === "worker_on_break") {
        return handleOnBreakButton(interaction);
      }
      if (interaction.customId === "worker_end_break") {
        return handleEndBreakButton(interaction);
      }
      if (interaction.customId.startsWith("break_accept_")) {
        return handleBreakAccept(interaction);
      }
      if (interaction.customId.startsWith("break_decline_")) {
        return handleBreakDecline(interaction);
      }
      if (interaction.customId.startsWith("ticket_fulfill_")) {
        return handleTicketFulfill(interaction);
      }
      if (interaction.customId.startsWith("ticket_close_")) {
        return handleTicketClose(interaction);
      }
      if (interaction.customId.startsWith("offer_buy_")) {
        return handleOfferBuy(interaction);
      }
      if (interaction.customId.startsWith("offer_fulfill_")) {
        return handleOfferFulfill(interaction);
      }

      // ── Premium / shop buttons (existing) ─────────────────────────────
      if (interaction.customId.startsWith("premium_")) {
        return premium.handlePremiumButton(interaction);
      }
      await handleShopButton(interaction);

    } else if (interaction.isStringSelectMenu()) {
      await handleShopSelect(interaction);
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId === "premium_owner_modal") {
        return premium.handlePremiumModal(interaction);
      }
      // Worker system modals
      if (interaction.customId === "worker_apply_modal") {
        return handleApplyModal(interaction);
      }
      if (interaction.customId.startsWith("worker_proof_modal_")) {
        return handleProofModal(interaction);
      }
      if (interaction.customId === "worker_break_modal") {
        return handleBreakModal(interaction);
      }
      await handleShopModal(interaction);
    }
  } catch (e) {
    console.error(e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Error executing interaction.",
        ephemeral: true
      });
    }
  }
});

// YT reward channels: auto-clean + reward
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  // ── Worker: auto-mod announcement channel ──────────────────────────────
  await handleAutoMod(message).catch(() => {});

  const ytRewards = await getYtRewards();
  const cfg = ytRewards[message.channel.id];
  if (!cfg) return;

  if (message.attachments.size > 0) {
    try {
      if (cfg.rewardType === "role" && cfg.roleId) {
        const member = await message.guild.members
          .fetch(message.author.id)
          .catch(() => null);
        if (member && !member.roles.cache.has(cfg.roleId)) {
          await member.roles.add(cfg.roleId);
        }
      } else if (cfg.rewardType === "dm" && cfg.dmText) {
        await message.author.send(cfg.dmText).catch(() => null);
      }
    } catch (e) {
      console.error("Reward error:", e);
    }
  }

  setTimeout(() => {
    message.delete().catch(() => {});
  }, 5000);
});

// ---------- SHOP HANDLERS ----------

async function handleShopButton(interaction) {
  const shops = await getShops();
  const shop = shops[interaction.channelId];

  // Owner DM buttons for requests (no channel shop)
  if (!shop) {
    if (interaction.customId.startsWith("shop_req_accept_")) {
      return handleRequestAccept(interaction, shops);
    }
    if (interaction.customId.startsWith("shop_req_confirm_")) {
      return handleRequestConfirm(interaction, shops);
    }
    return;
  }

  if (interaction.user.id !== shop.ownerId && interaction.user.id !== config.ownerId) {
    return interaction.reply({
      content: "Only the shop owner can use these buttons.",
      ephemeral: true
    });
  }

  if (interaction.customId === "shop_ping") {
    await handleShopPingButton(interaction, shop, shops);
  } else if (interaction.customId === "shop_clear") {
    await handleShopClearButton(interaction, shop, shops);
  } else if (interaction.customId === "shop_request_ping") {
    await handleShopRequestPingButton(interaction, shop, shops);
  }
}

async function handleShopSelect(interaction) {
  const shops = await getShops();
  const shop = shops[interaction.channelId];
  if (!shop) return;

  if (interaction.user.id !== shop.ownerId && interaction.user.id !== config.ownerId) {
    return interaction.reply({
      content: "Only the shop owner can use this.",
      ephemeral: true
    });
  }

  if (interaction.customId === "shop_ping_select") {
    const choice = interaction.values[0];
    const now = Date.now();
    const DAY_MS  = 24 * 60 * 60 * 1000;
    const WEEK_MS = 7 * DAY_MS;

    // ── Roll daily window ──────────────────────────────────────────────────
    if (!shop.dayResetTime) shop.dayResetTime = now;
    while (now - shop.dayResetTime >= DAY_MS) {
      shop.usedHereToday     = 0;
      shop.usedEveryoneToday = 0;
      shop.usedShopToday     = 0;
      shop.dayResetTime += DAY_MS;
    }

    // ── Roll weekly window ─────────────────────────────────────────────────
    if (!shop.weekResetTime) shop.weekResetTime = now;
    while (now - shop.weekResetTime >= WEEK_MS) {
      shop.usedHereThisWeek     = 0;
      shop.usedEveryoneThisWeek = 0;
      shop.usedShopThisWeek     = 0;
      shop.weekResetTime += WEEK_MS;
    }

    // ── Initialise all counters / budgets ──────────────────────────────────
    shop.dailyHere           = shop.dailyHere           ?? 0;
    shop.dailyEveryone       = shop.dailyEveryone       ?? 0;
    shop.dailyShop           = shop.dailyShop           ?? 0;
    shop.weeklyHere          = shop.weeklyHere          ?? 0;
    shop.weeklyEveryone      = shop.weeklyEveryone      ?? 0;
    shop.weeklyShop          = shop.weeklyShop          ?? 0;
    shop.usedHereToday       = shop.usedHereToday       ?? 0;
    shop.usedEveryoneToday   = shop.usedEveryoneToday   ?? 0;
    shop.usedShopToday       = shop.usedShopToday       ?? 0;
    shop.usedHereThisWeek    = shop.usedHereThisWeek    ?? 0;
    shop.usedEveryoneThisWeek = shop.usedEveryoneThisWeek ?? 0;
    shop.usedShopThisWeek    = shop.usedShopThisWeek    ?? 0;

    // ── Helper: ghost ping + replace persistent message ────────────────────
    async function sendPersistentPing(ghostContent, persistContent) {
      if (shop.lastPingMsgId) {
        const old = await interaction.channel.messages
          .fetch(shop.lastPingMsgId).catch(() => null);
        if (old) await old.delete().catch(() => {});
        shop.lastPingMsgId = null;
      }
      const ghost = await interaction.channel.send(ghostContent);
      await ghost.delete().catch(() => {});
      const persist = await interaction.channel.send(persistContent);
      shop.lastPingMsgId = persist.id;
    }

    // ── Resolve shop-ping role mention ─────────────────────────────────────
    const gConfigs = await getGuildConfigs();
    const gCfg = gConfigs[interaction.guild.id];
    const roleMention = gCfg?.shopPingRoleId
      ? (interaction.guild.roles.cache.get(gCfg.shopPingRoleId) ?? null)
      : null;

    // ── Handle each choice ─────────────────────────────────────────────────
    if (choice === "daily_here") {
      if (shop.usedHereToday >= shop.dailyHere) {
        const resetTs = Math.floor((shop.dayResetTime + DAY_MS) / 1000);
        return interaction.reply({ content: `No daily @here pings left. Resets <t:${resetTs}:R>.`, ephemeral: true });
      }
      shop.usedHereToday++;
      await saveShops(shops);
      await interaction.reply({ content: "Pinged @here (daily)!", ephemeral: true });
      await sendPersistentPing("@here", "🔔 **Check out this shop!** Don't miss the latest ping!");

    } else if (choice === "daily_everyone") {
      if (shop.usedEveryoneToday >= shop.dailyEveryone) {
        const resetTs = Math.floor((shop.dayResetTime + DAY_MS) / 1000);
        return interaction.reply({ content: `No daily @everyone pings left. Resets <t:${resetTs}:R>.`, ephemeral: true });
      }
      shop.usedEveryoneToday++;
      await saveShops(shops);
      await interaction.reply({ content: "Pinged @everyone (daily)!", ephemeral: true });
      await sendPersistentPing("@everyone", "🔔 **Check out this shop!** Don't miss the latest ping!");

    } else if (choice === "daily_shop") {
      if (shop.usedShopToday >= shop.dailyShop) {
        const resetTs = Math.floor((shop.dayResetTime + DAY_MS) / 1000);
        return interaction.reply({ content: `No daily shop pings left. Resets <t:${resetTs}:R>.`, ephemeral: true });
      }
      shop.usedShopToday++;
      const ghost   = roleMention ? `${roleMention} 🔔` : "🔔";
      const persist = roleMention
        ? `${roleMention} 🔔 **Check out this shop!** Don't miss the latest ping!`
        : "🔔 **Check out this shop!** Don't miss the latest ping!";
      await saveShops(shops);
      await interaction.reply({ content: "Shop pinged (daily)!", ephemeral: true });
      await sendPersistentPing(ghost, persist);

    } else if (choice === "weekly_here") {
      if (shop.usedHereThisWeek >= shop.weeklyHere) {
        const resetTs = Math.floor((shop.weekResetTime + WEEK_MS) / 1000);
        return interaction.reply({ content: `No weekly @here pings left. Resets <t:${resetTs}:R>.`, ephemeral: true });
      }
      shop.usedHereThisWeek++;
      await saveShops(shops);
      await interaction.reply({ content: "Pinged @here (weekly)!", ephemeral: true });
      await sendPersistentPing("@here", "🔔 **Check out this shop!** Don't miss the latest ping!");

    } else if (choice === "weekly_everyone") {
      if (shop.usedEveryoneThisWeek >= shop.weeklyEveryone) {
        const resetTs = Math.floor((shop.weekResetTime + WEEK_MS) / 1000);
        return interaction.reply({ content: `No weekly @everyone pings left. Resets <t:${resetTs}:R>.`, ephemeral: true });
      }
      shop.usedEveryoneThisWeek++;
      await saveShops(shops);
      await interaction.reply({ content: "Pinged @everyone (weekly)!", ephemeral: true });
      await sendPersistentPing("@everyone", "🔔 **Check out this shop!** Don't miss the latest ping!");

    } else if (choice === "weekly_shop") {
      if (shop.usedShopThisWeek >= shop.weeklyShop) {
        const resetTs = Math.floor((shop.weekResetTime + WEEK_MS) / 1000);
        return interaction.reply({ content: `No weekly shop pings left. Resets <t:${resetTs}:R>.`, ephemeral: true });
      }
      shop.usedShopThisWeek++;
      const ghost   = roleMention ? `${roleMention} 🔔` : "🔔";
      const persist = roleMention
        ? `${roleMention} 🔔 **Check out this shop!** Don't miss the latest ping!`
        : "🔔 **Check out this shop!** Don't miss the latest ping!";
      await saveShops(shops);
      await interaction.reply({ content: "Shop pinged (weekly)!", ephemeral: true });
      await sendPersistentPing(ghost, persist);
    }

    await saveShops(shops);
    await updateShopMainMessage(interaction.channel, shop);
  }
}

async function handleShopModal(interaction) {
  if (interaction.customId !== "shop_request_ping_modal") return;

  const shops = await getShops();
  const shop = shops[interaction.channelId];
  if (!shop) return;

  if (interaction.user.id !== shop.ownerId && interaction.user.id !== config.ownerId) {
    return interaction.reply({
      content: "Only the shop owner can use this.",
      ephemeral: true
    });
  }

  const pingType = interaction.fields.getTextInputValue("ping_type");
  const offer = interaction.fields.getTextInputValue("offer");

  const ownerUser = await interaction.client.users
    .fetch(config.ownerId)
    .catch(() => null);
  if (!ownerUser) {
    return interaction.reply({
      content: "Owner not found in config.",
      ephemeral: true
    });
  }

  const reqId = `${interaction.channelId}-${Date.now()}`;

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle("Ping Request")
    .setDescription(
      [
        `**Shop:** <#${shop.channelId}> (${shop.name})`,
        `**Shop Owner:** <@${shop.ownerId}>`,
        `**Requested Ping:** ${pingType}`,
        `**Offer:** ${offer}`
      ].join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`shop_req_accept_${reqId}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`shop_req_confirm_${reqId}`)
      .setLabel("Confirm received item")
      .setStyle(ButtonStyle.Primary)
  );

  await ownerUser.send({ embeds: [embed], components: [row] }).catch(() => {});

  shop.pendingRequest = {
    id: reqId,
    pingType,
    offer,
    shopChannelId: shop.channelId,
    shopOwnerId: shop.ownerId
  };
  await saveShops(shops);

  await interaction.reply({
    content: "Request sent to owner. Wait for response.",
    ephemeral: true
  });
}

async function handleShopPingButton(interaction, shop, shops) {
  const now = Date.now();
  const DAY_MS  = 24 * 60 * 60 * 1000;
  const WEEK_MS = 7 * DAY_MS;

  // ── Roll daily window ────────────────────────────────────────────────────
  if (!shop.dayResetTime) shop.dayResetTime = now;
  while (now - shop.dayResetTime >= DAY_MS) {
    shop.usedHereToday     = 0;
    shop.usedEveryoneToday = 0;
    shop.usedShopToday     = 0;
    shop.dayResetTime += DAY_MS;
  }

  // ── Roll weekly window ───────────────────────────────────────────────────
  if (!shop.weekResetTime) shop.weekResetTime = now;
  while (now - shop.weekResetTime >= WEEK_MS) {
    shop.usedHereThisWeek     = 0;
    shop.usedEveryoneThisWeek = 0;
    shop.usedShopThisWeek     = 0;
    shop.weekResetTime += WEEK_MS;
  }

  // ── Initialise all fields ────────────────────────────────────────────────
  shop.dailyHere            = shop.dailyHere            ?? 0;
  shop.dailyEveryone        = shop.dailyEveryone        ?? 0;
  shop.dailyShop            = shop.dailyShop            ?? 0;
  shop.weeklyHere           = shop.weeklyHere           ?? 0;
  shop.weeklyEveryone       = shop.weeklyEveryone       ?? 0;
  shop.weeklyShop           = shop.weeklyShop           ?? 0;
  shop.usedHereToday        = shop.usedHereToday        ?? 0;
  shop.usedEveryoneToday    = shop.usedEveryoneToday    ?? 0;
  shop.usedShopToday        = shop.usedShopToday        ?? 0;
  shop.usedHereThisWeek     = shop.usedHereThisWeek     ?? 0;
  shop.usedEveryoneThisWeek = shop.usedEveryoneThisWeek ?? 0;
  shop.usedShopThisWeek     = shop.usedShopThisWeek     ?? 0;

  await saveShops(shops);

  const dayResetTs  = Math.floor((shop.dayResetTime  + DAY_MS)  / 1000);
  const weekResetTs = Math.floor((shop.weekResetTime + WEEK_MS) / 1000);

  const options = [];

  // Daily options
  if (shop.dailyHere > 0 && shop.usedHereToday < shop.dailyHere) {
    options.push({ label: `📅 @here — daily (${shop.usedHereToday}/${shop.dailyHere}, resets <soon>)`, value: "daily_here" });
  }
  if (shop.dailyEveryone > 0 && shop.usedEveryoneToday < shop.dailyEveryone) {
    options.push({ label: `📅 @everyone — daily (${shop.usedEveryoneToday}/${shop.dailyEveryone})`, value: "daily_everyone" });
  }
  if (shop.dailyShop > 0 && shop.usedShopToday < shop.dailyShop) {
    options.push({ label: `📅 Shop ping — daily (${shop.usedShopToday}/${shop.dailyShop})`, value: "daily_shop" });
  }

  // Weekly options
  if (shop.weeklyHere > 0 && shop.usedHereThisWeek < shop.weeklyHere) {
    options.push({ label: `📆 @here — weekly (${shop.usedHereThisWeek}/${shop.weeklyHere})`, value: "weekly_here" });
  }
  if (shop.weeklyEveryone > 0 && shop.usedEveryoneThisWeek < shop.weeklyEveryone) {
    options.push({ label: `📆 @everyone — weekly (${shop.usedEveryoneThisWeek}/${shop.weeklyEveryone})`, value: "weekly_everyone" });
  }
  if (shop.weeklyShop > 0 && shop.usedShopThisWeek < shop.weeklyShop) {
    options.push({ label: `📆 Shop ping — weekly (${shop.usedShopThisWeek}/${shop.weeklyShop})`, value: "weekly_shop" });
  }

  if (options.length === 0) {
    return interaction.reply({
      content:
        `No pings available right now.\n` +
        `📅 Daily resets: <t:${dayResetTs}:R>\n` +
        `📆 Weekly resets: <t:${weekResetTs}:R>`,
      ephemeral: true
    });
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("shop_ping_select")
      .setPlaceholder("Select ping type")
      .addOptions(options)
  );

  await interaction.reply({
    content:
      `Choose a ping type:\n📅 Daily resets <t:${dayResetTs}:R> · 📆 Weekly resets <t:${weekResetTs}:R>`,
    components: [row],
    ephemeral: true
  });
}

async function handleShopClearButton(interaction, shop, shops) {
  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.channel;
  const mainId = shop.mainMessageId;

  const messages = await channel.messages.fetch({ limit: 100 });
  const toDelete = messages.filter(m => m.id !== mainId);
  if (toDelete.size > 0) {
    await channel.bulkDelete(toDelete, true).catch(() => {});
  }

  await interaction.editReply({
    content: "Channel cleared (main message kept)."
  });
}

async function handleShopRequestPingButton(interaction, shop, shops) {
  const modal = new ModalBuilder()
    .setCustomId("shop_request_ping_modal")
    .setTitle("Request Extra Ping");

  const pingTypeInput = new TextInputBuilder()
    .setCustomId("ping_type")
    .setLabel("Ping Type (e.g., @here, @everyone, shop ping)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const offerInput = new TextInputBuilder()
    .setCustomId("offer")
    .setLabel("What are you offering?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  const row1 = new ActionRowBuilder().addComponents(pingTypeInput);
  const row2 = new ActionRowBuilder().addComponents(offerInput);

  modal.addComponents(row1, row2);

  await interaction.showModal(modal);
}

async function handleRequestAccept(interaction, shops) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: "Not for you.", ephemeral: true });
  }

  const reqId = interaction.customId.replace("shop_req_accept_", "");
  const shop = Object.values(shops).find(
    s => s.pendingRequest && s.pendingRequest.id === reqId
  );
  if (!shop) {
    return interaction.reply({
      content: "Request not found.",
      ephemeral: true
    });
  }

  const user = await interaction.client.users
    .fetch(shop.shopOwnerId)
    .catch(() => null);
  if (user) {
    await user
      .send(
        "Your ping request was **accepted**.\n" +
          "Open a ticket / DM the owner, give the item. After they confirm, you will get an extra ping."
      )
      .catch(() => {});
  }

  await interaction.reply({
    content: "Accepted. Wait for confirm.",
    ephemeral: true
  });
}

async function handleRequestConfirm(interaction, shops) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: "Not for you.", ephemeral: true });
  }

  const reqId = interaction.customId.replace("shop_req_confirm_", "");
  const shop = Object.values(shops).find(
    s => s.pendingRequest && s.pendingRequest.id === reqId
  );
  if (!shop) {
    return interaction.reply({
      content: "Request not found.",
      ephemeral: true
    });
  }

  const pingType = shop.pendingRequest.pingType.toLowerCase();
  let pingCategory = "here";
  if (pingType.includes("everyone")) {
    pingCategory = "everyone";
  } else if (pingType.includes("shop")) {
    pingCategory = "shop";
  }

  if (pingCategory === "here") {
    shop.dailyHere = (shop.dailyHere ?? 0) + 1;
  } else if (pingCategory === "everyone") {
    shop.dailyEveryone = (shop.dailyEveryone ?? 0) + 1;
  } else if (pingCategory === "shop") {
    shop.dailyShop = (shop.dailyShop ?? 0) + 1;
  }

  const user = await interaction.client.users
    .fetch(shop.shopOwnerId)
    .catch(() => null);
  if (user) {
    await user
      .send(
        `Owner confirmed item received. You gained **+1 ${
          pingCategory === "here" ? "@here" : pingCategory === "everyone" ? "@everyone" : "shop ping"
        }** per day.`
      )
      .catch(() => {});
  }

  delete shop.pendingRequest;
  await saveShops(shops);

  const guild = await interaction.client.guilds
    .fetch(shop.guildId)
    .catch(() => null);
  if (guild) {
    const channel = await guild.channels
      .fetch(shop.channelId)
      .catch(() => null);
    if (channel) {
      await updateShopMainMessage(channel, shop);
    }
  }

  await interaction.reply({
    content: "Confirmed and extra ping granted.",
    ephemeral: true
  });
}

async function updateShopMainMessage(channel, shop) {
  const msg = await channel.messages.fetch(shop.mainMessageId).catch(() => null);
  if (!msg) return;

  shop.dailyHere            = shop.dailyHere            ?? 0;
  shop.dailyEveryone        = shop.dailyEveryone        ?? 0;
  shop.dailyShop            = shop.dailyShop            ?? 0;
  shop.weeklyHere           = shop.weeklyHere           ?? 0;
  shop.weeklyEveryone       = shop.weeklyEveryone       ?? 0;
  shop.weeklyShop           = shop.weeklyShop           ?? 0;
  shop.usedHereToday        = shop.usedHereToday        ?? 0;
  shop.usedEveryoneToday    = shop.usedEveryoneToday    ?? 0;
  shop.usedShopToday        = shop.usedShopToday        ?? 0;
  shop.usedHereThisWeek     = shop.usedHereThisWeek     ?? 0;
  shop.usedEveryoneThisWeek = shop.usedEveryoneThisWeek ?? 0;
  shop.usedShopThisWeek     = shop.usedShopThisWeek     ?? 0;

  const embed = EmbedBuilder.from(msg.embeds[0] ?? {});
  const descLines = (embed.data.description || "").split("\n");
  const idx = descLines.findIndex(l => l.startsWith("**Mention usage"));
  if (idx !== -1 && descLines[idx + 1] !== undefined) {
    descLines[idx + 1] =
      `📅 Daily — @here: ${shop.usedHereToday}/${shop.dailyHere} | @everyone: ${shop.usedEveryoneToday}/${shop.dailyEveryone} | shop: ${shop.usedShopToday}/${shop.dailyShop}\n` +
      `📆 Weekly — @here: ${shop.usedHereThisWeek}/${shop.weeklyHere} | @everyone: ${shop.usedEveryoneThisWeek}/${shop.weeklyEveryone} | shop: ${shop.usedShopThisWeek}/${shop.weeklyShop}`;
  }
  embed.setDescription(descLines.join("\n"));

  await msg.edit({ embeds: [embed], components: msg.components });
}

// Cron: check shop expiry + 1h warning
cron.schedule("*/5 * * * *", async () => {
  const shops = await getShops();
  const now = Date.now();

  for (const [channelId, shop] of Object.entries(shops)) {
    const guild = await client.guilds.fetch(shop.guildId).catch(() => null);
    if (!guild) continue;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) continue;

    const timeLeft = shop.expiresAt - now;

    if (!shop.warned && timeLeft <= 60 * 60 * 1000 && timeLeft > 0) {
      shop.warned = true;
      await saveShops(shops);
      const owner = await guild.members.fetch(shop.ownerId).catch(() => null);
      if (owner) {
        await channel
          .send(`${owner}, your shop expires in less than 1 hour.`)
          .catch(() => {});
      }
    }

    if (timeLeft <= 0) {
      await channel
        .send("This shop slot has expired and will be deleted.")
        .catch(() => {});
      await channel.delete().catch(() => {});
      delete shops[channelId];
      await saveShops(shops);
    }
  }
});

// ─── Worker system: check deadlines & early leaves every 5 minutes ─────────

cron.schedule("*/5 * * * *", async () => {
  await checkDeadlines(client).catch(e => console.error("[Cron/deadlines]", e));
  await checkEarlyLeaves(client).catch(e => console.error("[Cron/earlyLeaves]", e));
  await checkBreaks(client).catch(e => console.error("[Cron/breaks]", e));
});

// ─── Worker system: restore timed-out roles + automod roles every minute ────

cron.schedule("* * * * *", async () => {
  await checkTimeouts(client).catch(e => console.error("[Cron/timeouts]", e));
  await checkAutoModRestores(client).catch(e => console.error("[Cron/autoModRestores]", e));
});

// ─── Worker system: weekly strike reset (every Monday 00:00 UTC) ────────────

cron.schedule("0 0 * * 1", async () => {
  const { getWorkerConfig: gwc } = await import("./workerStorage.js");
  const cfgs = await gwc();
  for (const guildId of Object.keys(cfgs)) {
    await resetAllStrikes(guildId).catch(e => console.error("[WeeklyReset]", e));
  }
});

client.login(config.token);