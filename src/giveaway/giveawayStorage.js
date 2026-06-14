import fsExtra from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const dataDir    = path.join(__dirname, "..", "..", "data");

await fsExtra.ensureDir(dataDir);

const GIVEAWAYS_FILE = path.join(dataDir, "giveaways.json");

// ─── Internal helpers ─────────────────────────────────────────────────────────
async function loadAll() {
  try {
    if (!await fsExtra.pathExists(GIVEAWAYS_FILE)) {
      await fsExtra.writeJson(GIVEAWAYS_FILE, {}, { spaces: 2 });
      return {};
    }
    return await fsExtra.readJson(GIVEAWAYS_FILE);
  } catch {
    return {};
  }
}

async function saveAll(data) {
  await fsExtra.writeJson(GIVEAWAYS_FILE, data, { spaces: 2 });
}

// ─── Get/Save single giveaway ─────────────────────────────────────────────────
export async function getGiveaway(messageId) {
  const all = await loadAll();
  return all[messageId] ?? null;
}

export async function saveGiveaway(messageId, giveaway) {
  const all = await loadAll();
  all[messageId] = giveaway;
  await saveAll(all);
}

export async function deleteGiveaway(messageId) {
  const all = await loadAll();
  delete all[messageId];
  await saveAll(all);
}

// ─── Get all giveaways ────────────────────────────────────────────────────────
export async function getGiveaways() {
  return await loadAll();
}

export async function saveGiveaways(giveawaysObj) {
  await saveAll(giveawaysObj);
}

// ─── Get active giveaways ─────────────────────────────────────────────────────
export async function getAllActiveGiveaways() {
  const all = await loadAll();
  return Object.values(all).filter(g => !g.ended && !g.cancelled);
}

export async function getActiveGiveaways(guildId) {
  const all = await loadAll();
  return Object.values(all)
    .filter(g => g.guildId === guildId && !g.ended && !g.cancelled);
}
