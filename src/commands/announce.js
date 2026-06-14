import fs from "fs";
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";
import {
  getWorkerConfig,
  getAnnouncements,
  saveAnnouncement,
  getWorkers
} from "../workerStorage.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

export const data = new SlashCommandBuilder()
  .setName("announce")
  .setDescription("Post a worker job announcement.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(o =>
    o.setName("link")
      .setDescription("The invite link to the server workers must join.")
      .setRequired(true)
  )
  .addStringOption(o =>
    o.setName("requirements")
      .setDescription("What workers must do in the server to earn their point.")
      .setRequired(true)
  )
  .addIntegerOption(o =>
    o.setName("timelimit_minutes")
      .setDescription("Minutes workers have to join and log proof.")
      .setMinValue(1)
      .setMaxValue(10080)
      .setRequired(true)
  )
  .addIntegerOption(o =>
    o.setName("maxjoins")
      .setDescription("Max rewarded joins (0 = unlimited).")
      .setMinValue(0)
      .setMaxValue(1000)
      .setRequired(false)
  );

export async function execute(interaction) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({
      content: "❌ Only the bot owner can post announcements.",
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guild.id;
  const cfg = (await getWorkerConfig())[guildId];

  if (!cfg) {
    return interaction.editReply({ content: "❌ Worker system not set up. Run `/workersetup` first." });
  }

  if (interaction.channelId !== cfg.announcementChannelId) {
    return interaction.editReply({ content: `❌ Announcements must be posted in <#${cfg.announcementChannelId}>.` });
  }

  const link            = interaction.options.getString("link").trim();
  const requirements    = interaction.options.getString("requirements");
  const timeLimitMins   = interaction.options.getInteger("timelimit_minutes");
  const maxJoinsInput   = interaction.options.getInteger("maxjoins");
  const maxJoins        = maxJoinsInput !== null ? maxJoinsInput : 0;

  const inviteRegex = /^(https?:\/\/)?(discord\.gg|discord\.com\/invite)\/[a-zA-Z0-9-]+$/;
  if (!inviteRegex.test(link)) {
    return interaction.editReply({ content: "❌ That doesn't look like a valid Discord invite link." });
  }

  const postedAt   = new Date();
  const deadlineAt = new Date(postedAt.getTime() + timeLimitMins * 60 * 1000);
  const deadlineTs = Math.floor(deadlineAt.getTime() / 1000);

  // Format time nicely
  const timeLimitText = timeLimitMins >= 60
    ? `${Math.floor(timeLimitMins / 60)}h ${timeLimitMins % 60 > 0 ? `${timeLimitMins % 60}m` : ""}`.trim()
    : `${timeLimitMins}m`;

  const joinsDisplay = maxJoins === 0 ? "Unlimited" : `0/${maxJoins}`;

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle("📢 New Job Announcement")
    .addFields(
      { name: "🔗 Server Link",    value: link,                                                      inline: false },
      { name: "📋 Requirements",   value: requirements,                                               inline: false },
      { name: "⏱ Time Limit",     value: `${timeLimitText} — <t:${deadlineTs}:R>`,                  inline: true  },
      { name: "🎯 Slots",         value: joinsDisplay,                                               inline: true  },
      { name: "⚠️ Important Rules", value:
        "🚪 **Leaving the server early = automatic strike.** Only leave after the owner posts a leave announcement.\n" +
        "🔄 **Rejoins do not count** — if you have joined this server in a previous announcement, you will receive no reward.\n" +
        "📸 **You must log proof** within the time limit or you will receive a strike.",
        inline: false }
    )
    .setFooter({ text: "Join the server → complete requirements → press Log Proof before the deadline." })
    .setTimestamp(postedAt);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("🔗 Join Server")
      .setStyle(ButtonStyle.Link)
      .setURL(link.startsWith("http") ? link : `https://${link}`),
    new ButtonBuilder()
      .setCustomId("worker_log_proof")
      .setLabel("📸 Log Proof")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("worker_check_status")
      .setLabel("📊 My Status")
      .setStyle(ButtonStyle.Secondary)
  );

  const announcementChannel = await interaction.guild.channels
    .fetch(cfg.announcementChannelId)
    .catch(() => null);

  if (!announcementChannel) {
    return interaction.editReply({ content: "❌ Announcement channel not found." });
  }

  // Ping all workers
  const allWorkers = await getWorkers();
  const guildWorkers = Object.values(allWorkers).filter(
    w => w.guildId === guildId && w.status === "accepted"
  );
  const pingMentions = guildWorkers.map(w => `<@${w.userId}>`).join(" ");

  const msg = await announcementChannel.send({
    content: pingMentions.length ? `📢 New announcement! ${pingMentions}` : "📢 New announcement!",
    embeds: [embed],
    components: [row],
    allowedMentions: { users: guildWorkers.map(w => w.userId) }
  });

  await saveAnnouncement(msg.id, {
    id:              msg.id,
    guildId,
    link,
    requirements,
    timeLimitMins,
    maxJoins,
    postedAt:        postedAt.toISOString(),
    deadlineAt:      deadlineAt.toISOString(),
    closed:          false,
    joins:           {}
  });

  await interaction.editReply({
    content: `✅ Announcement posted. Deadline: <t:${deadlineTs}:f> | Slots: ${joinsDisplay}`
  });
}