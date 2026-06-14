import fs from "fs";
import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder
} from "discord.js";
import {
  getGuildConfigs,
  getYtRewards,
  saveYtRewards
} from "../storage.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

export const data = new SlashCommandBuilder()
  .setName("ytsetup")
  .setDescription("Create a YouTube subscribe reward channel.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .addStringOption(o =>
    o.setName("reward_type")
      .setDescription("Role or DM reward")
      .setRequired(true)
      .addChoices(
        { name: "Role", value: "role" },
        { name: "DM Message", value: "dm" }
      )
  )
  .addStringOption(o =>
    o.setName("youtube_url")
      .setDescription("YouTube channel URL")
      .setRequired(true)
  )
  .addStringOption(o =>
    o.setName("channel_name")
      .setDescription("Name for the reward channel")
      .setRequired(true)
  )
  .addRoleOption(o =>
    o.setName("role")
      .setDescription("Role to give (if reward_type = role)")
      .setRequired(false)
  )
  .addStringOption(o =>
    o.setName("dm_text")
      .setDescription("DM text (if reward_type = dm)")
      .setRequired(false)
  );

export async function execute(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({ content: "Guild only.", ephemeral: true });
  }

  const isBotOwner = interaction.user.id === config.ownerId;
  const isGuildOwner = interaction.user.id === guild.ownerId;
  if (!isBotOwner && !isGuildOwner) {
    return interaction.reply({
      content: "Only the guild owner or bot owner can use this.",
      ephemeral: true
    });
  }

  const configs = await getGuildConfigs();
  const gCfg = configs[guild.id];
  if (!gCfg) {
    return interaction.reply({
      content: "Use `/setupguild` first to configure this server.",
      ephemeral: true
    });
  }

  const plan = gCfg.plan || "free";
  const ytRewards = await getYtRewards();
  const currentCount = Object.values(ytRewards).filter(
    r => r.guildId === guild.id
  ).length;

  const maxYt = plan === "premium" ? 3 : 1;
  if (currentCount >= maxYt && !isBotOwner) {
    return interaction.reply({
      content: `This server reached its YouTube verify channel limit (${currentCount}/${maxYt}) for plan **${plan}**.`,
      ephemeral: true
    });
  }

  const rewardType = interaction.options.getString("reward_type");
  const role = interaction.options.getRole("role");
  const dmText = interaction.options.getString("dm_text");
  const ytUrl = interaction.options.getString("youtube_url");
  const channelName = interaction.options.getString("channel_name");

  if (rewardType === "role" && !role) {
    return interaction.reply({
      content: "You selected role reward but no role was provided.",
      ephemeral: true
    });
  }
  if (rewardType === "dm" && !dmText) {
    return interaction.reply({
      content: "You selected DM reward but no DM text was provided.",
      ephemeral: true
    });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: gCfg.ytCategoryId,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        deny: [PermissionFlagsBits.ManageMessages]
      },
      {
        id: interaction.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageMessages
        ]
      }
    ]
  });

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setAuthor({ name: "Free Reward", iconURL: gCfg.pfpUrl })
    .setTitle("🎁 Get Your Reward!")
    .setDescription(
      [
        `If you want the reward, you must **subscribe** to our YouTube channel and send a screenshot in this channel.`,
        "",
        `📺 **YouTube Channel:** ${ytUrl}`,
        "",
        "📋 **How to claim:**",
        "1. Click the YouTube link above",
        "2. Subscribe to the channel",
        "3. Take a screenshot showing your subscription",
        "4. Send the screenshot **in this channel**",
        "",
        "🔴 **Important:**",
        "• Only images will be accepted",
        "• Screenshot must clearly show your subscription",
        "• Fake screenshots may result in a ban"
      ].join("\n")
    )
    .setImage(gCfg.bannerUrl)
    .setFooter({
      text: "Channel is auto-cleaned. Only the main message stays."
    });

  const mainMsg = await channel.send({ embeds: [embed] });
  await mainMsg.pin();

  ytRewards[channel.id] = {
    channelId: channel.id,
    guildId: guild.id,
    rewardType,
    roleId: role ? role.id : null,
    dmText: dmText || null,
    ytUrl,
    mainMessageId: mainMsg.id
  };
  await saveYtRewards(ytRewards);

  await interaction.reply({
    content: `Created reward channel: ${channel} (plan: **${plan}**)`,
    ephemeral: true
  });
}
