import cron from "node-cron";
import { getWorkerConfig } from "../workerStorage.js";
import { resetAllStrikes } from "../handlers/strikeHandler.js";
import { sendLog } from "../handlers/logHandler.js";
import { checkDeadlines } from "../handlers/announcementHandler.js";

// ─── Start all cron tasks ─────────────────────────────────────────────────────

export function startCronTasks(client) {

  // ── Weekly strike reset: every Monday at 00:00 server time ───────────────
  cron.schedule("0 0 * * 1", async () => {
    console.log("[WeeklyReset] Running weekly strike reset...");
    try {
      const configs = await getWorkerConfig();
      for (const [guildId, cfg] of Object.entries(configs)) {
        const count = await resetAllStrikes(guildId);
        await sendLog(client, guildId, cfg.logChannelId, {
          type:  "weekly_reset",
          count
        });
      }
    } catch (e) {
      console.error("[WeeklyReset] Error:", e);
    }
  });

  // ── Deadline checker: every 5 minutes ────────────────────────────────────
  cron.schedule("*/5 * * * *", async () => {
    try {
      await checkDeadlines(client);
    } catch (e) {
      console.error("[DeadlineChecker] Error:", e);
    }
  });

  // ── Early leave checker: every 1 minute ──────────────────────────────────
  cron.schedule("* * * * *", async () => {
    try {
    } catch (e) {
      console.error("[LeaveChecker] Error:", e);
    }
  });

  console.log("[Cron] All tasks scheduled.");
}