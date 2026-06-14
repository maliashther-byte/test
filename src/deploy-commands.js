import fs from "fs";
import { REST, Routes } from "discord.js";

// Existing commands
import * as setupguild  from "./commands/setupguild.js";
import * as ytsetup     from "./commands/ytsetup.js";
import * as genkey      from "./commands/genkey.js";
import * as redeem      from "./commands/redeem.js";
import * as premium     from "./commands/premium.js";
import * as help        from "./commands/help.js";
import * as ping        from "./commands/ping.js";
import * as admin       from "./handlers/admin.js";
import * as announce    from "./commands/announce.js";
import * as workersetup from "./commands/workersetup.js";
import * as limitedoffer from "./commands/limitedoffer.js";
import * as openshop    from "./commands/openshop.js";
import * as shoptrial   from "./commands/shoptrial.js";

// Games
import * as gamesSetup      from "./games/gamesSetup.js";
import * as gamesHost        from "./games/gamesHost.js";
import * as gamesTranscript  from "./games/gamesTranscript.js";

// Utilities
import * as autoReactor      from "./utilities/autoReactor.js";
import { sayData, sayEmbedData, editData } from "./utilities/sendAsBot.js";
import { panelData }          from "./utilities/savedMessages.js";
import { leaderboardData, resetLeaderboardData } from "./utilities/leaderboard.js";
import { data as reactorPanelData } from "./utilities/reactorPanel.js";
import { data as shopPanelData }    from "./utilities/shopPanel.js";

// Worker panel
import { data as workerPanelData }  from "./handlers/workerPanel.js";

// Giveaway
import {
  gcreateData, gendData, grerollData, glistData,
  gsetwinnerData, gcancelData,
  giveawayPanelData, geditData, gchoosewinnerData, extraEntriesData
} from "./giveaway/giveawayCommands.js";

const config = JSON.parse(fs.readFileSync(new URL("../config.json", import.meta.url)));

const commands = [
  // Existing
  setupguild.data, ytsetup.data, genkey.data, redeem.data,
  premium.data, help.data, ping.data,
  // admin.data,  // HIDDEN - uncomment to show admin commands
  announce.data, workersetup.data, limitedoffer.data,
  openshop.data, shoptrial.data,
  // Games
  gamesSetup.data, gamesHost.data, gamesHost.hintData, gamesTranscript.data,
  // Utilities
  autoReactor.data, sayData, sayEmbedData, editData,
  panelData, leaderboardData, resetLeaderboardData,
  reactorPanelData, shopPanelData,
  // Worker moderation
  workerPanelData,
  // Giveaway
  gcreateData, gendData, grerollData, glistData,
  gsetwinnerData, gcancelData,
  giveawayPanelData, geditData, gchoosewinnerData, extraEntriesData,
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

(async () => {
  await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
  console.log(`Global commands deployed (${commands.length} total).`);
})();