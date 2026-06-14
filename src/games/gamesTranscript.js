import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import { getGuildTranscripts } from "./gamesStorage.js";
import { MODES } from "./gamesHost.js";

export const data = new SlashCommandBuilder()
  .setName("transcript")
  .setDescription("View a transcript of a past game.");

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const transcripts = await getGuildTranscripts(interaction.guild.id);
  if (!transcripts.length) return interaction.editReply({ content: "No game transcripts found." });

  const recent = transcripts.slice(0, 25);

  const select = new StringSelectMenuBuilder()
    .setCustomId("transcript_select")
    .setPlaceholder("Select a game to view...")
    .addOptions(
      recent.map(t => ({
        label:       `${MODES[t.gameMode]?.META.name ?? t.gameMode} — ${t.winner ? `Won by ${t.winner.slice(0, 8)}` : "No winner"}`,
        description: t.endedAt ? new Date(t.endedAt).toLocaleString() : "Unknown date",
        value:       t.id
      }))
    );

  await interaction.editReply({ content: "📋 **Select a game to view its transcript:**", components: [new ActionRowBuilder().addComponents(select)] });
}

// SelectMenu: transcript_select
export async function handleTranscriptSelect(interaction) {
  await interaction.deferUpdate();

  const transcriptId = interaction.values[0];
  const transcripts  = await getGuildTranscripts(interaction.guild.id);
  const t            = transcripts.find(x => x.id === transcriptId);

  if (!t) return interaction.followUp({ content: "❌ Transcript not found.", ephemeral: true });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📋 Transcript — ${MODES[t.gameMode]?.META.name ?? t.gameMode}`)
    .addFields(
      { name: "🏆 Winner",   value: t.winner ? `<@${t.winner}>` : "No winner",          inline: true },
      { name: "🎮 Host",     value: `<@${t.hostId}>`,                                   inline: true },
      { name: "📅 Started",  value: `<t:${Math.floor(new Date(t.startedAt).getTime() / 1000)}:f>`, inline: true },
      { name: "📅 Ended",    value: t.endedAt ? `<t:${Math.floor(new Date(t.endedAt).getTime() / 1000)}:f>` : "N/A", inline: true },
      { name: "💬 Messages", value: `${t.messages?.length ?? 0}`,                       inline: true },
      ...(t.meta ? [{ name: "📊 Details", value: Object.entries(t.meta).map(([k, v]) => `**${k}:** ${JSON.stringify(v)}`).join("\n").slice(0, 1000), inline: false }] : [])
    )
    .setTimestamp();

  // Show last 10 messages
  const msgs = (t.messages ?? []).slice(-10);
  if (msgs.length) {
    embed.addFields({
      name:  "💬 Last 10 Messages",
      value: msgs.map(m => `<@${m.userId}>: ${String(m.content).slice(0, 80)}`).join("\n").slice(0, 1000),
      inline: false
    });
  }

  await interaction.followUp({ embeds: [embed], ephemeral: true });
}