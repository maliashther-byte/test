import fs from "fs";
import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits
} from "discord.js";
import { getGuildConfigs, saveGuildConfigs } from "../storage.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

export const data = new SlashCommandBuilder()
  .setName("setupguild")
  .setDescription("Configure categories and visuals for this server.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption(o =>
    o.setName("yt_category")
      .setDescription("Category for YouTube reward channels")
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(true)
  )
  .addChannelOption(o =>
    o.setName("shop_category")
      .setDescription("Category for shop channels")
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(true)
  )
  .addRoleOption(o =>
    o.setName("shop_ping_role")
      .setDescription("Role used as shop ping (optional)")
      .setRequired(false)
  )
  .addStringOption(o =>
    o.setName("shop_prefix")
      .setDescription("Prefix before shop names (default: 『🛍️』)")
      .setRequired(false)
  )
  .addStringOption(o =>
    o.setName("banner_url")
      .setDescription("Main banner URL (premium only)")
      .setRequired(false)
  )
  .addStringOption(o =>
    o.setName("pfp_url")
      .setDescription("PFP URL (premium only)")
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

  const ytCategory   = interaction.options.getChannel("yt_category");
  const shopCategory = interaction.options.getChannel("shop_category");
  const shopPingRole = interaction.options.getRole("shop_ping_role");
  const shopPrefix   = interaction.options.getString("shop_prefix");
  const bannerUrlInput = interaction.options.getString("banner_url");
  const pfpUrlInput    = interaction.options.getString("pfp_url");

  const configs  = await getGuildConfigs();
  const existing = configs[guild.id] || {};

  const plan = existing.plan || "free";

  let bannerUrl = existing.bannerUrl || config.freeBannerUrl;
  let pfpUrl    = existing.pfpUrl    || config.freePfpUrl;

  if (plan === "premium") {
    if (bannerUrlInput) bannerUrl = bannerUrlInput;
    if (pfpUrlInput)    pfpUrl    = pfpUrlInput;
  } else {
    bannerUrl = config.freeBannerUrl;
    pfpUrl    = config.freePfpUrl;
  }

  // Keep existing prefix if not provided
  const finalPrefix = shopPrefix ?? existing.shopPrefix ?? "『🛍️』";

  configs[guild.id] = {
    guildId:      guild.id,
    plan,
    ytCategoryId:  ytCategory.id,
    shopCategoryId: shopCategory.id,
    bannerUrl,
    pfpUrl,
    shopPingRoleId: shopPingRole ? shopPingRole.id : (existing.shopPingRoleId ?? null),
    shopPrefix: finalPrefix
  };
  await saveGuildConfigs(configs);

  await interaction.reply({
    content:
      `Config saved for **${guild.name}** (plan: **${plan}**):\n` +
      `YT category: ${ytCategory}\n` +
      `Shop category: ${shopCategory}\n` +
      `Shop ping role: ${shopPingRole || "none"}\n` +
      `Shop prefix: \`${finalPrefix}\`\n` +
      `Banner: ${bannerUrl}\n` +
      `PFP: ${pfpUrl}`,
    ephemeral: true
  });
}
