import fs from "fs";
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Request a ping from the server owner.");

export async function execute(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    return await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true
    });
  }

  const ownerId = guild.ownerId;
  const owner = await interaction.client.users.fetch(ownerId);

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle("Ping Request")
    .setDescription(`User ${interaction.user} has requested a ping in server **${guild.name}**.`)
    .setTimestamp();

  try {
    await owner.send({ embeds: [embed] });
    await interaction.reply({
      content: "Ping request sent to the server owner.",
      ephemeral: true
    });
  } catch (error) {
    console.error("Failed to send DM to owner:", error);
    await interaction.reply({
      content: "Failed to send ping request. The owner might have DMs disabled.",
      ephemeral: true
    });
  }
}