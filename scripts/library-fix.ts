/**
 * Corrects library aircraft (type, serial, tail) from a JSON file: { "fixes": [{ "tail", "operator", "type"?, "serial"?, "newTail"? }] }
 *   npm run library:fix -- library-packs/faa-part135/fixes.json [--site http://localhost:3102]
 * Needs LIBRARY_UPLOAD_KEY in .env.local (never printed).
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const at = args.indexOf("--site");
const site = (at >= 0 ? args[at + 1] : process.env.LIBRARY_UPLOAD_SITE || "https://www.aircraftmedia.my").replace(/\/+$/, "");
const file = args.find((a, i) => !a.startsWith("--") && !(at >= 0 && i === at + 1));
const key = process.env.LIBRARY_UPLOAD_KEY;
if (!file) { console.error("Name the fixes file."); process.exit(1); }
if (!key || key.length < 32) { console.error("LIBRARY_UPLOAD_KEY isn't in .env.local."); process.exit(1); }
if (!/^https:\/\//.test(site) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(site)) { console.error(`Refusing to send the key to ${site}.`); process.exit(1); }
const res = await fetch(`${site}/api/library/fix`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: readFileSync(file, "utf8") });
const body = (await res.json().catch(() => ({}))) as { error?: string; results?: string[] };
if (!res.ok || !body.results) { console.error(body.error ?? `The site answered ${res.status}.`); process.exit(1); }
for (const r of body.results) console.log(r);
