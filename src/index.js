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

// Games
import * as gamesSetup      from "./games/gamesSetup.js";
import * as gamesHost        from "./games/gamesHost.js";
import * as gamesTranscript  from "./games/gamesTranscript.js";
import {
  handleHostPanel, handleSelectMode, handleStartGame,
  handleLastWinners, handleRules, handleLeaderboard,
  handleGameMessage, handleHintButton, handleEndGame,
  handleBattleRoyaleButton, handleGameModal, handlePrizeModal, MODES
} from "./games/gamesHost.js";
import { handleTranscriptSelect } from "./games/gamesTranscript.js";

// Utilities (removed ping manager)
import { handleStickyCommand, handleStickyOnMessage } from "./utilities/stickyMessage.js";
import * as autoReactor from "./utilities/autoReactor.js";
import { sayData, sayEmbedData, editData, executeSay, executeSayEmbed, executeEdit, handleSayEmbedModal } from "./utilities/sendAsBot.js";
import { handleSaveCommand, panelData, executePanel, handlePanelSaveEmbed, handlePanelList, handlePanelDeploy, handlePanelSaveEmbedModal, handlePanelDeployModal } from "./utilities/savedMessages.js";
import { leaderboardData, resetLeaderboardData, executeLeaderboard, executeResetLeaderboard, trackMessage } from "./utilities/leaderboard.js";
import { data as reactorPanelData, execute as executeReactorPanel, handleReactorPanelButton } from "./utilities/reactorPanel.js";
import { data as shopPanelData, execute as executeShopPanel, handleShopPanelButton } from "./utilities/shopPanel.js";

// Worker panel
import { data as workerPanelData, execute as executeWorkerPanel, handleWorkerPanelButton, handleWorkerPanelModal } from "./handlers/workerPanel.js";

// Giveaway
import {
  gcreateData, gendData, grerollData, glistData, gsetwinnerData, gcancelData,
  executeGCreate, executeGEnd, executeGReroll, executeGList, executeGSetWinner, executeGCancel,
  giveawayPanelData, geditData, gchoosewinnerData, extraEntriesData,
  executeGiveawayPanel, executeGEdit, executeGChooseWinner, executeExtraEntries
} from "./giveaway/giveawayCommands.js";
import {
  handleEnterButton, handleMyEntries, handleRequirementModal,
  handleShortAnswerApprove, handleShortAnswerReject,
  checkExpiredGiveaways, trackMessageCount, handleMemberLeaveCheck
} from "./giveaway/giveawayManager.js";

// Shop utilities
import * as openshop  from "./commands/openshop.js";
import * as shoptrial from "./commands/shoptrial.js";

import { handleApplyButton, handleApplyModal, handleAcceptButton, handleRejectButton, handleMyStats, handleVerifyButton } from "./handlers/applicationHandler.js";
import { handleLogProofButton, handleProofModal } from "./handlers/proofHandler.js";
import { handleCheckStatus, checkDeadlines, handleLogRemovePoint } from "./handlers/announcementHandler.js";
import { handlePunishButton, handlePunishModal } from "./handlers/punishHandler.js";
import { handleClaimReward, handleTicketFulfill, handleTicketClose, handleOfferBuy, handleOfferFulfill } from "./handlers/ticketHandler.js";
import { handleAutoMod, checkAutoModRestores } from "./handlers/autoModHandler.js";
import { checkTimeouts } from "./handlers/admin.js";
import { resetAllStrikes, addStrike, removeStrike } from "./handlers/strikeHandler.js";
import { handleOnBreakButton, handleBreakModal, handleBreakAccept, handleBreakDecline, handleEndBreakButton, checkBreaks } from "./handlers/breakHandler.js";
import { sendLog } from "./handlers/logHandler.js";

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
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

client.commands = new Collection();
// Existing commands
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
client.commands.set(openshop.data.name, openshop);
client.commands.set(shoptrial.data.name, shoptrial);

// Games
client.commands.set(gamesSetup.data.name, gamesSetup);
client.commands.set(gamesHost.data.name, gamesHost);
client.commands.set("hint",       { data: gamesHost.hintData,   execute: gamesHost.executeHint });
client.commands.set(gamesTranscript.data.name, gamesTranscript);

