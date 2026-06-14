import { EmbedBuilder } from "discord.js";
import fs from "fs";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

const TYPE_CONFIG = {
  point_granted:      { color: 0x57f287, title: "✅ Point Granted" },
  point_added:        { color: 0x57f287, title: "✅ Point Added (Admin)" },
  point_removed:      { color: 0xed4245, title: "➖ Point Removed (Admin)" },
  strike_issued:      { color: 0xfee75c, title: "⚡ Strike Issued" },
  strike_removed:     { color: 0x5865f2, title: "🔧 Strike Removed" },
  worker_timeout:     { color: 0xffa500, title: "⏱️ Worker Timed Out (Role)" },
  worker_timeout_end: { color: 0x57f287, title: "✅ Worker Timeout Ended" },
  worker_banned:      { color: 0xed4245, title: "🚫 Worker Banned from Role" },
  worker_unbanned:    { color: 0x57f287, title: "✅ Worker Unbanned" },
  application_accepted: { color: 0x57f287, title: "✅ Application Accepted" },
  application_rejected: { color: 0xed4245, title: "❌ Application Rejected" },
  reward_claimed:     { color: 0xffd700, title: "🏆 Reward Claimed" },
};

/**
 * Send a structured log embed to the log channel.
 *
 * @param {import("discord.js").Client} client
 * @param {string} guildId
 * @param {string} logChannelId
 * @param {object} payload  - varies by type, see TYPE_CONFIG keys
 */
export async function sendLog(client, guildId, logChannelId, payload) {
  if (!logChannelId) return;

  try {
    const guild   = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;
    const channel = await guild.channels.fetch(logChannelId).catch(() => null);
    if (!channel) return;

    const typeCfg = TYPE_CONFIG[payload.type] ?? { color: config.embedColor, title: `📋 ${payload.type}` };

    const embed = new EmbedBuilder()
      .setColor(typeCfg.color)
      .setTitle(typeCfg.title)
      .setTimestamp();

    const fields = [];

    if (payload.userId) {
      fields.push({ name: "User", value: `<@${payload.userId}> (\`${payload.userId}\`)`, inline: true });
    }
    if (payload.announcementId) {
      fields.push({ name: "Announcement ID", value: `\`${payload.announcementId}\``, inline: true });
    }
    if (payload.points !== undefined) {
      fields.push({ name: "Points", value: `${payload.points}`, inline: true });
    }
    if (payload.strikes !== undefined) {
      fields.push({ name: "Strikes", value: `${payload.strikes}`, inline: true });
    }
    if (payload.reason) {
      fields.push({ name: "Reason", value: payload.reason, inline: false });
    }
    if (payload.pointLost) {
      fields.push({ name: "Point Deducted", value: "Yes — 2 strikes threshold reached", inline: false });
    }
    if (payload.duration) {
      fields.push({ name: "Duration", value: payload.duration, inline: true });
    }
    if (payload.expiresAt) {
      const ts = Math.floor(new Date(payload.expiresAt).getTime() / 1000);
      fields.push({ name: "Expires", value: `<t:${ts}:R>`, inline: true });
    }
    if (payload.adminId) {
      fields.push({ name: "Admin", value: `<@${payload.adminId}> (\`${payload.adminId}\`)`, inline: true });
    }
    if (payload.note) {
      fields.push({ name: "Note", value: payload.note, inline: false });
    }

    if (fields.length > 0) embed.addFields(fields);

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("[LogHandler] Failed to send log:", err);
  }
}