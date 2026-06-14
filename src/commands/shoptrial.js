import fs from "fs";
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from "discord.js";
import { getGuildConfigs, getShops, saveShops } from "../storage.js";

const config = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));
const MAX_TRIALS = 2;

export const data = new SlashCommandBuilder()
  .setName("shoptrial")
  .setDescription("Give a user a 12-hour trial shop (max 2 at a time).")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption(o => o.setName("owner").setDescription("Who gets the trial shop").setRequired(true))
  .addStringOption(o => o.setName("name").setDescription("Shop name (one word)").setRequired(true).setMaxLength(20));

export async function execute(interaction) {
  if (interaction.user.id !== config.ownerId && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "❌ Admins only.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const guild     = interaction.guild;
  const shopOwner = interaction.options.getUser("owner");
  const shopName  = interaction.options.getString("name").toLowerCase().replace(/\s+/g, "-");

  const configs = await getGuildConfigs();
  const gCfg    = configs[guild.id];
  if (!gCfg) return interaction.editReply({ content: "❌ Run `/setupguild` first." });

  // Max trial check
  const shops  = await getShops();
  const trials = Object.values(shops).filter(s => s.guildId === guild.id && s.isTrial && Date.now() < s.expiresAt);
  if (trials.length >= MAX_TRIALS) {
    return interaction.editReply({ content: `❌ Max ${MAX_TRIALS} trial shops already running. Close one first.` });
  }

  const now       = Date.now();
  const expiresAt = now + 12 * 60 * 60 * 1000; // 12 hours

  const shopPrefix = gCfg.shopPrefix ?? "『🛍️』";
  let channel;
  try {
    channel = await guild.channels.create({
      name: `trial-${shopName}`,
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

  const shopData = {
    channelId: channel.id, guildId: guild.id, ownerId: shopOwner.id,
    name: shopName, expiresAt, warned: false, isTrial: true,
    // Trial: 1 test ping, no daily/weekly/triday limits
    dailyHere: 0, dailyEveryone: 0, dailyShop: 1,
    weeklyHere: 0, weeklyEveryone: 0, weeklyShop: 0,
    tridayHere: 0, tridayEveryone: 0, tridayShop: 0,
    usedHereToday: 0, usedEveryoneToday: 0, usedShopToday: 0,
    usedHereThisWeek: 0, usedEveryoneThisWeek: 0, usedShopThisWeek: 0,
    usedHereThisTriday: 0, usedEveryoneThisTriday: 0, usedShopThisTriday: 0,
    lastHerePingAt: 0, lastEveryonePingAt: 0, lastShopPingAt: 0,
    dayResetTime: now, weekResetTime: now, tridayResetTime: now,
    lastPingMsgId: null, mainMessageId: null,
  };

  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle(`🔬 Trial Shop — ${shopName}`)
    .setDescription(
      `**Owner:** <@${shopOwner.id}>\n` +
      `**Expires:** <t:${Math.floor(expiresAt/1000)}:R>\n\n` +
      "⚠️ **Trial shop — 1 test ping available.**\n" +
      "When you ping, the message will say:\n> Come and check this shop!\n\n" +
      "No @here or @everyone pings on trial."
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("shop_ping").setLabel("🔔 Test Ping").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("shop_clear").setLabel("🗑 Clear").setStyle(ButtonStyle.Secondary)
  );

  const mainMsg = await channel.send({ embeds: [embed], components: [row] });
  shopData.mainMessageId = mainMsg.id;
  shops[channel.id] = shopData;
  await saveShops(shops);

  await interaction.editReply({ content: `✅ Trial shop **${shopName}** created for <@${shopOwner.id}> in ${channel}. Expires in 12 hours.` });
}