// Utilities (no ping manager)
client.commands.set("autoreact",          autoReactor);
client.commands.set("say",                { data: sayData,              execute: executeSay });
client.commands.set("sayembed",           { data: sayEmbedData,         execute: executeSayEmbed });
client.commands.set("editmsg",            { data: editData,             execute: executeEdit });
client.commands.set("panel",              { data: panelData,            execute: executePanel });
client.commands.set("leaderboard",        { data: leaderboardData,      execute: executeLeaderboard });
client.commands.set("resetleaderboard",   { data: resetLeaderboardData, execute: executeResetLeaderboard });
client.commands.set("reactorpanel",       { data: reactorPanelData,     execute: executeReactorPanel });
client.commands.set("shoppanel",          { data: shopPanelData,        execute: executeShopPanel });

// Worker panel
client.commands.set("workerspanel",       { data: workerPanelData,      execute: executeWorkerPanel });

// Giveaway
client.commands.set("gcreate",            { data: gcreateData,          execute: executeGCreate });
client.commands.set("gend",               { data: gendData,             execute: executeGEnd });
client.commands.set("greroll",            { data: grerollData,          execute: executeGReroll });
client.commands.set("glist",              { data: glistData,            execute: executeGList });
client.commands.set("gsetwinner",         { data: gsetwinnerData,       execute: executeGSetWinner });
client.commands.set("gcancel",            { data: gcancelData,          execute: executeGCancel });
client.commands.set("giveawaypanel",      { data: giveawayPanelData,    execute: executeGiveawayPanel });
client.commands.set("gedit",              { data: geditData,            execute: executeGEdit });
client.commands.set("gchoosewinner",      { data: gchoosewinnerData,    execute: executeGChooseWinner });
client.commands.set("extra-entries",      { data: extraEntriesData,     execute: executeExtraEntries });

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // ── Boot-time recovery: delete expired shops & reset overdue pings ────────
  try {
    const shops  = await getShops();
    const now    = Date.now();
    const DAY_MS    = 24 * 60 * 60 * 1000;
    const WEEK_MS   = 7  * DAY_MS;
    const TRIDAY_MS = 3  * DAY_MS;
    let changed = false;

    for (const [channelId, shop] of Object.entries(shops)) {
      // Delete expired shops whose channels still exist
      if (now >= shop.expiresAt) {
        const guild = await client.guilds.fetch(shop.guildId).catch(() => null);
        if (guild) {
          const ch = await guild.channels.fetch(channelId).catch(() => null);
          if (ch) await ch.delete("Shop expired while bot was offline").catch(() => {});
        }
        delete shops[channelId];
        changed = true;
        continue;
      }

      // Roll daily resets that passed while offline
      if (shop.dayResetTime) {
        while (now - shop.dayResetTime >= DAY_MS) {
          shop.usedHereToday = 0; shop.usedEveryoneToday = 0; shop.usedShopToday = 0;
          shop.dayResetTime += DAY_MS;
          changed = true;
        }
      }
      // Roll weekly resets
      if (shop.weekResetTime) {
        while (now - shop.weekResetTime >= WEEK_MS) {
          shop.usedHereThisWeek = 0; shop.usedEveryoneThisWeek = 0; shop.usedShopThisWeek = 0;
          shop.weekResetTime += WEEK_MS;
          changed = true;
        }
      }
      // Roll 3-day resets
      if (shop.tridayResetTime) {
        while (now - shop.tridayResetTime >= TRIDAY_MS) {
          shop.usedHereThisTriday = 0; shop.usedEveryoneThisTriday = 0; shop.usedShopThisTriday = 0;
          shop.tridayResetTime += TRIDAY_MS;
          changed = true;
        }
      }
    }

    if (changed) {
      await saveShops(shops);
      console.log("[Boot] Shop expiry check + ping reset done.");
    }
  } catch (e) {
    console.error("[Boot/shopRecovery]", e);
  }
});

