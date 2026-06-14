import fs from "fs";
import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";
import {
  getGuildConfigs,
  getKeys,
  saveKeys,
  getShops,
  saveShops
} from "../storage.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

export const data = new SlashCommandBuilder()
  .setName("redeem")
  .setDescription("Redeem a shop key.")
  .addStringOption(o =>
    o.setName("key")
      .setDescription("Your shop key")
      .setRequired(true)
  )
  .addStringOption(o =>
    o.setName("name")
      .setDescription("One-word shop name")
      .setRequired(true)
  );

export async function execute(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({ content: "Guild only.", ephemeral: true });
  }

  const configs = await getGuildConfigs();
  const gCfg = configs[guild.id];
  if (!gCfg) {
    return interaction.reply({
      content: "Use `/setupguild` first to configure this server.",
      ephemeral: true
    });
  }

  const keyInput = interaction.options.getString("key");
  const name = interaction.options.getString("name");

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return interaction.reply({
      content: "Shop name must be one word (letters/numbers/_/-).",
      ephemeral: true
    });
  }

  const keys = await getKeys();
  const keyData = keys[keyInput];
  if (!keyData || keyData.used || keyData.guildId !== guild.id) {
    return interaction.reply({
      content: "Invalid, already used, or not for this server.",
      ephemeral: true
    });
  }

  const shops = await getShops();
  const plan = gCfg.plan || "free";
  const currentShops = Object.values(shops).filter(
    s => s.guildId === guild.id
  ).length;
  const maxShops = plan === "premium" ? Infinity : 3;

  if (currentShops >= maxShops && interaction.user.id !== config.ownerId) {
    return interaction.reply({
      content: `This server reached its shop limit (${currentShops}/${maxShops === Infinity ? "∞" : maxShops}) for plan **${plan}**.`,
      ephemeral: true
    });
  }

  const shopPrefix = gCfg.shopPrefix ?? "『🛍️』";
  const channel = await guild.channels.create({
    name: `${shopPrefix}${name}`,
    type: ChannelType.GuildText,
    parent: gCfg.shopCategoryId,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel],
        deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages]
      },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
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

  const now = Date.now();
  const expiresAt = now + (keyData.durationDays ?? keyData.durationHours / 24 ?? 1) * 24 * 60 * 60 * 1000;

  const pfpUrl    = gCfg.pfpUrl    ?? config.freePfpUrl;
  const bannerUrl = gCfg.bannerUrl ?? config.freeBannerUrl;
  const expiresTs = Math.floor(expiresAt / 1000);
  const isPremium = (gCfg.plan ?? "free") === "premium";

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setAuthor({ name: `${name}'s Shop`, iconURL: pfpUrl })
    .setTitle("💎 Shop Slot")
    .setDescription(
      `**Owner:** ${interaction.user}\n` +
      `**Expires:** <t:${expiresTs}:F> (<t:${expiresTs}:R>)\n` +
      `**Plan:** ${isPremium ? "✨ Premium" : "Free"}\n\n` +
      "**Ping Usage:**\n" +
      `📅 Daily — @here: 0/${keyData.dailyHere ?? 0} | @everyone: 0/${keyData.dailyEveryone ?? 0} | shop: 0/${keyData.dailyShop ?? 0}\n` +
      `📆 Weekly — @here: 0/${keyData.weeklyHere ?? 0} | @everyone: 0/${keyData.weeklyEveryone ?? 0} | shop: 0/${keyData.weeklyShop ?? 0}\n\n` +
      "Use the buttons below to manage your shop.\n" +
      "You cannot delete messages manually; use **Clear**."
    )
    .setImage(bannerUrl)
    .setFooter({ text: "Slot auto-expires. You will be pinged 1 hour before." })
    .setTimestamp(new Date(expiresAt));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("shop_ping")
      .setLabel("Ping")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("shop_clear")
      .setLabel("Clear")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("shop_request_ping")
      .setLabel("Request Ping")
      .setStyle(ButtonStyle.Success)
  );

  const mainMsg = await channel.send({ embeds: [embed], components: [row] });

  shops[channel.id] = {
    channelId: channel.id,
    guildId: guild.id,
    ownerId: interaction.user.id,
    name,
    expiresAt,
    mainMessageId: mainMsg.id,
    // Daily budgets
    dailyHere:      keyData.dailyHere      ?? 0,
    dailyEveryone:  keyData.dailyEveryone  ?? 0,
    dailyShop:      keyData.dailyShop      ?? 0,
    // Weekly budgets
    weeklyHere:     keyData.weeklyHere     ?? 0,
    weeklyEveryone: keyData.weeklyEveryone ?? 0,
    weeklyShop:     keyData.weeklyShop     ?? 0,
    // Daily counters
    usedHereToday:     0,
    usedEveryoneToday: 0,
    usedShopToday:     0,
    dayResetTime:      now,
    // Weekly counters
    usedHereThisWeek:     0,
    usedEveryoneThisWeek: 0,
    usedShopThisWeek:     0,
    weekResetTime: now,
    createdAt: now
  };
  await saveShops(shops);

  keyData.used = true;
  keys[keyInput] = keyData;
  await saveKeys(keys);

  await interaction.reply({
    content: `Shop created: ${channel} (plan: **${plan}**)`,
    ephemeral: true
  });
}