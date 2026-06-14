import fs from "fs";
import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder
} from "discord.js";
import { getWorkerConfig, saveWorkerConfig } from "../workerStorage.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

export const data = new SlashCommandBuilder()
  .setName("workersetup")
  .setDescription("Set up the worker system channels and settings for this server.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption(o =>
    o.setName("application_channel")
      .setDescription("Channel where the application form overview is posted.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .addChannelOption(o =>
    o.setName("announcement_channel")
      .setDescription("Channel where job announcements are posted (accepted workers only).")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .addChannelOption(o =>
    o.setName("log_channel")
      .setDescription("Channel where the bot logs joins, proofs, and strikes.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .addChannelOption(o =>
    o.setName("guide_channel")
      .setDescription("Channel where the detailed worker guide is posted.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  );

export async function execute(interaction) {
  // Only the bot owner can run this
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({
      content: "❌ Only the bot owner can run this command.",
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;

  const applicationChannel  = interaction.options.getChannel("application_channel");
  const announcementChannel = interaction.options.getChannel("announcement_channel");
  const logChannel          = interaction.options.getChannel("log_channel");
  const guideChannel        = interaction.options.getChannel("guide_channel");

  // ── Validate all channels are in this guild ──────────────────────────────
  const channels = [applicationChannel, announcementChannel, logChannel, guideChannel];
  for (const ch of channels) {
    if (ch.guildId !== guild.id) {
      return interaction.editReply({
        content: `❌ Channel ${ch} is not in this server.`
      });
    }
  }

  // ── Prevent duplicate channel assignments ────────────────────────────────
  const ids = channels.map(c => c.id);
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    return interaction.editReply({
      content: "❌ Each channel option must be a different channel."
    });
  }

  // ── Create the accepted worker role ──────────────────────────────────────
  let acceptedRole;
  try {
    // Check if role already exists from a previous setup
    const workerCfg = await getWorkerConfig();
    const existing = workerCfg[guild.id];

    if (existing?.acceptedRoleId) {
      acceptedRole = guild.roles.cache.get(existing.acceptedRoleId)
        ?? await guild.roles.fetch(existing.acceptedRoleId).catch(() => null);
    }

    if (!acceptedRole) {
      acceptedRole = await guild.roles.create({
        name: "✅ Worker",
        color: 0x57f287,
        reason: "Worker system setup — accepted worker role"
      });
    }
  } catch (e) {
    console.error("Role creation error:", e);
    return interaction.editReply({
      content: "❌ Failed to create the accepted worker role. Make sure the bot has Manage Roles permission and its role is above others."
    });
  }

  // ── Lock announcement channel — only bot can send ────────────────────────
  try {
    await announcementChannel.permissionOverwrites.set([
      {
        id: guild.roles.everyone.id,
        deny: ["SendMessages", "AddReactions", "CreatePublicThreads", "CreatePrivateThreads"]
      },
      {
        id: acceptedRole.id,
        allow: ["ViewChannel", "ReadMessageHistory"],
        deny: ["SendMessages", "AddReactions"]
      },
      {
        id: interaction.client.user.id,
        allow: ["SendMessages", "ViewChannel", "ReadMessageHistory", "ManageMessages"]
      }
    ]);
  } catch (e) {
    console.error("Permission overwrite error:", e);
    return interaction.editReply({
      content: "❌ Failed to set permissions on the announcement channel. Check bot permissions."
    });
  }

  // ── Hide announcement channel from non-accepted users ────────────────────
  try {
    await announcementChannel.permissionOverwrites.edit(guild.roles.everyone.id, {
      ViewChannel: false
    });
    await announcementChannel.permissionOverwrites.edit(acceptedRole.id, {
      ViewChannel: true
    });
  } catch (e) {
    console.error("Channel visibility error:", e);
  }

  // ── Lock guide channel — private, workers only, read-only ───────────────
  try {
    await guideChannel.permissionOverwrites.set([
      {
        id: guild.roles.everyone.id,
        deny: ["ViewChannel", "SendMessages", "AddReactions"]
      },
      {
        id: acceptedRole.id,
        allow: ["ViewChannel", "ReadMessageHistory"],
        deny: ["SendMessages", "AddReactions"]
      },
      {
        id: interaction.client.user.id,
        allow: ["SendMessages", "ViewChannel", "ReadMessageHistory", "ManageMessages"]
      }
    ]);
  } catch (e) {
    console.error("Guide channel permission error:", e);
  }

  // ── Lock application channel — read only for everyone ───────────────────
  try {
    await applicationChannel.permissionOverwrites.set([
      {
        id: guild.roles.everyone.id,
        deny: ["SendMessages", "AddReactions"]
      },
      {
        id: interaction.client.user.id,
        allow: ["SendMessages", "ViewChannel", "ReadMessageHistory", "ManageMessages"]
      }
    ]);
  } catch (e) {
    console.error("Application channel permission error:", e);
  }

  // ── Save config ──────────────────────────────────────────────────────────
  const workerCfg = await getWorkerConfig();
  workerCfg[guild.id] = {
    guildId:              guild.id,
    applicationChannelId:  applicationChannel.id,
    announcementChannelId: announcementChannel.id,
    logChannelId:          logChannel.id,
    guideChannelId:        guideChannel.id,
    acceptedRoleId:        acceptedRole.id,
    setupAt:               new Date().toISOString(),
    setupBy:               interaction.user.id
  };
  await saveWorkerConfig(workerCfg);

  // ── Post / refresh application embed ────────────────────────────────────
  try {
    await postApplicationEmbed(interaction.client, guild, applicationChannel, acceptedRole);
  } catch (e) {
    console.error("Application embed error:", e);
  }

  // ── Post / refresh guide embed ───────────────────────────────────────────
  try {
    await postGuideEmbed(interaction.client, guild, guideChannel, workerCfg[guild.id]);
  } catch (e) {
    console.error("Guide embed error:", e);
  }

  // ── Reply ────────────────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle("✅ Worker System Setup Complete")
    .setDescription(`**${guild.name}** worker system is now configured.`)
    .addFields(
      { name: "📋 Application",   value: `${applicationChannel}`,  inline: true },
      { name: "📢 Announcements", value: `${announcementChannel}`, inline: true },
      { name: "📜 Logs",          value: `${logChannel}`,          inline: true },
      { name: "📖 Guide",         value: `${guideChannel}`,        inline: true },
      { name: "✅ Worker Role",   value: `${acceptedRole}`,        inline: true }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ─── Post application overview embed ─────────────────────────────────────────

async function postApplicationEmbed(client, guild, channel, acceptedRole) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("discord.js");

  // Clear old bot messages in the channel
  const messages = await channel.messages.fetch({ limit: 20 });
  const botMsgs = messages.filter(m => m.author.id === client.user.id);
  for (const msg of botMsgs.values()) {
    await msg.delete().catch(() => {});
  }

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`📋 Worker Application — ${guild.name}`)
    .setDescription(
      [
        "**Welcome! Here's how the worker system works:**",
        "",
        "🔹 Fill out the application below to join the team.",
        "🔹 If accepted, you will gain access to the announcements channel.",
        "🔹 When a job is posted, you must join the server listed and log proof (screenshot).",
        "🔹 Complete requirements listed in each announcement to earn **+1 point**.",
        "🔹 Failing to join in time, leaving early, or missing requirements earns a **strike**.",
        "🔹 **2 strikes** before the weekly reset = **−1 point**.",
        "🔹 Reach **15 points** to claim your reward in the guide channel.",
        "",
        "**Ready to join? Hit Apply below.**"
      ].join("\n")
    )
    .setFooter({ text: "One application per user • Cooldown after rejection" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("worker_apply")
      .setLabel("📝 Apply")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// ─── Post guide embed ─────────────────────────────────────────────────────────

async function postGuideEmbed(client, guild, channel, cfg) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("discord.js");

  // Clear old bot messages
  const messages = await channel.messages.fetch({ limit: 20 });
  const botMsgs = messages.filter(m => m.author.id === client.user.id);
  for (const msg of botMsgs.values()) {
    await msg.delete().catch(() => {});
  }

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`📖 ${guild.name} — Worker Guide`)
    .setDescription(
      [
        "**How it works:**",
        "① Apply → get accepted → gain access to announcements",
        "② Announcement posted → join the server → complete requirements → upload screenshot proof → earn **+1 point**",
        "③ Miss deadline / skip requirements → **+1 strike**",
        "④ **2 strikes** before weekly reset → **−1 point** · Strikes reset every Monday",
        "⑤ Reach **15 points** → press Claim Reward below",
        "",
        "**⚠️ Leaving the server early:**",
        "Only leave a server after the owner posts a **leave announcement** in this channel.",
        "Leaving before that announcement = **automatic strike**, no exceptions.",
        "If you have a valid reason, contact the owner immediately.",
        "",
        "**🔄 Rejoins:**",
        "If you have already joined a server for a **previous announcement**, joining it again does **not** count.",
        "No reward and no strike will be issued for rejoins.",
        "",
        "**Strikes issued for:**",
        "• Not logging proof within the time limit",
        "• Not completing listed requirements",
        "• Leaving the server before the leave announcement",
        "",
        "**Rules:**",
        "• If max join cap is reached when you log proof = no reward, no strike",
        "• Messaging in announcements or application channels = 1h timeout",
        "",
        "**On Break?** Press the button below — fill in duration & reason.",
        "Owner approves/declines. If approved, no strikes during your break.",
      ].join("\n")
    )
    .setFooter({ text: "Strikes reset weekly · 15 points = reward · Questions? DM the owner." })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("worker_claim_reward")
      .setLabel("🎁 Claim Reward")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("worker_my_stats")
      .setLabel("📊 My Stats")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("worker_on_break")
      .setLabel("⏸️ On Break")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
}