// ─── guildMemberRemove ────────────────────────────────────────────────────────
client.on(Events.GuildMemberRemove, async member => {
  try {
    const { getWorker } = await import("./workerStorage.js");
    const { getWorkerConfig } = await import("./workerStorage.js");

    const worker = await getWorker(member.id);
    if (worker?.status === "accepted" && worker.guildId === member.guild.id) {
      const cfgs = await getWorkerConfig();
      const cfg  = cfgs[member.guild.id];
      if (cfg) {
        await addStrike(member.id, null, "early_leave", cfg, client);
        await sendLog(client, member.guild.id, cfg.logChannelId, { type: "member_left", userId: member.id });
      }
    }
  } catch (err) { console.error("[GuildMemberRemove/worker]", err); }

  // Giveaway: remove from join_server entries
  await handleMemberLeaveCheck(member, client).catch(e => console.error("[GuildMemberRemove/giveaway]", e));
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;
      await cmd.execute(interaction);
    } else if (interaction.isButton()) {
      const id = interaction.customId;

      // ── Help ────────────────────────────────────────────────────────────
      if (id.startsWith("help_"))                return help.handleHelpButton(interaction);

      // ── Games ───────────────────────────────────────────────────────────
      if (id === "games_last_winners")           return handleLastWinners(interaction);
      if (id === "games_host_panel")             return handleHostPanel(interaction);
      if (id === "games_rules")                  return handleRules(interaction);
      if (id === "games_leaderboard")            return handleLeaderboard(interaction);
      if (id.startsWith("games_start_"))         return handleStartGame(interaction);
      if (id.startsWith("game_hint_"))           return handleHintButton(interaction);
      if (id.startsWith("game_end_"))            return handleEndGame(interaction);
      if (id.startsWith("game_trivia_join_") || id.startsWith("game_trivia_start_") ||
          id.startsWith("game_task_setwinner_") || id.startsWith("game_task_close_") ||
          id.startsWith("game_task_nowinner_"))   return handleBattleRoyaleButton(interaction);

      // ── Giveaway ────────────────────────────────────────────────────────
      if (id === "giveaway_enter")               return handleEnterButton(interaction);
      if (id === "giveaway_myentries")           return handleMyEntries(interaction);
      if (id.startsWith("giveaway_approve_"))    return handleShortAnswerApprove(interaction);
      if (id.startsWith("giveaway_reject_"))     return handleShortAnswerReject(interaction);

      // ── Panel ───────────────────────────────────────────────────────────
      if (id === "panel_save_embed")             return handlePanelSaveEmbed(interaction);
      if (id === "panel_list")                   return handlePanelList(interaction);
      if (id === "panel_deploy")                 return handlePanelDeploy(interaction);

      // ── Reactor panel ───────────────────────────────────────────────────
      if (id.startsWith("reactor_remove_"))      return handleReactorPanelButton(interaction);

      // ── Shop panel ──────────────────────────────────────────────────────
      if (id.startsWith("shoppanel_"))           return handleShopPanelButton(interaction);

      // ── Worker panel ────────────────────────────────────────────────────
      if (id.startsWith("wp_"))                  return handleWorkerPanelButton(interaction);

      // ── Worker system buttons ───────────────────────────────────────────
      if (id.startsWith("worker_verify_"))       return handleVerifyButton(interaction);
      if (id === "worker_apply")                 return handleApplyButton(interaction);
      if (id.startsWith("worker_accept_"))       return handleAcceptButton(interaction);
      if (id.startsWith("worker_reject_"))       return handleRejectButton(interaction);
      if (id === "worker_my_stats")              return handleMyStats(interaction);
      if (id === "worker_log_proof")             return handleLogProofButton(interaction);
      if (id === "worker_check_status")          return handleCheckStatus(interaction);
      if (id === "worker_claim_reward")          return handleClaimReward(interaction);
      if (id === "worker_on_break")              return handleOnBreakButton(interaction);
      if (id === "worker_end_break")             return handleEndBreakButton(interaction);
      if (id.startsWith("break_accept_"))        return handleBreakAccept(interaction);
      if (id.startsWith("break_decline_"))       return handleBreakDecline(interaction);
      if (id.startsWith("ticket_fulfill_"))      return handleTicketFulfill(interaction);
      if (id.startsWith("ticket_close_"))        return handleTicketClose(interaction);
      if (id.startsWith("offer_buy_"))           return handleOfferBuy(interaction);
      if (id.startsWith("offer_fulfill_"))       return handleOfferFulfill(interaction);
      if (id.startsWith("log_remove_point_"))    return handleLogRemovePoint(interaction);
      if (id.startsWith("log_punish_"))          return handlePunishButton(interaction);
      if (id.startsWith("log_remove_strike_"))   return handleWorkerRemoveStrikeFromLog(interaction);
      if (id.startsWith("worker_add_strike_log_")) return handleWorkerAddStrikeFromLog(interaction);
      if (id.startsWith("worker_remove_strike_"))  return handleWorkerRemoveStrikeFromLog(interaction);

      // ── Premium / shop ──────────────────────────────────────────────────
      if (id.startsWith("premium_"))             return premium.handlePremiumButton(interaction);
      await handleShopButton(interaction);

    } else if (interaction.isStringSelectMenu()) {
      const id = interaction.customId;
      if (id === "games_select_mode")            return handleSelectMode(interaction);
      if (id === "transcript_select")            return handleTranscriptSelect(interaction);
      await handleShopSelect(interaction);

    } else if (interaction.isModalSubmit()) {
      const id = interaction.customId;

      // Games modals
      if (id.startsWith("games_prize_modal_"))   return handlePrizeModal(interaction);
      if (id.startsWith("game_task_winner_modal_")) return handleGameModal(interaction);

      // Giveaway modals
      if (id.startsWith("giveaway_req_"))        return handleRequirementModal(interaction);

      // Panel modals
      if (id === "panel_save_embed_modal")       return handlePanelSaveEmbedModal(interaction);
      if (id === "panel_deploy_modal")           return handlePanelDeployModal(interaction);

      // Send as bot
      if (id.startsWith("sayembed_modal_"))      return handleSayEmbedModal(interaction);

      // Worker panel modals
      if (id.startsWith("wp_timeout_modal_") || id.startsWith("wp_ban_modal_") ||
          id.startsWith("wp_removestrike_modal_") || id.startsWith("wp_punish_modal_"))
        return handleWorkerPanelModal(interaction);

      // Worker system modals
      if (id === "premium_owner_modal")          return premium.handlePremiumModal(interaction);
      if (id === "worker_apply_modal")           return handleApplyModal(interaction);
      if (id.startsWith("worker_proof_modal_"))  return handleProofModal(interaction);
      if (id === "worker_break_modal")           return handleBreakModal(interaction);
      if (id.startsWith("punish_modal_"))        return handlePunishModal(interaction);
      if (id.startsWith("strike_remove_reason_")) return handleStrikeRemoveReasonModal(interaction);
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

// ─── Message Create ───────────────────────────────────────────────────────────
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  // ?save command
  await handleSaveCommand(message).catch(() => {});

  // Worker auto-mod (announcement + application channel lock)
  await handleAutoMod(message).catch(() => {});

  // Games: route to active game OR delete if no game running
  await handleGameMessage(message).catch(() => {});

  // Sticky messages
  await handleStickyCommand(message).catch(() => {});
  await handleStickyOnMessage(message).catch(() => {});

  // Auto-react
  await autoReactor.handleAutoReact(message).catch(() => {});

  // Leaderboard message tracking
  await trackMessage(message).catch(() => {});

  // Giveaway message count tracking (for message_count requirement)
  await trackMessageCount(message).catch(() => {});

  // ── Shop attachment allowance ─────────────────────────────────────────
  // Shop owners can send messages and attach files in their channel
  const shops = await getShops();
  const shop  = shops[message.channel.id];
  if (shop && message.author.id === shop.ownerId && message.attachments.size > 0) {
    // Allow — do nothing, let it stay
    return;
  }

  // ── YT reward channels ────────────────────────────────────────────────
  const ytRewards = await getYtRewards();
  const cfg = ytRewards[message.channel.id];
  if (!cfg) return;

  if (message.attachments.size > 0) {
    try {
      if (cfg.rewardType === "role" && cfg.roleId) {
        const member = await message.guild.members.fetch(message.author.id).catch(() => null);
        if (member && !member.roles.cache.has(cfg.roleId)) {
          await member.roles.add(cfg.roleId);
        }
      } else if (cfg.rewardType === "dm" && cfg.dmText) {
        await message.author.send(cfg.dmText).catch(() => null);
      }
    } catch (e) {
      console.error("YT Reward error:", e);
    }
  }

  setTimeout(() => { message.delete().catch(() => {}); }, 5000);
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
    return interaction.reply({ content: "Only the shop owner can use these buttons.", ephemeral: true });
  }

  if (interaction.customId === "shop_ping_select") {
    const choice = interaction.values[0];
    const now      = Date.now();
    const DAY_MS   = 24 * 60 * 60 * 1000;
    const WEEK_MS  = 7 * DAY_MS;
    const TRIDAY_MS = 3 * DAY_MS;

    // Cooldowns: @everyone = 2 days, @here = 1 day, shop = 1 day
    const COOLDOWNS = { here: DAY_MS, everyone: 2 * DAY_MS, shop: DAY_MS };

    // Roll daily window
    if (!shop.dayResetTime) shop.dayResetTime = now;
    while (now - shop.dayResetTime >= DAY_MS) {
      shop.usedHereToday = 0; shop.usedEveryoneToday = 0; shop.usedShopToday = 0;
      shop.dayResetTime += DAY_MS;
    }
    // Roll weekly window
    if (!shop.weekResetTime) shop.weekResetTime = now;
    while (now - shop.weekResetTime >= WEEK_MS) {
      shop.usedHereThisWeek = 0; shop.usedEveryoneThisWeek = 0; shop.usedShopThisWeek = 0;
      shop.weekResetTime += WEEK_MS;
    }
    // Roll 3-day window
    if (!shop.tridayResetTime) shop.tridayResetTime = now;
    while (now - shop.tridayResetTime >= TRIDAY_MS) {
      shop.usedHereThisTriday = 0; shop.usedEveryoneThisTriday = 0; shop.usedShopThisTriday = 0;
      shop.tridayResetTime += TRIDAY_MS;
    }

    // Init all counters
    ["dailyHere","dailyEveryone","dailyShop","weeklyHere","weeklyEveryone","weeklyShop",
     "tridayHere","tridayEveryone","tridayShop",
     "usedHereToday","usedEveryoneToday","usedShopToday",
     "usedHereThisWeek","usedEveryoneThisWeek","usedShopThisWeek",
     "usedHereThisTriday","usedEveryoneThisTriday","usedShopThisTriday",
     "lastHerePingAt","lastEveryonePingAt","lastShopPingAt"
    ].forEach(k => { if (shop[k] == null) shop[k] = 0; });

    // Cooldown check
    const pingType = choice.includes("here") ? "here" : choice.includes("everyone") ? "everyone" : "shop";
    const cooldownMs = COOLDOWNS[pingType];
    const lastPingKey = `last${pingType.charAt(0).toUpperCase() + pingType.slice(1)}PingAt`;
    if (now - (shop[lastPingKey] ?? 0) < cooldownMs) {
      const cooldownEnd = Math.floor(((shop[lastPingKey] ?? 0) + cooldownMs) / 1000);
      return interaction.reply({ content: `⏳ Cooldown! This ping is available again <t:${cooldownEnd}:R>.`, ephemeral: true });
    }

    // Resolve role mention
    const gConfigs2 = await getGuildConfigs();
    const gCfg2 = gConfigs2[interaction.guild.id];
    const roleMention = gCfg2?.shopPingRoleId
      ? (interaction.guild.roles.cache.get(gCfg2.shopPingRoleId)?.toString() ?? "")
      : "";

    // Ping content format: # (@ping)\n🔔Check out this shop
    function pingContent(mention) { return `# ${mention}\n🔔Check out this shop`; }

    // Delete old, send new persistent ping (no auto-delete)
    async function sendPersistentPing(ghostMention, displayMention) {
      if (shop.lastPingMsgId) {
        const old = await interaction.channel.messages.fetch(shop.lastPingMsgId).catch(() => null);
        if (old) await old.delete().catch(() => {});
        shop.lastPingMsgId = null;
      }
      const ghost = await interaction.channel.send(ghostMention);
      await ghost.delete().catch(() => {});
      const persist = await interaction.channel.send(pingContent(displayMention));
      shop.lastPingMsgId = persist.id;
    }

    // Handle each choice
    const budgets = {
      daily_here:       { used: "usedHereToday",         max: "dailyHere",         reset: shop.dayResetTime + DAY_MS,      ghost: "@here",                        display: "@here" },
      daily_everyone:   { used: "usedEveryoneToday",     max: "dailyEveryone",     reset: shop.dayResetTime + DAY_MS,      ghost: "@everyone",                    display: "@everyone" },
      daily_shop:       { used: "usedShopToday",         max: "dailyShop",         reset: shop.dayResetTime + DAY_MS,      ghost: roleMention || "@here",         display: roleMention || "@here" },
      weekly_here:      { used: "usedHereThisWeek",      max: "weeklyHere",        reset: shop.weekResetTime + WEEK_MS,    ghost: "@here",                        display: "@here" },
      weekly_everyone:  { used: "usedEveryoneThisWeek",  max: "weeklyEveryone",    reset: shop.weekResetTime + WEEK_MS,    ghost: "@everyone",                    display: "@everyone" },
      weekly_shop:      { used: "usedShopThisWeek",      max: "weeklyShop",        reset: shop.weekResetTime + WEEK_MS,    ghost: roleMention || "@here",         display: roleMention || "@here" },
      triday_here:      { used: "usedHereThisTriday",    max: "tridayHere",        reset: shop.tridayResetTime + TRIDAY_MS,ghost: "@here",                        display: "@here" },
      triday_everyone:  { used: "usedEveryoneThisTriday",max: "tridayEveryone",    reset: shop.tridayResetTime + TRIDAY_MS,ghost: "@everyone",                    display: "@everyone" },
      triday_shop:      { used: "usedShopThisTriday",    max: "tridayShop",        reset: shop.tridayResetTime + TRIDAY_MS,ghost: roleMention || "@here",         display: roleMention || "@here" },
    };

    const b = budgets[choice];
    if (!b) return interaction.reply({ content: "❌ Unknown ping type.", ephemeral: true });

    if (shop[b.used] >= shop[b.max]) {
      return interaction.reply({ content: `❌ No ${choice.replace("_"," ")} pings left. Resets <t:${Math.floor(b.reset/1000)}:R>.`, ephemeral: true });
    }

    shop[b.used]++;
    shop[lastPingKey] = now;
    await saveShops(shops);
    await interaction.reply({ content: `✅ ${choice.replace("_"," ")} ping sent!`, ephemeral: true });
    await sendPersistentPing(b.ghost, b.display);

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

  // Normalise all counters / budgets to avoid undefined
  const fields = [
    "dailyHere","dailyEveryone","dailyShop",
    "weeklyHere","weeklyEveryone","weeklyShop",
    "tridayHere","tridayEveryone","tridayShop",
    "usedHereToday","usedEveryoneToday","usedShopToday",
    "usedHereThisWeek","usedEveryoneThisWeek","usedShopThisWeek",
    "usedHereThisTriday","usedEveryoneThisTriday","usedShopThisTriday"
  ];
  for (const f of fields) shop[f] = shop[f] ?? 0;

  // Fetch guild config for pfp/banner
  const gConfigs  = await getGuildConfigs();
  const gCfg      = gConfigs[shop.guildId] ?? {};
  const pfpUrl    = gCfg.pfpUrl    ?? config.freePfpUrl;
  const bannerUrl = gCfg.bannerUrl ?? config.freeBannerUrl;

  const expiresTs = Math.floor(shop.expiresAt / 1000);
  const isPremium = gCfg.plan === "premium";

  // Reset timestamps for display
  const DAY_MS    = 24 * 60 * 60 * 1000;
  const WEEK_MS   = 7  * DAY_MS;
  const TRIDAY_MS = 3  * DAY_MS;
  const dayResetTs    = Math.floor(((shop.dayResetTime    ?? Date.now()) + DAY_MS)    / 1000);
  const weekResetTs   = Math.floor(((shop.weekResetTime   ?? Date.now()) + WEEK_MS)   / 1000);
  const tridayResetTs = Math.floor(((shop.tridayResetTime ?? Date.now()) + TRIDAY_MS) / 1000);

  const pingTable =
    `\`\`\`\n` +
    `Type         | Used  | Max  | Resets\n` +
    `-------------|-------|------|--------\n` +
    `📅 @here     | ${String(shop.usedHereToday).padEnd(5)} | ${String(shop.dailyHere).padEnd(4)} | <t:${dayResetTs}:R>\n` +
    `📅 @everyone | ${String(shop.usedEveryoneToday).padEnd(5)} | ${String(shop.dailyEveryone).padEnd(4)} | <t:${dayResetTs}:R>\n` +
    `📅 Shop ping | ${String(shop.usedShopToday).padEnd(5)} | ${String(shop.dailyShop).padEnd(4)} | <t:${dayResetTs}:R>\n` +
    `📆 @here     | ${String(shop.usedHereThisWeek).padEnd(5)} | ${String(shop.weeklyHere).padEnd(4)} | <t:${weekResetTs}:R>\n` +
    `📆 @everyone | ${String(shop.usedEveryoneThisWeek).padEnd(5)} | ${String(shop.weeklyEveryone).padEnd(4)} | <t:${weekResetTs}:R>\n` +
    `📆 Shop ping | ${String(shop.usedShopThisWeek).padEnd(5)} | ${String(shop.weeklyShop).padEnd(4)} | <t:${weekResetTs}:R>\n` +
    `🗓 @here     | ${String(shop.usedHereThisTriday).padEnd(5)} | ${String(shop.tridayHere).padEnd(4)} | <t:${tridayResetTs}:R>\n` +
    `🗓 @everyone | ${String(shop.usedEveryoneThisTriday).padEnd(5)} | ${String(shop.tridayEveryone).padEnd(4)} | <t:${tridayResetTs}:R>\n` +
    `🗓 Shop ping | ${String(shop.usedShopThisTriday).padEnd(5)} | ${String(shop.tridayShop).padEnd(4)} | <t:${tridayResetTs}:R>\n` +
    `\`\`\``;

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setAuthor({ name: `${shop.name}'s Shop`, iconURL: pfpUrl })
    .setTitle("💎 Shop Slot")
    .setDescription(
      `**Owner:** <@${shop.ownerId}>\n` +
      `**Expires:** <t:${expiresTs}:F> (<t:${expiresTs}:R>)\n` +
      `**Plan:** ${isPremium ? "✨ Premium" : "Free"}\n` +
      (shop.isTrial ? "⚠️ **Trial Shop** (limited pings)\n" : "") +
      `\n**Ping Usage:**\n${pingTable}\n` +
      "Use the buttons below to manage your shop.\n" +
      "You cannot delete messages manually; use **Clear**."
    )
    .setImage(bannerUrl)
    .setFooter({ text: "Slot auto-expires. You will be pinged 1 hour before." })
    .setTimestamp(new Date(shop.expiresAt));

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
        await channel.send(`${owner}, your shop expires in less than 1 hour.`).catch(() => {});
      }
    }

    if (timeLeft <= 0) {
      await channel.send("This shop slot has expired and will be deleted.").catch(() => {});
      await channel.delete().catch(() => {});
      delete shops[channelId];
      await saveShops(shops);
    }
  }
});

