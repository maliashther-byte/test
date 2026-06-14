import fs from "fs";
import { getWorker, saveWorker } from "../workerStorage.js";
import { sendLog } from "./logHandler.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../../config.json", import.meta.url))
);

const MAX_STRIKES_BEFORE_POINT_LOSS = 2;

// Strike reason labels for logs
const REASON_LABELS = {
  missed_deadline:           "Did not join or log proof before deadline",
  not_in_server_at_proof:    "Logged proof but was not in the server",
  early_leave:               "Left the server before the leave announcement",
  requirements_not_met:      "Did not complete the listed requirements"
};

// ─── Add a strike to a worker ─────────────────────────────────────────────────

export async function addStrike(userId, announcementId, reason, cfg, client) {
  const worker = await getWorker(userId);
  if (!worker || worker.status !== "accepted") return;

  const newStrikes = (worker.strikes ?? 0) + 1;
  let   newPoints  = worker.points ?? 0;
  let   pointLost  = false;

  // 2 strikes before weekly reset = lose 1 point
  if (newStrikes >= MAX_STRIKES_BEFORE_POINT_LOSS) {
    newPoints = Math.max(0, newPoints - 1);
    pointLost = true;
  }

  await saveWorker(userId, {
    ...worker,
    strikes: newStrikes,
    points:  newPoints
  });

  // Log the strike
  await sendLog(client, cfg.guildId, cfg.logChannelId, {
    type:          "strike_issued",
    userId,
    announcementId,
    reason:        REASON_LABELS[reason] ?? reason,
    strikes:       newStrikes,
    pointLost,
    points:        newPoints
  });

  // DM the worker
  try {
    const user = await client.users.fetch(userId);
    const msg =
      `⚡ **You received a strike.**\n` +
      `**Reason:** ${REASON_LABELS[reason] ?? reason}\n` +
      `**Strikes this week:** ${newStrikes}/2\n` +
      (pointLost
        ? `\n💀 You hit 2 strikes before the weekly reset. **−1 point** deducted.\n**Current points:** ${newPoints}`
        : `\n**Points:** ${newPoints}`);
    await user.send(msg);
  } catch (_) { /* DMs may be closed */ }
}

// ─── Remove a strike (manual correction by owner) ────────────────────────────

export async function removeStrike(userId, cfg, client) {
  const worker = await getWorker(userId);
  if (!worker) return false;

  const newStrikes = Math.max(0, (worker.strikes ?? 0) - 1);
  await saveWorker(userId, { ...worker, strikes: newStrikes });

  await sendLog(client, cfg.guildId, cfg.logChannelId, {
    type:    "strike_removed",
    userId,
    strikes: newStrikes
  });

  return true;
}

// ─── Reset all strikes for a guild (weekly cron) ─────────────────────────────

export async function resetAllStrikes(guildId) {
  const { getWorkers, saveWorkers } = await import("../workerStorage.js");
  const workers = await getWorkers();
  let count = 0;

  for (const [userId, worker] of Object.entries(workers)) {
    if (worker.guildId === guildId && worker.strikes > 0) {
      workers[userId].strikes = 0;
      count++;
    }
  }

  await saveWorkers(workers);
  console.log(`[WeeklyReset] Reset strikes for ${count} worker(s) in guild ${guildId}.`);
  return count;
}