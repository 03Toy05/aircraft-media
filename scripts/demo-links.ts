/**
 * Makes the website's "Let me try" client links: the Hawker 850XP sample, in English, Traditional and Simplified
 * Chinese, in the demo workspace (demo@aircraftmedia.my), each ending on 30 June 2027.
 *   npm run demo:links                              (the live site)
 *   npm run demo:links -- --site http://localhost:3102
 * Needs LIBRARY_UPLOAD_KEY in .env.local (never printed). Prints the three links. Running it again gives the same links.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const at = args.indexOf("--site");
const site = (at >= 0 ? args[at + 1] : process.env.LIBRARY_UPLOAD_SITE || "https://www.aircraftmedia.my").replace(/\/+$/, "");
const key = process.env.LIBRARY_UPLOAD_KEY;
if (!key || key.length < 32) { console.error("LIBRARY_UPLOAD_KEY isn't in .env.local."); process.exit(1); }
if (!/^https:\/\//.test(site) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(site)) { console.error(`Refusing to send the key to ${site}.`); process.exit(1); }

const dir = "library-packs/let-me-try-sample/hawker-850xp";
const photos = [
  { name: "exterior.jpg", classification: "exterior" },
  { name: "cabin-1.jpg", classification: "cabin" },
  { name: "cabin-2.jpg", classification: "cabin" },
  { name: "floorplan.jpg", classification: "floor_plan" },
];
const spec = {
  aircraft: { manufacturer: "Hawker", model: "850XP", category: "midsize_jet", operator: "Executive Wings", base: "Bangkok", capacity: 8, price: "USD [your price]" },
  legs: [{ from: "VHHH", to: "VTBS", date: "2027-03-12", time: "10:00", flight: 165, pax: 4 }],
  expiresAt: "2027-06-30T23:59:59+08:00",
  photos,
};
const form = new FormData();
form.set("spec", JSON.stringify(spec));
for (const p of photos) form.append("files", new Blob([readFileSync(path.join(dir, p.name))], { type: "image/jpeg" }), p.name);
const res = await fetch(`${site}/api/demo`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
const body = (await res.json().catch(() => ({}))) as { error?: string; created?: boolean; links?: Record<string, string> };
if (!res.ok || !body.links) { console.error(body.error ?? `The site answered ${res.status}.`); process.exit(1); }
console.log(body.created ? "Made the demo quote." : "The demo quote was already there.");
for (const [lang, token] of Object.entries(body.links)) console.log(`${lang}: ${site}/q/${token}`);