// ─── Worker: check deadlines & breaks every 5 minutes ───────────────────────
cron.schedule("*/5 * * * *", async () => {
  await checkDeadlines(client).catch(e => console.error("[Cron/deadlines]", e));
  await checkBreaks(client).catch(e => console.error("[Cron/breaks]", e));
});

// ─── Worker: restore timed-out roles + automod roles every minute ────────────
cron.schedule("* * * * *", async () => {
  await checkTimeouts(client).catch(e => console.error("[Cron/timeouts]", e));
  await checkAutoModRestores(client).catch(e => console.error("[Cron/autoModRestores]", e));
});

// ─── Worker: weekly strike reset (every Monday 00:00 UTC) ────────────────────
cron.schedule("0 0 * * 1", async () => {
  const { getWorkerConfig: gwc } = await import("./workerStorage.js");
  const cfgs = await gwc();
  for (const guildId of Object.keys(cfgs)) {
    await resetAllStrikes(guildId).catch(e => console.error("[WeeklyReset]", e));
  }
});

// ─── Giveaway: check expired giveaways every minute ──────────────────────────
cron.schedule("* * * * *", async () => {
  await checkExpiredGiveaways(client).catch(e => console.error("[Giveaway/expiry]", e));
});


// ─── Log button: Remove Point ─────────────────────────────────────────────────

