import fsExtra from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, "..", "data");

// File paths
const workerConfigFile  = path.join(dataDir, "workerConfig.json");
const workersFile       = path.join(dataDir, "workers.json");
const announcementsFile = path.join(dataDir, "announcements.json");
const ticketsFile       = path.join(dataDir, "tickets.json");

await fsExtra.ensureDir(dataDir);

// ─── Generic helpers ──────────────────────────────────────────────────────────

async function loadJson(file, def) {
  try {
    const exists = await fsExtra.pathExists(file);
    if (!exists) {
      await fsExtra.writeJson(file, def, { spaces: 2 });
      return def;
    }
    return await fsExtra.readJson(file);
  } catch {
    return def;
  }
}

async function saveJson(file, data) {
  await fsExtra.writeJson(file, data, { spaces: 2 });
}

// ─── Worker Config ────────────────────────────────────────────────────────────
//
// Stores per-guild channel IDs and settings set via /workersetup.
//
// Shape:
// {
//   [guildId]: {
//     applicationChannelId : string,   // #application  — form overview
//     announcementChannelId: string,   // #announcements — owner posts jobs
//     logChannelId         : string,   // #logs          — bot logs
//     guideChannelId       : string,   // #guide         — manual + buttons
//     acceptedRoleId       : string,   // role given on acceptance
//     timeLimitHours       : number,   // default time limit (overridden per-announcement)
//     maxJoins             : number,   // max rewarded joins per announcement (0 = unlimited)
//   }
// }

export async function getWorkerConfig() {
  return loadJson(workerConfigFile, {});
}

export async function saveWorkerConfig(data) {
  return saveJson(workerConfigFile, data);
}

// ─── Workers ──────────────────────────────────────────────────────────────────
//
// Tracks every accepted worker's points, strikes, status, and join history.
//
// Shape:
// {
//   [userId]: {
//     userId      : string,
//     guildId     : string,
//     status      : "pending" | "accepted" | "rejected" | "banned",
//     points      : number,
//     strikes     : number,               // resets weekly
//     totalPoints : number,               // lifetime total (never resets)
//     appliedAt   : ISO string,
//     acceptedAt  : ISO string | null,
//     applicationAnswers: { why: string } // form answers
//   }
// }

export async function getWorkers() {
  return loadJson(workersFile, {});
}

export async function saveWorkers(data) {
  return saveJson(workersFile, data);
}

// Convenience: get one worker (returns null if not found)
export async function getWorker(userId) {
  const workers = await getWorkers();
  return workers[userId] ?? null;
}

// Convenience: upsert one worker
export async function saveWorker(userId, workerData) {
  const workers = await getWorkers();
  workers[userId] = { ...workers[userId], ...workerData };
  await saveWorkers(workers);
  return workers[userId];
}

// ─── Announcements ────────────────────────────────────────────────────────────
//
// Tracks every active (and recently closed) announcement.
//
// Shape:
// {
//   [announcementId]: {
//     id              : string,           // Discord message ID of the announcement msg
//     guildId         : string,
//     link            : string,           // server invite link
//     requirements    : string,           // text requirements
//     timeLimitHours  : number,
//     maxJoins        : number,           // 0 = unlimited
//     postedAt        : ISO string,
//     deadlineAt      : ISO string,       // postedAt + timeLimitHours
//     closed          : boolean,          // true after time limit passes
//     joins: {
//       [userId]: {
//         userId      : string,
//         joinedAt    : ISO string | null,
//         leftAt      : ISO string | null,
//         proofMsgId  : string | null,    // message ID of their proof submission
//         rewarded    : boolean,          // point already granted
//         capped      : boolean,          // joined after max joins reached — no strike/reward
//         strikeGiven : boolean,          // already issued a miss-strike
//       }
//     }
//   }
// }

export async function getAnnouncements() {
  return loadJson(announcementsFile, {});
}

export async function saveAnnouncements(data) {
  return saveJson(announcementsFile, data);
}

export async function getAnnouncement(announcementId) {
  const all = await getAnnouncements();
  return all[announcementId] ?? null;
}

export async function saveAnnouncement(announcementId, data) {
  const all = await getAnnouncements();
  all[announcementId] = { ...all[announcementId], ...data };
  await saveAnnouncements(all);
  return all[announcementId];
}

// ─── Tickets ──────────────────────────────────────────────────────────────────
//
// Tracks reward-claim tickets opened from the guide channel.
//
// Shape:
// {
//   [channelId]: {
//     channelId : string,   // the ticket channel ID
//     userId    : string,
//     guildId   : string,
//     openedAt  : ISO string,
//     status    : "open" | "fulfilled" | "closed",
//     points    : number,   // points at time of opening (snapshot)
//   }
// }

export async function getTickets() {
  return loadJson(ticketsFile, {});
}

export async function saveTickets(data) {
  return saveJson(ticketsFile, data);
}

export async function getTicket(channelId) {
  const all = await getTickets();
  return all[channelId] ?? null;
}

export async function saveTicket(channelId, data) {
  const all = await getTickets();
  all[channelId] = { ...all[channelId], ...data };
  await saveTickets(all);
  return all[channelId];
}