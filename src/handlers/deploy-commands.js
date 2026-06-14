import fs from "fs";
import { REST, Routes } from "discord.js";

import * as setupguild from "./commands/setupguild.js";
import * as ytsetup from "./commands/ytsetup.js";
import * as genkey from "./commands/genkey.js";
import * as redeem from "./commands/redeem.js";
import * as premium from "./commands/premium.js";
import * as help from "./commands/help.js";
import * as ping from "./commands/ping.js";
import * as admin from "./handlers/admin.js";
import * as announce from "./commands/announce.js";
import * as workersetup from "./commands/workersetup.js";
import * as limitedoffer from "./commands/limitedoffer.js";
import { leaveNowData } from "./handlers/announcementHandler.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../config.json", import.meta.url))
);

const commands = [
  setupguild.data,
  ytsetup.data,
  genkey.data,
  redeem.data,
  premium.data,
  help.data,
  ping.data,
  admin.data,
  announce.data,
  workersetup.data,
  limitedoffer.data,
  leaveNowData
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

(async () => {
  await rest.put(Routes.applicationCommands(config.clientId), {
    body: commands
  });
  console.log("Global commands deployed.");
})();