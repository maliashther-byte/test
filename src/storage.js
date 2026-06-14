import fsExtra from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, "..", "data");
const guildConfigFile = path.join(dataDir, "guildConfigs.json");
const keysFile = path.join(dataDir, "keys.json");
const shopsFile = path.join(dataDir, "shops.json");
const ytRewardsFile = path.join(dataDir, "ytRewards.json");

await fsExtra.ensureDir(dataDir);

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

export async function getGuildConfigs() {
  return loadJson(guildConfigFile, {});
}

export async function saveGuildConfigs(data) {
  return saveJson(guildConfigFile, data);
}

export async function getKeys() {
  return loadJson(keysFile, {});
}

export async function saveKeys(data) {
  return saveJson(keysFile, data);
}

export async function getShops() {
  return loadJson(shopsFile, {});
}

export async function saveShops(data) {
  return saveJson(shopsFile, data);
}

export async function getYtRewards() {
  return loadJson(ytRewardsFile, {});
}

export async function saveYtRewards(data) {
  return saveJson(ytRewardsFile, data);
}
