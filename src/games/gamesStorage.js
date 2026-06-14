import fsExtra from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const dataDir    = path.join(__dirname, "..", "..", "data");

await fsExtra.ensureDir(dataDir);

const files = {
  config:      path.join(dataDir, "gamesConfig.json"),
  active:      path.join(dataDir, "gamesActive.json"),
  transcripts: path.join(dataDir, "gamesTranscripts.json"),
  ping:        path.join(dataDir, "pingManager.json"),
  sticky:      path.join(dataDir, "stickyMessages.json"),
  autoreact:   path.join(dataDir, "autoReactors.json"),
};

async function load(file) {
  try {
    if (!await fsExtra.pathExists(file)) { await fsExtra.writeJson(file, {}, { spaces: 2 }); return {}; }
    return await fsExtra.readJson(file);
  } catch { return {}; }
}
async function save(file, data) { await fsExtra.writeJson(file, data, { spaces: 2 }); }

export const getGamesConfig  = () => load(files.config);
export const saveGamesConfig = d  => save(files.config, d);
export async function getGuildGamesConfig(guildId) {
  const all = await getGamesConfig(); return all[guildId] ?? null;
}
export async function setGuildGamesConfig(guildId, data) {
  const all = await getGamesConfig(); all[guildId] = { ...all[guildId], ...data };
  await saveGamesConfig(all); return all[guildId];
}

export const getActiveGames  = () => load(files.active);
export const saveActiveGames = d  => save(files.active, d);
export async function getActiveGame(guildId) {
  const all = await getActiveGames(); return all[guildId] ?? null;
}
export async function setActiveGame(guildId, data) {
  const all = await getActiveGames(); all[guildId] = data; await saveActiveGames(all);
}
export async function clearActiveGame(guildId) {
  const all = await getActiveGames(); delete all[guildId]; await saveActiveGames(all);
}

export const getTranscripts  = () => load(files.transcripts);
export const saveTranscripts = d  => save(files.transcripts, d);
export async function saveTranscript(data) {
  const all = await getTranscripts();
  const id  = `${data.guildId}-${Date.now()}`;
  all[id]   = { id, ...data };
  await saveTranscripts(all);
  return id;
}
export async function getGuildTranscripts(guildId) {
  const all = await getTranscripts();
  return Object.values(all)
    .filter(t => t.guildId === guildId)
    .sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));
}

export const getPingConfig  = () => load(files.ping);
export const savePingConfig = d  => save(files.ping, d);
export async function getGuildPingConfig(guildId) {
  const all = await getPingConfig(); return all[guildId] ?? null;
}
export async function setGuildPingConfig(guildId, data) {
  const all = await getPingConfig(); all[guildId] = { ...all[guildId], ...data };
  await savePingConfig(all); return all[guildId];
}

export const getStickyMessages  = () => load(files.sticky);
export const saveStickyMessages = d  => save(files.sticky, d);
export async function getStickyForChannel(channelId) {
  const all = await getStickyMessages(); return all[channelId] ?? null;
}
export async function setStickyForChannel(channelId, data) {
  const all = await getStickyMessages(); all[channelId] = data; await saveStickyMessages(all);
}
export async function removeStickyForChannel(channelId) {
  const all = await getStickyMessages(); delete all[channelId]; await saveStickyMessages(all);
}

export const getAutoReactors  = () => load(files.autoreact);
export const saveAutoReactors = d  => save(files.autoreact, d);
export async function getReactorForChannel(channelId) {
  const all = await getAutoReactors(); return all[channelId] ?? null;
}
export async function setReactorForChannel(channelId, data) {
  const all = await getAutoReactors(); all[channelId] = data; await saveAutoReactors(all);
}
export async function removeReactorForChannel(channelId) {
  const all = await getAutoReactors(); delete all[channelId]; await saveAutoReactors(all);
}