import http from "http";
import https from "https";
import { URL } from "url";
import fs from "fs";
import { getWorker, saveWorker } from "./workerStorage.js";

const config = JSON.parse(
  fs.readFileSync(new URL("../config.json", import.meta.url))
);

// Runtime redirect URI — set when startOAuthServer() is called.
// This ensures the Codespaces public URL is used instead of the config.json value.
let runtimeRedirectUri = config.redirectUri ?? "http://localhost:3000/callback";

// ─── In-memory token store ────────────────────────────────────────────────────
// { [userId]: { accessToken, refreshToken, expiresAt } }
// Kept in memory — tokens are re-fetched via refresh if bot restarts and
// a membership check is needed. The refresh token is persisted in workers.json.
const tokenStore = new Map();

export function getRedirectUri() { return runtimeRedirectUri; }

// ─── Start the OAuth callback server ─────────────────────────────────────────

export function startOAuthServer(client) {
  // ── Detect public URL (Codespaces / Railway / local) ─────────────────────
  // In Codespaces, CODESPACE_NAME and GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
  // are set automatically. We use these to build the real public callback URL.
  const codespaceName   = process.env.CODESPACE_NAME;
  const codespaceDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "app.github.dev";
  const publicBase = codespaceName
    ? `https://${codespaceName}-3000.${codespaceDomain}`
    : (process.env.PUBLIC_URL ?? "http://localhost:3000");

  // Store as module-level so exchangeCode + buildOAuthUrl both use it
  runtimeRedirectUri = `${publicBase}/callback`;
  console.log(`[OAuth] Redirect URI: ${runtimeRedirectUri}`);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:3000`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        return res.end("Not found");
      }

      const code   = url.searchParams.get("code");
      const userId = url.searchParams.get("state"); // we set state = userId in the OAuth URL
      const error  = url.searchParams.get("error");

      // ── User denied the OAuth prompt ────────────────────────────────────
      if (error || !code || !userId) {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(deniedPage());
      }

      // ── Validate userId is a known accepted worker ───────────────────────
      const worker = await getWorker(userId);
      if (!worker || worker.status !== "accepted") {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(errorPage("This verification link is invalid or expired."));
      }

      // ── Exchange code for token ──────────────────────────────────────────
      const tokenData = await exchangeCode(code);
      if (!tokenData) {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(errorPage("Failed to verify. Please try again using the link in your DM."));
      }

      // ── Store tokens ─────────────────────────────────────────────────────
      const expiresAt = Date.now() + tokenData.expires_in * 1000;
      tokenStore.set(userId, {
        accessToken:  tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt
      });

      // Persist refresh token to workers.json so we can recover after restart
      await saveWorker(userId, {
        ...worker,
        verified:      true,
        refreshToken:  tokenData.refresh_token,
        verifiedAt:    new Date().toISOString()
      });

      // ── DM the user: verified ────────────────────────────────────────────
      try {
        const user = await client.users.fetch(userId);
        await user.send(
          "✅ **Verification successful!** The bot can now confirm your server joins during announcements. You're all set!"
        );
      } catch (_) { /* DMs may be closed */ }

      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(successPage());

    } catch (e) {
      console.error("OAuth callback error:", e);
      res.writeHead(500);
      res.end("Internal error");
    }
  });

  const port = 3000;
  server.listen(port, () => {
    console.log(`[OAuth] Callback server listening on http://localhost:${port}/callback`);
  });

  return server;
}

// ─── Exchange authorization code for access + refresh tokens ─────────────────

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id:     config.clientId,
    client_secret: config.clientSecret,
    grant_type:    "authorization_code",
    code,
    redirect_uri:  runtimeRedirectUri
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "discord.com",
        path:     "/api/v10/oauth2/token",
        method:   "POST",
        headers:  { "Content-Type": "application/x-www-form-urlencoded" }
      },
      (res) => {
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              console.error("Token exchange error:", parsed);
              resolve(null);
            } else {
              resolve(parsed);
            }
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", (e) => {
      console.error("Token exchange request error:", e);
      resolve(null);
    });
    req.write(body.toString());
    req.end();
  });
}

// ─── Refresh an expired access token ─────────────────────────────────────────

async function refreshAccessToken(userId, refreshToken) {
  const body = new URLSearchParams({
    client_id:     config.clientId,
    client_secret: config.clientSecret,
    grant_type:    "refresh_token",
    refresh_token: refreshToken
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "discord.com",
        path:     "/api/v10/oauth2/token",
        method:   "POST",
        headers:  { "Content-Type": "application/x-www-form-urlencoded" }
      },
      (res) => {
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", async () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              console.error("Refresh token error:", parsed);
              resolve(null);
            } else {
              const expiresAt = Date.now() + parsed.expires_in * 1000;
              tokenStore.set(userId, {
                accessToken:  parsed.access_token,
                refreshToken: parsed.refresh_token,
                expiresAt
              });
              // Persist the new refresh token
              const worker = await getWorker(userId);
              if (worker) {
                await saveWorker(userId, { ...worker, refreshToken: parsed.refresh_token });
              }
              resolve(parsed.access_token);
            }
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", (e) => {
      console.error("Refresh request error:", e);
      resolve(null);
    });
    req.write(body.toString());
    req.end();
  });
}

