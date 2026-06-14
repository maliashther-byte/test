import fs from "fs";
import { SlashCommandBuilder } from "discord.js";
import { getGuildConfigs, getKeys, saveKeys } from "../storage.js";
import crypto from "crypto";

const config = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));

export const data = new SlashCommandBuilder()
  .setName("genkey")
  .setDescription("Generate a shop key for this server.")
  .addIntegerOption(o => o.setName("duration_days").setDescription("Shop duration (days)").setMinValue(1).setRequired(true))
  // Daily
  .addIntegerOption(o => o.setName("daily_here").setDescription("@here pings per day").setMinValue(0).setRequired(true))
  .addIntegerOption(o => o.setName("daily_everyone").setDescription("@everyone pings per day").setMinValue(0).setRequired(true))
  .addIntegerOption(o => o.setName("daily_shop").setDescription("Shop pings per day").setMinValue(0).setRequired(true))
  // Weekly
  .addIntegerOption(o => o.setName("weekly_here").setDescription("@here pings per week").setMinValue(0).setRequired(true))
  .addIntegerOption(o => o.setName("weekly_everyone").setDescription("@everyone pings per week").setMinValue(0).setRequired(true))
  .addIntegerOption(o => o.setName("weekly_shop").setDescription("Shop pings per week").setMinValue(0).setRequired(true))
  // 3-day
  .addIntegerOption(o => o.setName("triday_here").setDescription("@here pings per 3 days").setMinValue(0).setRequired(false))
  .addIntegerOption(o => o.setName("triday_everyone").setDescription("@everyone pings per 3 days").setMinValue(0).setRequired(false))
  .addIntegerOption(o => o.setName("triday_shop").setDescription("Shop pings per 3 days").setMinValue(0).setRequired(false));

export async function execute(interaction) {
  const guild = interaction.guild;
  if (!guild) return interaction.reply({ content: "Guild only.", ephemeral: true });

  const isBotOwner  = interaction.user.id === config.ownerId;
  const isGuildOwner = interaction.user.id === guild.ownerId;
  if (!isBotOwner && !isGuildOwner) return interaction.reply({ content: "Only the guild owner or bot owner can use this.", ephemeral: true });

  const configs = await getGuildConfigs();
  const gCfg = configs[guild.id];
  if (!gCfg) return interaction.reply({ content: "Use `/setupguild` first.", ephemeral: true });

  const durationDays   = interaction.options.getInteger("duration_days");
  const dailyHere      = interaction.options.getInteger("daily_here");
  const dailyEveryone  = interaction.options.getInteger("daily_everyone");
  const dailyShop      = interaction.options.getInteger("daily_shop");
  const weeklyHere     = interaction.options.getInteger("weekly_here");
  const weeklyEveryone = interaction.options.getInteger("weekly_everyone");
  const weeklyShop     = interaction.options.getInteger("weekly_shop");
  const tridayHere     = interaction.options.getInteger("triday_here")     ?? 0;
  const tridayEveryone = interaction.options.getInteger("triday_everyone") ?? 0;
  const tridayShop     = interaction.options.getInteger("triday_shop")     ?? 0;

  const key = crypto.randomBytes(8).toString("hex");
  const now = Date.now();

  const keys = await getKeys();
  keys[key] = {
    guildId: guild.id, durationDays,
    dailyHere, dailyEveryone, dailyShop,
    weeklyHere, weeklyEveryone, weeklyShop,
    tridayHere, tridayEveryone, tridayShop,
    usedHereToday: 0, usedEveryoneToday: 0, usedShopToday: 0,
    usedHereThisWeek: 0, usedEveryoneThisWeek: 0, usedShopThisWeek: 0,
    usedHereThisTriday: 0, usedEveryoneThisTriday: 0, usedShopThisTriday: 0,
    dayResetTime: now, weekResetTime: now, tridayResetTime: now,
    used: false
  };
  await saveKeys(keys);

  await interaction.reply({
    content:
      `Key generated for **${guild.name}**:\n\`\`\`\n${key}\n\`\`\`\n` +
      `Duration: **${durationDays}** day${durationDays !== 1 ? "s" : ""}\n` +
      `Daily  — @here: ${dailyHere} | @everyone: ${dailyEveryone} | shop: ${dailyShop}\n` +
      `Weekly — @here: ${weeklyHere} | @everyone: ${weeklyEveryone} | shop: ${weeklyShop}\n` +
      `3-Day  — @here: ${tridayHere} | @everyone: ${tridayEveryone} | shop: ${tridayShop}`,
    ephemeral: true
  });
}