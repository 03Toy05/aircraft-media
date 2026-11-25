/**
 * Makes a sample quote PDF from the Phenix Jet folder (real photos, owner's-approval notes) in a throwaway database,
 * to look at the layout: npx tsx tests/sampleQuotePdf.manual.ts <out.pdf>. Not part of the test run.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { setup } from "./helpers";
import { ingestUpload } from "../src/domain/media";
import { cleanSnapshot, saveQuoteVersion } from "../src/domain/requests";
import { setBrandColor, setVersionFormat } from "../src/domain/branding";
import { brokerQuotePdf } from "../src/domain/quotePdf";

const out = process.argv[2];
const dir = "library-packs/phenix-jet";
const pack = JSON.parse(fs.readFileSync(`${dir}/pack.json`, "utf8"));

const t = await setup();
const up = async (file: string, classification: string) => {
  const r = await ingestUpload(t.db, t.store, t.actor, { filename: file, bytes: new Uint8Array(fs.readFileSync(`${dir}/${file}`)) });
  return { id: r.result.contentVersionId, label: classification.toUpperCase(), classification };
};
const options = [];
for (const [i, a] of pack.aircraft.slice(0, 2).entries()) {
  const photos = [];
  for (const [kind, files] of Object.entries(a.photos as Record<string, string[]>)) for (const f of files) photos.push(await up(f, kind));
  options.push({
    aircraftId: randomUUID(), type: a.type, tail: a.tail, operator: pack.operator, capacity: a.capacity, yom: a.yom ?? 2019 + i, yor: 2024,
    wifi: "yes", smoking: a.smoking ?? "no", pets: a.pets ?? "unknown", notes: a.notes, price: i ? "USD 265,000 + tax" : "USD 248,000 + tax", photos,
  });
}
await setBrandColor(t.db, t.actor.tenantId, "#0a7c3e");
await setVersionFormat(t.db, t.actor.tenantId, "{ref} Rev.{n}");
const legs = [
  { from: "VHHH", to: "EGLF", date: "2026-12-12", time: "16:30", flight: 765, pax: 8 },
  { from: "EGLF", to: "VHHH", date: "2026-12-18", time: "10:00", flight: 720, pax: 8 },
];
const snap = cleanSnapshot({ lang: "en", text: "x", label: "Revised price", greeting: "Dear Mr Chan, thank you for your enquiry. Please find our proposal below.", closing: "We would be delighted to arrange this trip for you. Prices are subject to availability at booking.", options, builder: { inc: { operator: true, notes: true } } });
const { requestId } = await saveQuoteVersion(t.db, t.actor, null, legs, snap);
const pdf = await brokerQuotePdf(t.db, t.store, { isAdmin: true, actor: t.actor, email: "owner@example.test" }, requestId);
fs.writeFileSync(out, pdf!.bytes);
console.log("wrote", out, pdf!.filename, pdf!.bytes.length, "bytes");