async function handleWorkerRemovePoint(interaction) {
  const targetUserId = interaction.customId.replace("worker_remove_point_", "");
  const { getWorker, saveWorker, getWorkerConfig } = await import("./workerStorage.js");

  const cfgs = await getWorkerConfig();
  const cfg  = Object.values(cfgs).find(c => c.guildId === interaction.guildId);
  if (!cfg) return interaction.reply({ content: "❌ Worker config not found.", ephemeral: true });

  // Only guild owner or admins
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.permissions.has("ManageGuild")) {
    return interaction.reply({ content: "❌ You do not have permission to do this.", ephemeral: true });
  }

  const worker = await getWorker(targetUserId);
  if (!worker) return interaction.reply({ content: "❌ Worker not found.", ephemeral: true });

  const newPoints = Math.max(0, (worker.points ?? 0) - 1);
  await saveWorker(targetUserId, { ...worker, points: newPoints });

  await sendLog(client, interaction.guildId, cfg.logChannelId, {
    type:    "point_removed",
    userId:  targetUserId,
    points:  newPoints,
    adminId: interaction.user.id
  });

  return interaction.reply({
    content: `✅ Removed 1 point from <@${targetUserId}>. They now have **${newPoints} points**.`,
    ephemeral: true
  });
}

// ─── Log button: Add Strike (from proof log) ──────────────────────────────────

