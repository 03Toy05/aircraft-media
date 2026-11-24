/**
 * Loads one operator folder (pack.json plus its photos) into the live library, without a browser.
 *
 *   npm run library:upload -- library-packs/avcon-jet
 *   npm run library:upload -- library-packs/avcon-jet --site http://localhost:3100
 *
 * Needs LIBRARY_UPLOAD_KEY in .env.local (the same value as on Render). The key is only sent to the site, never printed.
 * The site is LIBRARY_UPLOAD_SITE, else https://www.aircraftmedia.my.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const MAX = 45 * 1024 * 1024;
const PHOTO = /\.(jpe?g|png|webp)$/i;
const TYPE: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".json": "application/json" };

function fail(msg: string): never {
  console.error("✗ " + msg);
  process.exit(1);
}

const args = process.argv.slice(2);
const siteAt = args.indexOf("--site");
const site = (siteAt >= 0 ? args[siteAt + 1] : process.env.LIBRARY_UPLOAD_SITE || "https://www.aircraftmedia.my").replace(/\/+$/, "");
const dirs = args.filter((a, i) => !a.startsWith("--") && !(siteAt >= 0 && i === siteAt + 1));
const key = process.env.LIBRARY_UPLOAD_KEY;
if (!dirs.length) fail("Name a folder, e.g. npm run library:upload -- library-packs/avcon-jet");
if (!key || key.length < 32) fail("LIBRARY_UPLOAD_KEY isn't in .env.local (or is too short). Run npm run library:new-key first.");
if (!/^https:\/\//.test(site) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(site)) fail(`Refusing to send the key to ${site}: use https (or localhost).`);

const auth = { Authorization: `Bearer ${key}` };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function upload(dir: string) {
  const packPath = path.join(dir, "pack.json");
  let pack: { operator?: string; aircraft?: unknown[] };
  try { pack = JSON.parse(readFileSync(packPath, "utf8")); } catch { fail(`${packPath} is missing or isn't valid JSON.`); }
  const names = readdirSync(dir).filter((n) => n === "pack.json" || PHOTO.test(n));
  const bytes = names.reduce((n, f) => n + statSync(path.join(dir, f)).size, 0);
  if (bytes > MAX) fail(`${dir} is ${(bytes / 1e6).toFixed(1)} MB; the limit is 45 MB. Split it into two folders with the same pack.json.`);

  const form = new FormData();
  for (const n of names) form.append("files", new Blob([readFileSync(path.join(dir, n))], { type: TYPE[path.extname(n).toLowerCase()] ?? "application/octet-stream" }), n);
  console.log(`→ ${pack.operator}: ${pack.aircraft?.length ?? 0} aircraft, ${names.length - 1} photos (${(bytes / 1e6).toFixed(1)} MB) to ${site}`);

  const res = await fetch(`${site}/api/library/import`, { method: "POST", headers: auth, body: form });
  const body = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
  if (res.status === 404) fail("The site's upload address is off: LIBRARY_UPLOAD_KEY isn't set on the site (Render → Environment).");
  if (res.status === 401) fail("The site refused the key: LIBRARY_UPLOAD_KEY in .env.local isn't the same as on Render.");
  if (!res.ok || !body.jobId) fail(body.error ?? `The site answered ${res.status}.`);

  let last = "";
  for (;;) {
    await sleep(4000);
    const r = await fetch(`${site}/api/library/import?job=${encodeURIComponent(body.jobId)}`, { headers: auth });
    const s = (await r.json().catch(() => ({}))) as { done?: number; total?: number; current?: string; finished?: boolean; message?: string | null; error?: string | null };
    if (!r.ok) fail(s.error ?? `The site answered ${r.status} while importing.`);
    if (s.finished) {
      if (s.error) fail(`The import stopped: ${s.error}. Run it again to finish it (what is already in is kept).`);
      console.log("✓ " + s.message);
      return;
    }
    const line = `  ${s.done}/${s.total}${s.current ? ` · ${s.current}` : ""}`;
    if (line !== last) console.log((last = line));
  }
}

for (const d of dirs) await upload(d);
