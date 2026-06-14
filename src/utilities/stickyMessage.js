import fs from "fs";
import { EmbedBuilder } from "discord.js";
import { getStickyForChannel, setStickyForChannel, removeStickyForChannel, getStickyMessages } from "../games/gamesStorage.js";

const config = JSON.parse(fs.readFileSync(new URL("../../config.json", import.meta.url)));

// ─── Parse ?stick command ─────────────────────────────────────────────────────
// Usage:
//   ?stick <message>
//   ?stick --embed <message>
//   ?stick --color #hex <message>
//   ?stick --image <url> <message>
//   ?stick --title <title> --body <message>
//   ?stick --countdown <minutes> <message>   (auto-unstick after N minutes)
//   ?unstick
//   ?stickylist  (admin only)

export async function handleStickyCommand(message) {
  if (!message.guild || message.author.bot) return;
  const content = message.content.trim();

  if (!content.startsWith("?stick") && !content.startsWith("?unstick") && !content.startsWith("?stickylist")) return;

  // ?unstick
  if (content === "?unstick") {
    const sticky = await getStickyForChannel(message.channel.id);
    if (!sticky) return message.reply({ content: "❌ No sticky in this channel." }).then(m => setTimeout(() => m.delete().catch(() => {}), 4000));

    // Delete the last sticky message
    if (sticky.lastMsgId) {
      await message.channel.messages.delete(sticky.lastMsgId).catch(() => {});
    }
    await removeStickyForChannel(message.channel.id);
    await message.delete().catch(() => {});
    const conf = await message.channel.send({ content: "✅ Sticky removed." });
    setTimeout(() => conf.delete().catch(() => {}), 3000);
    return;
  }

  // ?stickylist — admin only
  if (content === "?stickylist") {
    if (!message.member.permissions.has("Administrator") && message.author.id !== config.ownerId) {
      return message.reply({ content: "❌ Admins only." }).then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
    }
    const all     = await getStickyMessages();
    const guild   = message.guild.id;
    const entries = Object.values(all).filter(s => s.guildId === guild);
    if (!entries.length) return message.reply({ content: "No stickies active." }).then(m => setTimeout(() => m.delete().catch(() => {}), 4000));

    const list = entries.map(s => `<#${s.channelId}>: ${String(s.content ?? s.embedOptions?.body ?? "embed").slice(0, 60)}`).join("\n");
    await message.reply({ content: `📌 **Active Stickies:**\n${list}` }).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
    await message.delete().catch(() => {});
    return;
  }

  // ?stick ...
  await message.delete().catch(() => {});
  const args   = content.slice("?stick".length).trim();
  const opts   = parseStickArgs(args);

  if (!opts.body && !opts.content) {
    const err = await message.channel.send({ content: "❌ Usage: `?stick <message>` or `?stick --embed --title <title> --body <text>`" });
    setTimeout(() => err.delete().catch(() => {}), 5000);
    return;
  }

  // Remove existing sticky first
  const existing = await getStickyForChannel(message.channel.id);
  if (existing?.lastMsgId) await message.channel.messages.delete(existing.lastMsgId).catch(() => {});

  const stickyData = {
    channelId:   message.channel.id,
    guildId:     message.guild.id,
    content:     opts.asEmbed ? null : (opts.content ?? opts.body),
    embedOptions: opts.asEmbed ? { title: opts.title, body: opts.body, color: opts.color, image: opts.image } : null,
    createdBy:   message.author.id,
    createdAt:   new Date().toISOString(),
    countdownMs: opts.countdown ? opts.countdown * 60000 : null,
    lastMsgId:   null
  };

  const sentMsg = await sendSticky(message.channel, stickyData);
  stickyData.lastMsgId = sentMsg.id;
  await setStickyForChannel(message.channel.id, stickyData);

  // Auto-unstick countdown
  if (opts.countdown) {
    setTimeout(async () => {
      const s = await getStickyForChannel(message.channel.id);
      if (!s) return;
      if (s.lastMsgId) await message.channel.messages.delete(s.lastMsgId).catch(() => {});
      await removeStickyForChannel(message.channel.id);
      const note = await message.channel.send({ content: "📌 Sticky expired and has been removed." });
      setTimeout(() => note.delete().catch(() => {}), 5000);
    }, opts.countdown * 60000);
  }
}

// ─── messageCreate — re-send sticky after any new message ────────────────────
export async function handleStickyOnMessage(message) {
  if (!message.guild || message.author.bot) return;
  if (message.content.startsWith("?")) return; // commands handled above

  const sticky = await getStickyForChannel(message.channel.id);
  if (!sticky) return;

  // Delete old sticky message
  if (sticky.lastMsgId) {
    await message.channel.messages.delete(sticky.lastMsgId).catch(() => {});
  }

  // Re-send at bottom
  const newMsg = await sendSticky(message.channel, sticky).catch(() => null);
  if (newMsg) {
    sticky.lastMsgId = newMsg.id;
    await setStickyForChannel(message.channel.id, sticky);
  }
}

// ─── Send sticky (plain or embed) ─────────────────────────────────────────────
async function sendSticky(channel, sticky) {
  if (sticky.embedOptions) {
    const e = sticky.embedOptions;
    const embed = new EmbedBuilder()
      .setDescription(e.body ?? "")
      .setColor(parseColor(e.color) ?? 0xfaa61a);
    if (e.title) embed.setTitle(e.title);
    if (e.image) embed.setImage(e.image);
    embed.setFooter({ text: "📌 Pinned message" });
    return channel.send({ embeds: [embed] });
  }
  return channel.send({ content: `📌 ${sticky.content}` });
}

// ─── Argument parser ──────────────────────────────────────────────────────────
function parseStickArgs(args) {
  const opts   = { asEmbed: false };
  let remaining = args;

  if (remaining.includes("--embed"))    { opts.asEmbed = true; remaining = remaining.replace("--embed", "").trim(); }

  const titleMatch     = remaining.match(/--title\s+"([^"]+)"/);
  const bodyMatch      = remaining.match(/--body\s+"([^"]+)"/);
  const colorMatch     = remaining.match(/--color\s+(#[0-9a-fA-F]{3,6})/);
  const imageMatch     = remaining.match(/--image\s+(https?:\/\/\S+)/);
  const countdownMatch = remaining.match(/--countdown\s+(\d+)/);

  if (titleMatch)     { opts.title    = titleMatch[1];        remaining = remaining.replace(titleMatch[0], "").trim(); }
  if (bodyMatch)      { opts.body     = bodyMatch[1];         remaining = remaining.replace(bodyMatch[0], "").trim(); }
  if (colorMatch)     { opts.color    = colorMatch[1];        remaining = remaining.replace(colorMatch[0], "").trim(); }
  if (imageMatch)     { opts.image    = imageMatch[1];        remaining = remaining.replace(imageMatch[0], "").trim(); }
  if (countdownMatch) { opts.countdown = parseInt(countdownMatch[1]); remaining = remaining.replace(countdownMatch[0], "").trim(); }

  // Anything left is the plain content / body
  if (remaining && !opts.body) opts.content = remaining;

  return opts;
}

function parseColor(hex) {
  if (!hex) return null;
  const n = parseInt(hex.replace("#", ""), 16);
  return isNaN(n) ? null : n;
}