// ─── Get a valid access token for a user (refresh if needed) ─────────────────

async function getValidToken(userId) {
  const stored = tokenStore.get(userId);

  if (stored) {
    // Still valid with 60s buffer
    if (Date.now() < stored.expiresAt - 60_000) {
      return stored.accessToken;
    }
    // Try refresh
    return refreshAccessToken(userId, stored.refreshToken);
  }

  // Not in memory — check workers.json for persisted refresh token
  const worker = await getWorker(userId);
  if (worker?.refreshToken) {
    return refreshAccessToken(userId, worker.refreshToken);
  }

  return null; // User has not verified
}

// ─── Check if a user is in a specific server ──────────────────────────────────
//
// Returns: "in_server" | "not_in_server" | "unverified" | "error"

export async function checkUserInServer(userId, targetGuildId) {
  const accessToken = await getValidToken(userId);

  if (!accessToken) return "unverified";

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "discord.com",
        path:     "/api/v10/users/@me/guilds",
        method:   "GET",
        headers:  { Authorization: `Bearer ${accessToken}` }
      },
      (res) => {
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", () => {
          try {
            const guilds = JSON.parse(data);
            if (!Array.isArray(guilds)) {
              console.error("Guild fetch unexpected response:", guilds);
              resolve("error");
              return;
            }
            const inServer = guilds.some(g => g.id === targetGuildId);
            resolve(inServer ? "in_server" : "not_in_server");
          } catch {
            resolve("error");
          }
        });
      }
    );
    req.on("error", (e) => {
      console.error("Guild check request error:", e);
      resolve("error");
    });
    req.end();
  });
}

// ─── Restore tokens from disk on bot restart ─────────────────────────────────
// Called once on startup. Loads refresh tokens from workers.json into memory
// so the first membership check after restart doesn't fail.

export async function restoreTokensFromDisk() {
  try {
    const { getWorkers } = await import("./workerStorage.js");
    const workers = await getWorkers();
    let count = 0;
    for (const [userId, worker] of Object.entries(workers)) {
      if (worker.verified && worker.refreshToken) {
        // Store placeholder — will be refreshed on first real check
        tokenStore.set(userId, {
          accessToken:  null,
          refreshToken: worker.refreshToken,
          expiresAt:    0 // force refresh on next use
        });
        count++;
      }
    }
    console.log(`[OAuth] Restored ${count} worker token(s) from disk.`);
  } catch (e) {
    console.error("[OAuth] Failed to restore tokens:", e);
  }
}

// ─── HTML pages served to the user after OAuth ───────────────────────────────

function successPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Verified!</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #23272a; color: #dcddde;
      display: flex; align-items: center; justify-content: center; min-height: 100vh;
    }
    .card {
      background: #2c2f33; border-radius: 12px; padding: 48px 40px;
      text-align: center; max-width: 420px; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    .icon { font-size: 64px; margin-bottom: 16px; }
    h1 { font-size: 24px; color: #57f287; margin-bottom: 12px; }
    p  { color: #b9bbbe; line-height: 1.6; }
    .sub { font-size: 13px; color: #72767d; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Verified!</h1>
    <p>You may now close this tab and return to Discord.</p>
    <p class="sub">This tab will close automatically...</p>
  </div>
  <script>
    // Try to close the tab — works when opened via window.open() or link click
    try { window.close(); } catch(e) {}
    // Fallback: update text after 1.5s in case window.close() was blocked
    setTimeout(function() {
      document.querySelector('.sub').textContent = 'You can safely close this tab.';
    }, 1500);
  </script>
</body>
</html>`;
}

function deniedPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Cancelled</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #23272a; color: #dcddde;
      display: flex; align-items: center; justify-content: center; min-height: 100vh;
    }
    .card {
      background: #2c2f33; border-radius: 12px; padding: 48px 40px;
      text-align: center; max-width: 420px;
    }
    .icon { font-size: 64px; margin-bottom: 16px; }
    h1 { font-size: 24px; color: #faa61a; margin-bottom: 12px; }
    p  { color: #b9bbbe; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>Verification Cancelled</h1>
    <p>You cancelled the verification. You <strong>will receive strikes</strong> for any announcements until you verify.<br><br>Use the link in your DM to try again.</p>
  </div>
</body>
</html>`;
}

function errorPage(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #23272a; color: #dcddde;
      display: flex; align-items: center; justify-content: center; min-height: 100vh;
    }
    .card {
      background: #2c2f33; border-radius: 12px; padding: 48px 40px;
      text-align: center; max-width: 420px;
    }
    .icon { font-size: 64px; margin-bottom: 16px; }
    h1 { font-size: 24px; color: #ed4245; margin-bottom: 12px; }
    p  { color: #b9bbbe; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>Verification Failed</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}