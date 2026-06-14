// ── /leaderboard — Message count leaderboard ─────────────────────────────────
import fs from "fs";
import fsExtra from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from "discord.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const dataDir    = path.join(__dirname, "..", "..", "data");
const file       = path.join(dataDir, "messageCounts.json");
const config     = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));

await fsExtra.ensureDir(dataDir);

async function load() {
  try {
    if (!await fsExtra.pathExists(file)) { await fsExtra.writeJson(file, {}, { spaces: 2 }); return {}; }
    return await fsExtra.readJson(file);
  } catch { return {}; }
}
async function save(data) { await fsExtra.writeJson(file, data, { spaces: 2 }); }

// ── Track every message ───────────────────────────────────────────────────────
export async function trackMessage(message) {
  if (!message.guild || message.author.bot) return;
  const all  = await load();
  const key  = `${message.guild.id}:${message.author.id}`;
  if (!all[key]) all[key] = { guildId: message.guild.id, userId: message.author.id, count: 0 };
  all[key].count++;
  all[key].lastMessageAt = new Date().toISOString();
  await save(all);
}

// ── /leaderboard ─────────────────────────────────────────────────────────────
export const leaderboardData = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Show the message count leaderboard.")
  .addRoleOption(o => o.setName("role").setDescription("Only count members with this role").setRequired(false))
  .addStringOption(o => o.setName("order").setDescription("Sort order").setRequired(false)
    .addChoices({ name: "Most messages (default)", value: "desc" }, { name: "Least messages", value: "asc" }))
  .addIntegerOption(o => o.setName("top").setDescription("How many to show (default 10, max 25)").setMinValue(1).setMaxValue(25).setRequired(false));

export async function executeLeaderboard(interaction) {
  await interaction.deferReply();

  const role  = interaction.options.getRole("role");
  const order = interaction.options.getString("order") ?? "desc";
  const top   = interaction.options.getInteger("top") ?? 10;

  const all     = await load();
  let entries   = Object.values(all).filter(e => e.guildId === interaction.guild.id);

  // Role filter
  if (role) {
    const members = await interaction.guild.members.fetch().catch(() => null);
    if (members) {
      const roleMembers = new Set(members.filter(m => m.roles.cache.has(role.id)).map(m => m.id));
      entries = entries.filter(e => roleMembers.has(e.userId));
    }
  }

  entries.sort((a, b) => order === "desc" ? b.count - a.count : a.count - b.count);
  const shown = entries.slice(0, top);

  if (!shown.length) return interaction.editReply({ content: "No message data found." });

  const medals = ["🥇","🥈","🥉"];
  const lines  = shown.map((e, i) => `${medals[i] ?? `**${i+1}.**`} <@${e.userId}> — **${e.count.toLocaleString()}** messages`).join("\n");

  const embed = new EmbedBuilder()
    .setColor(config.embedColor ?? 0x5865f2)
    .setTitle(`📊 Message Leaderboard${role ? ` — @${role.name}` : ""}`)
    .setDescription(lines)
    .setFooter({ text: `${order === "desc" ? "Most" : "Least"} to ${order === "desc" ? "least" : "most"} · ${shown.length} shown` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ── /resetleaderboard ─────────────────────────────────────────────────────────
export const resetLeaderboardData = new SlashCommandBuilder()
  .setName("resetleaderboard")
  .setDescription("Reset message counts for this server.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function executeResetLeaderboard(interaction) {
  if (interaction.user.id !== config.ownerId && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "❌ Admins only.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const all     = await load();
  const guildId = interaction.guild.id;
  for (const key of Object.keys(all)) {
    if (all[key].guildId === guildId) delete all[key];
  }
  await save(all);
  await interaction.editReply({ content: "✅ Message leaderboard reset for this server." });
}