async function handleWorkerAddStrikeFromLog(interaction) {
  const targetUserId = interaction.customId.replace("worker_add_strike_log_", "");
  const { getWorkerConfig } = await import("./workerStorage.js");

  const cfgs = await getWorkerConfig();
  const cfg  = Object.values(cfgs).find(c => c.guildId === interaction.guildId);
  if (!cfg) return interaction.reply({ content: "❌ Worker config not found.", ephemeral: true });

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.permissions.has("ManageGuild")) {
    return interaction.reply({ content: "❌ You do not have permission to do this.", ephemeral: true });
  }

  await addStrike(targetUserId, null, "requirements_not_met", cfg, client);

  return interaction.reply({
    content: `⚡ Strike added to <@${targetUserId}>.`,
    ephemeral: true
  });
}

// ─── Log button: Remove Strike (from member-left log) ────────────────────────

async function handleWorkerRemoveStrikeFromLog(interaction) {
  const targetUserId = interaction.customId.replace("worker_remove_strike_", "");
  const { getWorkerConfig } = await import("./workerStorage.js");

  const cfgs = await getWorkerConfig();
  const cfg  = Object.values(cfgs).find(c => c.guildId === interaction.guildId);
  if (!cfg) return interaction.reply({ content: "❌ Worker config not found.", ephemeral: true });

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.permissions.has("ManageGuild")) {
    return interaction.reply({ content: "❌ You do not have permission to do this.", ephemeral: true });
  }

  const success = await removeStrike(targetUserId, cfg, client);
  if (!success) return interaction.reply({ content: "❌ Worker not found.", ephemeral: true });

  return interaction.reply({
    content: `🔧 Strike removed from <@${targetUserId}>.`,
    ephemeral: true
  });
}

client.login(config.token);