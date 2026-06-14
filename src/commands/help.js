import fs from "fs";
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

const config = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Full guide to every feature of the bot.");

const PAGES = [
  // Page 0 — Overview
  () => new EmbedBuilder().setColor(config.embedColor).setTitle("📖 Bot Help — Overview")
    .setDescription(
      "Use the buttons below to navigate between sections.\n\n" +
      "**Sections:**\n" +
      "1️⃣ Shop System\n2️⃣ Worker System\n3️⃣ Games\n4️⃣ Giveaways\n5️⃣ Utilities\n6️⃣ Moderation\n7️⃣ Admin / Owner"
    ).setFooter({ text: "Page 1/8" }),

  // Page 1 — Shop System
  () => new EmbedBuilder().setColor(config.embedColor).setTitle("🛍 Shop System")
    .addFields(
      { name: "/setupguild", value: "Configure server categories (shop & YT). Server owner or bot owner only.", inline: false },
      { name: "/genkey", value: "Generate a shop key with daily/weekly/3-day ping allowances. Bot owner only.", inline: false },
      { name: "/redeem", value: "Redeem a shop key to open a shop channel.", inline: false },
      { name: "/openshop", value: "Open a shop directly without a key (admin only). Sets all ping limits manually.", inline: false },
      { name: "/shoptrial", value: "Give a user a 12-hour trial shop with 1 test ping. Max 2 trials at once.", inline: false },
      { name: "/shoppanel", value: "Admin panel for shops — generate keys, open shops, view active shops.", inline: false },
      { name: "Ping Button", value: "In a shop channel — choose daily/weekly/3-day @here/@everyone/shop ping. Cooldowns: @everyone 2d, @here 1d, shop 1d.", inline: false },
      { name: "Request Ping", value: "Shop owner requests an extra ping from the owner. Owner approves in DMs.", inline: false },
      { name: "Clear Button", value: "Clears non-pinned messages in the shop channel.", inline: false },
      { name: "Ping Format", value: "`# (@ping)` then `🔔Check out this shop` — replaces previous ping, never auto-deletes.", inline: false },
    ).setFooter({ text: "Page 2/8" }),

  // Page 2 — Worker System
  () => new EmbedBuilder().setColor(config.embedColor).setTitle("👷 Worker System")
    .addFields(
      { name: "/workersetup", value: "Set up the worker system channels, roles, time limits, and max joins.", inline: false },
      { name: "/announce", value: "Post a job announcement with server link, requirements, and time limit.", inline: false },
      { name: "/leavenow (removed)", value: "Leave tracking removed — workers self-manage.", inline: false },
      { name: "Apply Button", value: "In the application channel — opens a form. Accepted workers get the Worker role.", inline: false },
      { name: "Log Proof Button", value: "Upload a screenshot in the announcements channel within the time limit.", inline: false },
      { name: "Verify Button", value: "Sent via DM on acceptance — one button press to confirm account.", inline: false },
      { name: "/workerspanel", value: "Full moderation panel — timeout, ban, unban, add/remove strike, add/remove point, view stats.", inline: false },
      { name: "Points & Strikes", value: "+1 point per completed job. 2 strikes before weekly reset = −1 point. 15 points = reward.", inline: false },
      { name: "Log Channel", value: "Proof logs show screenshot + membership status. Buttons: Remove Point, Add Strike, Punish.", inline: false },
    ).setFooter({ text: "Page 3/8" }),

  // Page 3 — Games
  () => new EmbedBuilder().setColor(config.embedColor).setTitle("🎮 Games System")
    .addFields(
      { name: "/gamessetup", value: "Set up the games channel, hoster role, and ping roles.", inline: false },
      { name: "/host", value: "Host a game. Options: gamemode, difficulty, word, task, min/max, hint interval, max players, time limit.", inline: false },
      { name: "/hint", value: "Drop a hint for the current game (hosters only).", inline: false },
      { name: "/transcript", value: "View a transcript of a past game.", inline: false },
      { name: "🔢 Counting", value: "Count 1–100. No double counting. Wrong numbers deleted.", inline: true },
      { name: "💬 Word Guess", value: "AI-generated word. Hints every set interval. Guesses deleted.", inline: true },
      { name: "🎬 Do a Task", value: "Upload a video. Host sets winner by ID or ends with no winner.", inline: true },
      { name: "🔮 Number Guess", value: "Guess the number. Higher/lower hints. Messages stay until end.", inline: true },
      { name: "🧠 Trivia BR", value: "Battle royale. AI questions. Wrong = eliminated. Last standing wins.", inline: true },
      { name: "⌨️ Type Race", value: "Type the sentence exactly. Too fast = disqualified.", inline: true },

      { name: "Admin Panel", value: "Posted at game start — Hint, End Game, Set Winner (Do a Task). Stays above game messages.", inline: false },
      { name: "Channel Lock", value: "Games channel is locked when no game is running. Non-game messages deleted.", inline: false },
    ).setFooter({ text: "Page 4/8" }),

  // Page 4 — Giveaways
  () => new EmbedBuilder().setColor(config.embedColor).setTitle("🎉 Giveaway System")
    .addFields(
      { name: "/gcreate", value: "Create a giveaway. Set prize, duration, winners, and optional requirements.", inline: false },
      { name: "/gend", value: "End a giveaway early and pick winners.", inline: false },
      { name: "/greroll", value: "Reroll a giveaway winner from remaining entries.", inline: false },
      { name: "/glist", value: "List all active giveaways in this server.", inline: false },
      { name: "/gcancel", value: "Cancel a giveaway without picking a winner.", inline: false },
      { name: "/gsetwinner", value: "[Owner only] Force-set the winner of any giveaway by message ID.", inline: false },
      { name: "/giveawaypanel", value: "[Owner only] Panel with edit, choose winner, and management buttons.", inline: false },
      { name: "/gedit", value: "Edit basic giveaway details (prize, end time).", inline: false },
      { name: "/gchoosewinner", value: "[Owner only] Silently add a user as winner — no announcement, no one notified.", inline: false },
      { name: "Requirements", value: "Join server · Account age · Has role · Trivia · Wordle · Short answer · Message count · Grid challenge · Invite tracker", inline: false },
      { name: "Extra Entries", value: "/extra-entries — give a role bonus or penalty entries. Shown on giveaway embed.", inline: false },
    ).setFooter({ text: "Page 5/8" }),

  // Page 5 — Utilities
  () => new EmbedBuilder().setColor(config.embedColor).setTitle("🛠 Utilities")
    .addFields(
      { name: "?stick <message>", value: "Stick a message to the bottom of a channel. Options: --embed --title --body --color --image --countdown.", inline: false },
      { name: "?unstick", value: "Remove the sticky in the current channel.", inline: false },
      { name: "?stickylist", value: "List all active stickies in the server (admin only).", inline: false },
      { name: "?save <message>", value: "Save a message with a name for later deployment.", inline: false },
      { name: "/panel", value: "[Owner] Panel to save embed messages, list saved, and deploy to any channel.", inline: false },
      { name: "/say", value: "Send a plain message as the bot.", inline: false },
      { name: "/sayembed", value: "Send an embed as the bot. Opens a form for title, body, color, image, footer.", inline: false },
      { name: "/editmsg", value: "Edit a message the bot previously sent.", inline: false },
      { name: "/autoreact", value: "Set/remove/list/pause auto-reactions for a channel. Supports keyword and role filters.", inline: false },
      { name: "/reactorpanel", value: "Panel for managing all auto-reactors in the server.", inline: false },
      { name: "/leaderboard", value: "Message count leaderboard. Filter by role, sort by most/least.", inline: false },
      { name: "/resetleaderboard", value: "Reset message counts for this server.", inline: false },
      { name: "/ytsetup", value: "Set up a YouTube verification channel with role or DM reward.", inline: false },
    ).setFooter({ text: "Page 6/8" }),

  // Page 6 — Moderation
  () => new EmbedBuilder().setColor(config.embedColor).setTitle("🔨 Moderation")
    .addFields(
      { name: "/workerspanel", value: "Full worker moderation panel. Buttons: Timeout, Ban, Unban, Add Strike, Remove Strike, Add Point, Remove Point, View Stats, Punish.", inline: false },
      { name: "/reactorpanel", value: "Manage all auto-reactors — view, pause, remove.", inline: false },
      { name: "/shoppanel", value: "Admin panel for shops. Generate keys, open shops, view/close active shops.", inline: false },
      { name: "Auto-Mod", value: "Anyone messaging in the announcements or application channels is auto-timed out (10 min) even with admin. Messages in locked games channel are auto-deleted.", inline: false },
      { name: "Ping Abuse", value: "Shop owners exceeding ping limits get their ping blocked. Repeated abuse: message the owner via the Request Ping system.", inline: false },
    ).setFooter({ text: "Page 7/8" }),

  // Page 7 — Admin / Owner
  () => new EmbedBuilder().setColor(config.embedColor).setTitle("👑 Admin / Owner Commands")
    .addFields(
      { name: "/workersetup", value: "Configure worker system channels and settings.", inline: false },
      { name: "/gamessetup", value: "Configure games channel and hoster role.", inline: false },
      { name: "/pingsetup (removed)", value: "Ping management has been removed from this bot.", inline: false },
      { name: "/premium", value: "Manage server plans. Owner only.", inline: false },
      { name: "/genkey", value: "Generate a shop key with custom ping limits and duration.", inline: false },
      { name: "/openshop", value: "Directly open a shop for a user without a key.", inline: false },
      { name: "/shoptrial", value: "Give a 12-hour trial shop. Max 2 trials at once.", inline: false },
      { name: "/gsetwinner", value: "Force-set giveaway winner. Owner only, silent.", inline: false },
      { name: "/gchoosewinner", value: "Secretly add a winner to a giveaway. No notification.", inline: false },
      { name: "/giveawaypanel", value: "Giveaway management panel — edit, choose winner, cancel.", inline: false },
      { name: "/panel", value: "Saved messages panel — save, list, deploy.", inline: false },
      { name: "Ping: /workersetup", value: "Set which roles get pinged on announcements.", inline: false },
    ).setFooter({ text: "Page 8/8" }),
];

function buildRow(page) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`help_prev_${page}`).setLabel("◀ Prev").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`help_next_${page}`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(page === PAGES.length - 1),
    new ButtonBuilder().setCustomId("help_close").setLabel("✖ Close").setStyle(ButtonStyle.Danger)
  );
}

export async function execute(interaction) {
  await interaction.reply({ embeds: [PAGES[0]()], components: [buildRow(0)], ephemeral: true });
}

export async function handleHelpButton(interaction) {
  const id = interaction.customId;
  if (id === "help_close") return interaction.update({ content: "Help closed.", embeds: [], components: [] });

  const currentPage = parseInt(id.split("_")[2]);
  const newPage = id.startsWith("help_next") ? currentPage + 1 : currentPage - 1;
  const clamped = Math.max(0, Math.min(PAGES.length - 1, newPage));
  await interaction.update({ embeds: [PAGES[clamped]()], components: [buildRow(clamped)] });
}