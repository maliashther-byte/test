// ── /openshop — auto-create shop without a key ────────────────────────────────
import fs from "fs";
import {
  SlashCommandBuilder, ChannelType, PermissionFlagsBits,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder
} from "discord.js";
import { getGuildConfigs, getShops, saveShops } from "../storage.js";

const config = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));

export const data = new SlashCommandBuilder()
  .setName("openshop")
  .setDescription("Open a shop channel automatically (owner/admin only).")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(o => o.setName("name").setDescription("Shop name (one word)").setRequired(true).setMaxLength(30))
  .addUserOption(o => o.setName("owner").setDescription("Who owns this shop").setRequired(true))
  .addIntegerOption(o => o.setName("duration_days").setDescription("How many days the shop lasts").setMinValue(1).setRequired(true))
  .addIntegerOption(o => o.setName("daily_here").setDescription("@here pings per day").setMinValue(0).setRequired(true))
  .addIntegerOption(o => o.setName("daily_everyone").setDescription("@everyone pings per day").setMinValue(0).setRequired(true))
  .addIntegerOption(o => o.setName("daily_shop").setDescription("Shop pings per day").setMinValue(0).setRequired(true))
  .addIntegerOption(o => o.setName("weekly_here").setDescription("@here pings per week").setMinValue(0).setRequired(true))
  .addIntegerOption(o => o.setName("weekly_everyone").setDescription("@everyone pings per week").setMinValue(0).setRequired(true))
  .addIntegerOption(o => o.setName("weekly_shop").setDescription("Shop pings per week").setMinValue(0).setRequired(true))
  .addIntegerOption(o => o.setName("triday_here").setDescription("@here pings per 3 days").setMinValue(0).setRequired(false))
  .addIntegerOption(o => o.setName("triday_everyone").setDescription("@everyone pings per 3 days").setMinValue(0).setRequired(false))
  .addIntegerOption(o => o.setName("triday_shop").setDescription("Shop pings per 3 days").setMinValue(0).setRequired(false));

export async function execute(interaction) {
  if (interaction.user.id !== config.ownerId && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "❌ Admins only.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const guild       = interaction.guild;
  const configs     = await getGuildConfigs();
  const gCfg        = configs[guild.id];
  if (!gCfg) return interaction.editReply({ content: "❌ Run `/setupguild` first." });

  const shopName    = interaction.options.getString("name").replace(/\s+/g,"-").toLowerCase();
  const shopOwner   = interaction.options.getUser("owner");
  const durationDays = interaction.options.getInteger("duration_days");
  const now         = Date.now();
  const expiresAt   = now + durationDays * 86400000;

  const pingOptions = {
    dailyHere:        interaction.options.getInteger("daily_here"),
    dailyEveryone:    interaction.options.getInteger("daily_everyone"),
    dailyShop:        interaction.options.getInteger("daily_shop"),
    weeklyHere:       interaction.options.getInteger("weekly_here"),
    weeklyEveryone:   interaction.options.getInteger("weekly_everyone"),
    weeklyShop:       interaction.options.getInteger("weekly_shop"),
    tridayHere:       interaction.options.getInteger("triday_here") ?? 0,
    tridayEveryone:   interaction.options.getInteger("triday_everyone") ?? 0,
    tridayShop:       interaction.options.getInteger("triday_shop") ?? 0,
  };

  // Create the channel
  let channel;
  try {
    const shopPrefix = gCfg.shopPrefix ?? "『🛍️』";
    channel = await guild.channels.create({
      name: `${shopPrefix}${shopName}`,
      type: ChannelType.GuildText,
      parent: gCfg.shopCategoryId,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, allow: ["ViewChannel", "ReadMessageHistory"], deny: ["SendMessages"] },
        { id: shopOwner.id, allow: ["ViewChannel", "ReadMessageHistory", "SendMessages", "AttachFiles", "EmbedLinks"] },
        { id: interaction.client.user.id, allow: ["ViewChannel", "ReadMessageHistory", "SendMessages", "ManageMessages", "AttachFiles"] },
      ]
    });
  } catch (e) {
    return interaction.editReply({ content: `❌ Failed to create channel: ${e.message}` });
  }

  // Build shop embed & panel
  const shopData = {
    channelId:   channel.id,
    guildId:     guild.id,
    ownerId:     shopOwner.id,
    name:        shopName,
    expiresAt,
    warned:      false,
    // Ping budgets
    ...pingOptions,
    // Counters
    usedHereToday: 0, usedEveryoneToday: 0, usedShopToday: 0,
    usedHereThisWeek: 0, usedEveryoneThisWeek: 0, usedShopThisWeek: 0,
    usedHereThisTriday: 0, usedEveryoneThisTriday: 0, usedShopThisTriday: 0,
    // Cooldowns
    lastHerePingAt: 0, lastEveryonePingAt: 0, lastShopPingAt: 0,
    // Reset times
    dayResetTime:    now,
    weekResetTime:   now,
    tridayResetTime: now,
    lastPingMsgId:   null,
    mainMessageId:   null,
  };

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`🛍 ${shopName}`)
    .setDescription(`**Owner:** <@${shopOwner.id}>\n**Expires:** <t:${Math.floor(expiresAt/1000)}:R>`)
    .addFields(
      { name: "📅 Daily Pings",   value: `@here: ${pingOptions.dailyHere} · @everyone: ${pingOptions.dailyEveryone} · Shop: ${pingOptions.dailyShop}`, inline: false },
      { name: "📆 Weekly Pings",  value: `@here: ${pingOptions.weeklyHere} · @everyone: ${pingOptions.weeklyEveryone} · Shop: ${pingOptions.weeklyShop}`, inline: false },
      { name: "🗓 3-Day Pings",   value: `@here: ${pingOptions.tridayHere} · @everyone: ${pingOptions.tridayEveryone} · Shop: ${pingOptions.tridayShop}`, inline: false },
    );

  const pingRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("shop_ping").setLabel("🔔 Ping").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("shop_clear").setLabel("🗑 Clear").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("shop_request_ping").setLabel("➕ Request Ping").setStyle(ButtonStyle.Secondary)
  );

  const mainMsg = await channel.send({ embeds: [embed], components: [pingRow] });
  shopData.mainMessageId = mainMsg.id;

  const shops = await getShops();
  shops[channel.id] = shopData;
  await saveShops(shops);

  await interaction.editReply({ content: `✅ Shop **${shopName}** opened for <@${shopOwner.id}> in ${channel}!` });
}