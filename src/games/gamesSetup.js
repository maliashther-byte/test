import fs from "fs";
import {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType
} from "discord.js";
import { getGuildGamesConfig, setGuildGamesConfig } from "./gamesStorage.js";

const config   = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));
const OWNER_ID = config.ownerId;

export const data = new SlashCommandBuilder()
  .setName("gamessetup")
  .setDescription("Set up the games system for this server.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption(o => o.setName("games_channel").setDescription("Channel where games are hosted.").addChannelTypes(ChannelType.GuildText).setRequired(true))
  .addRoleOption(o => o.setName("hoster_role").setDescription("Role that can host games.").setRequired(true))
  .addRoleOption(o => o.setName("ping1").setDescription("First ping option when hosting.").setRequired(true))
  .addRoleOption(o => o.setName("ping2").setDescription("Second ping option when hosting.").setRequired(false));

export async function execute(interaction) {
  if (interaction.user.id !== OWNER_ID && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "❌ Administrators only.", ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const guild        = interaction.guild;
  const gamesChannel = interaction.options.getChannel("games_channel");
  const hosterRole   = interaction.options.getRole("hoster_role");
  const ping1        = interaction.options.getRole("ping1");
  const ping2        = interaction.options.getRole("ping2");

  // Lock channel by default (no game running)
  await lockGamesChannel(gamesChannel, guild, interaction.client);

  // Clear old bot messages
  try {
    const msgs    = await gamesChannel.messages.fetch({ limit: 20 });
    const botMsgs = msgs.filter(m => m.author.id === interaction.client.user.id);
    for (const m of botMsgs.values()) await m.delete().catch(() => {});
  } catch (_) {}

  const panelMsg = await postAdminPanel(gamesChannel, guild, hosterRole, ping1, ping2);

  await setGuildGamesConfig(guild.id, {
    guildId:          guild.id,
    gamesChannelId:   gamesChannel.id,
    hosterRoleId:     hosterRole.id,
    ping1RoleId:      ping1.id,
    ping1Name:        ping1.name,
    ping2RoleId:      ping2?.id ?? null,
    ping2Name:        ping2?.name ?? null,
    adminPanelMsgId:  panelMsg.id,
    setupAt:          new Date().toISOString()
  });

  await interaction.editReply({ content: `✅ Games system set up in ${gamesChannel}. Admin panel posted and channel locked.` });
}

// ─── Lock / Unlock the games channel ─────────────────────────────────────────
export async function lockGamesChannel(channel, guild, client) {
  try {
    await channel.permissionOverwrites.edit(guild.roles.everyone.id, { SendMessages: false, AddReactions: false });
    await channel.permissionOverwrites.edit(client.user.id, { SendMessages: true, ManageMessages: true, ViewChannel: true, ReadMessageHistory: true });
  } catch (e) { console.error("[GamesSetup] Lock error:", e); }
}

export async function unlockGamesChannel(channel, guild, client) {
  try {
    await channel.permissionOverwrites.edit(guild.roles.everyone.id, { SendMessages: false, AddReactions: false });
    await channel.permissionOverwrites.edit(client.user.id, { SendMessages: true, ManageMessages: true, ViewChannel: true, ReadMessageHistory: true });
  } catch (e) { console.error("[GamesSetup] Unlock error:", e); }
}

// ─── Post expanded admin panel ────────────────────────────────────────────────
export async function postAdminPanel(channel, guild, hosterRole, ping1, ping2) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎮 ${guild.name} — Games Hub`)
    .setDescription(
      "## Welcome to the Games Channel!\n" +
      "This is where all games are hosted. Messages are cleared after each game ends.\n\n" +
      "### 🎮 How to Play\n" +
      "Games run one at a time. When a game starts, you'll see instructions here. " +
      "Follow them and be the first to win!\n\n" +
      "### 🏆 Winner Tracking\n" +
      "All winners are recorded. Press **Last 3 Winners** to see the most recent.\n" +
      "Press **Leaderboard** to see the all-time top winners.\n\n" +
      "### 📋 Game Rules\n" +
      "• No automating, scripting, or botting — instant disqualification\n" +
      "• Be respectful to other players at all times\n" +
      "• Host's decision is final — no arguing in this channel\n" +
      "• Only type when a game is running and it's your turn (battle royale modes)\n" +
      "• Messages sent while no game is running will be auto-deleted\n\n" +
      "### 🎮 Available Gamemodes\n" +
      "🔢 **Counting** — Count 1–100 without double counting\n" +
      "💬 **Word Guess** — AI-generated word with timed hints\n" +
      "🎬 **Do a Task** — Upload a video doing the task\n" +
      "🔮 **Number Guess** — Higher/lower number guessing\n" +
      "🧠 **Trivia Battle Royale** — AI questions, wrong = eliminated\n" +
      "⌨️ **Type Race** — Type the sentence exactly, fastest wins\n" +

      "### 🌙 Game Night Hosters\n" +
      `Authorized hosters: **@${hosterRole.name}**\n` +
      "Hosters can start any game using the **Host a Game** button or `/host` command.\n" +
      "All games will ask for a **prize** — if it's just for fun, leave it blank.\n\n" +
      "### 🔔 Ping Roles\n" +
      `Ping 1: @${ping1?.name ?? "None"} · Ping 2: @${ping2?.name ?? "None"}\n` +
      "Hosters choose which ping to use when starting a game."
    )
    .setFooter({ text: "Channel is locked between games • Messages auto-cleared after each game" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("games_last_winners").setLabel("🏆 Last 3 Winners").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("games_host_panel").setLabel("🎮 Host a Game").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("games_rules").setLabel("📋 Rules").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("games_leaderboard").setLabel("📊 Leaderboard").setStyle(ButtonStyle.Secondary)
  );

  return channel.send({ embeds: [embed], components: [row] });
}