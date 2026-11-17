/**
 * One-time helper to obtain the Google Drive refresh token for the app.
 *
 *   npm run drive:authorize
 *
 * Requires AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET in .env.local and this redirect URI registered on the OAuth client:
 *   http://127.0.0.1:53682/callback
 * It prints the refresh token to THIS terminal only. Put it in GOOGLE_DRIVE_REFRESH_TOKEN (.env.local, and the Render
 * dashboard). Never paste it into chat, commit it, or store it in Drive.
 */
import http from "node:http";

const clientId = process.env.AUTH_GOOGLE_ID;
const clientSecret = process.env.AUTH_GOOGLE_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET in .env.local first.");
  process.exit(1);
}
const redirect = "http://127.0.0.1:53682/callback";
const state = Math.random().toString(36).slice(2);
const url =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive",
    access_type: "offline",
    prompt: "consent",
    state,
  });

console.log("\nOpen this link in your browser and approve access with the Google account that owns the Aircraft Media folder:\n\n" + url + "\n");

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", redirect);
  if (u.pathname !== "/callback") return void res.writeHead(404).end();
  if (u.searchParams.get("state") !== state) return void res.writeHead(400).end("State mismatch");
  const code = u.searchParams.get("code");
  if (!code) return void res.writeHead(400).end("No code");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: "authorization_code" }),
  });
  const j = (await r.json()) as { refresh_token?: string; error?: string };
  res.writeHead(200, { "Content-Type": "text/plain" }).end(j.refresh_token ? "Done. Return to the terminal and you can close this tab." : `Failed: ${j.error ?? "no refresh token returned"}`);
  if (j.refresh_token) console.log("GOOGLE_DRIVE_REFRESH_TOKEN=" + j.refresh_token + "\n\nCopy that line into .env.local (and the Render dashboard). Do not share it.");
  else console.error("No refresh token returned:", j.error ?? "try again (revoke the app's earlier access first)");
  server.close();
});
server.listen(53682, "127.0.0.1");
