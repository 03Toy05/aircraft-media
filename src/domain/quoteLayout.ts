import { unzipSync } from "fflate";
import { airportPlace, legTimes, routeLabel, routingLines, maxPax, type Leg } from "./routing";
import { airportsFor } from "./airports";
import { OWNER_APPROVAL, QUOTE_LANGUAGES, QUOTE_LOCALE, QUOTE_WORDS, type QuoteLanguage } from "./quote";
import { optionNeedsApproval } from "./requests";
import { quoteAircraftName } from "./aircraftNamesZh";
import { DEFAULT_VERSION_FORMAT, formatVersion } from "./branding";
import { photoSlots, type PdfQuote } from "./quotePdf";
import { readDocxLayout } from "./docxLayout";
import { layoutTemplate, type LayoutFound, type QuoteLayout } from "./layoutTemplate";

/**
 * The broker's own quote layout: they upload a past quote (Word); Toy reads its look and where the quote's values go
 * (layoutTemplate.ts); every quote PDF is then drawn that way (layoutPdf.ts) while it is switched on.
 */

export const MAX_WORD_BYTES = 5 * 1024 * 1024;

/** Tags for the whole quote. */
export const QUOTE_TAGS = ["client", "reference", "date", "label", "greeting", "closing", "routing", "route", "pax", "options", "count", "broker_name", "broker_email"] as const;
/** Tags for one aircraft; with a number ({price_2}) for a particular one. */
export const AIRCRAFT_TAGS = ["number", "aircraft", "operator", "tail", "base", "yom", "yor", "seats", "wifi", "smoking", "pets", "price", "notes", "extra", "owner_approval"] as const;
/** Tags for one leg (a row of a routing table). */
export const LEG_TAGS = ["leg_date", "leg_from", "leg_to", "leg_dep", "leg_arr", "leg_time", "leg_pax"] as const;
/** Photo tags, with their default width in cm. */
export const PHOTO_TAGS: Record<string, number> = { photo_exterior: 16, photo_cabin: 8, photo_cabin2: 8, photo_floorplan: 16 };

/** Why a file can't be used; null when it can. */
export function checkWordFile(bytes: Uint8Array): "size" | "not_docx" | "macros" | null {
  if (!bytes.length || bytes.length > MAX_WORD_BYTES) return "size";
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return "not_docx";
  }
  if (!files["word/document.xml"] || !files["[Content_Types].xml"]) return "not_docx";
  if (Object.keys(files).some((f) => /vbaProject/i.test(f))) return "macros";
  return null;
}

// ---------------------------------------------------------------- the values

export interface LayoutValues {
  text: Record<string, string>;
  /** Photo tag with its aircraft number ("photo_cabin_2") → photo id. */
  photos: Record<string, string>;
  legs: Record<string, string>[];
  count: number;
}

const langOf = (l: string): QuoteLanguage => ((QUOTE_LANGUAGES as readonly string[]).includes(l) ? (l as QuoteLanguage) : "en");

/** Every field's value for one quote, in the quote's language. Aircraft fields are stored as "name_N". */
export function layoutValues(q: PdfQuote): LayoutValues {
  const lang = langOf(q.quote.lang);
  const w = QUOTE_WORDS[lang];
  const locale = QUOTE_LOCALE[lang];
  const inc = (q.quote.builder?.inc ?? {}) as Record<string, boolean>;
  const yes = (v?: string) => (v === "yes" ? w.wifiYes : v === "no" ? w.wifiNo : v === "tbc" ? w.wifiTbc : "");
  const allowed = (v?: string) => (v === "yes" ? w.allowed : v === "no" ? w.notAllowed : "");
  const legs: Leg[] = q.quote.legs ?? [];
  const airports = airportsFor(legs.flatMap((l) => [l.from, l.to]));
  const utc = q.quote.utc !== false;
  const fmtIso = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const options = q.quote.options;
  const pax = maxPax(legs);
  const text: Record<string, string> = {
    client: "", // the old client's name in the Word file: never carried over
    reference: q.reference ? formatVersion(q.brand?.versionFormat ?? DEFAULT_VERSION_FORMAT, q.reference, q.version) : "",
    date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(q.savedAt),
    label: q.quote.label ?? "",
    greeting: q.quote.greeting ?? "",
    closing: q.quote.closing ?? "",
    routing: legs.length ? routingLines(legs, airports, w, locale, { utc }).split("\n").slice(1).join("\n") : "",
    route: routeLabel(legs, airports),
    pax: pax ? w.pax(pax) : "",
    options: options.map((o, i) => `${i + 1}. ${quoteAircraftName(lang, o.type)}${o.price ? ` – ${o.price}` : ""}`).join("\n"),
    count: String(options.length),
    broker_name: q.broker.name,
    broker_email: q.broker.email,
  };
  const photos: Record<string, string> = {};
  options.forEach((o, i) => {
    const n = i + 1;
    const v: Record<string, string> = {
      number: String(n),
      aircraft: quoteAircraftName(lang, o.type),
      operator: inc.operator ? o.operator ?? "" : "",
      tail: inc.tail ? o.tail ?? "" : "",
      base: inc.base ? o.base ?? "" : "",
      yom: o.yom ? String(o.yom) : "",
      yor: o.yor ? String(o.yor) : "",
      seats: o.capacity ? w.seats(o.capacity) : "",
      wifi: yes(o.wifi),
      smoking: allowed(o.smoking),
      pets: allowed(o.pets),
      price: o.price ?? "",
      notes: inc.notes ? o.notes?.trim() ?? "" : "",
      extra: o.extra ?? "",
      owner_approval: optionNeedsApproval(o) ? OWNER_APPROVAL[lang] : "",
    };
    for (const [k, val] of Object.entries(v)) text[`${k}_${n}`] = val;
    const s = photoSlots(o.photos);
    const ids: Record<string, string | undefined> = { photo_exterior: s.exterior?.id, photo_cabin: s.cabins[0]?.id, photo_cabin2: s.cabins[1]?.id, photo_floorplan: s.floorPlan?.id };
    for (const [k, id] of Object.entries(ids)) if (id) photos[`${k}_${n}`] = id;
  });
  const legRows = legs.map((l) => {
    const t = legTimes(l, airports);
    return {
      leg_date: l.date ? fmtIso(l.date) : "",
      leg_from: airportPlace(l.from, airports),
      leg_to: airportPlace(l.to, airports),
      leg_dep: t.depLocal ? `${t.depLocal.time} ${w.lt}${utc && t.depUtc ? ` (${t.depUtc.time} UTC)` : ""}` : "",
      leg_arr: t.arrLocal ? `${t.arrLocal.time} ${w.lt}${t.arrDays ? ` +${t.arrDays}` : ""}${utc && t.arrUtc ? ` (${t.arrUtc.time} UTC)` : ""}` : "",
      leg_time: l.flight ? w.duration(Math.floor(l.flight / 60), l.flight % 60) : "",
      leg_pax: l.pax ? String(l.pax) : "",
    };
  });
  return { text, photos, legs: legRows, count: options.length };
}

// ---------------------------------------------------------------- the workspace's layout

type Db = import("../db/client").Db;

export interface StoredLayout { fileName: string; enabled: boolean; layout: QuoteLayout; found: LayoutFound; updatedAt: Date }

/** Reads a past quote into the layout and what Toy found in it. Throws when the file can't be read. */
export function learnLayout(bytes: Uint8Array): { layout: QuoteLayout; found: LayoutFound } {
  return layoutTemplate(readDocxLayout(bytes));
}

export async function getQuoteLayout(db: Db, tenantId: string): Promise<StoredLayout | null> {
  const { wordTemplates } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  const [t] = await db.select({ fileName: wordTemplates.fileName, enabled: wordTemplates.enabled, layout: wordTemplates.layout, found: wordTemplates.found, updatedAt: wordTemplates.updatedAt }).from(wordTemplates).where(eq(wordTemplates.tenantId, tenantId));
  if (!t?.layout || !t.found) return null;
  try {
    return { fileName: t.fileName, enabled: t.enabled !== false, layout: JSON.parse(t.layout), found: JSON.parse(t.found), updatedAt: t.updatedAt };
  } catch {
    return null;
  }
}

/** The layout quote PDFs use now, or null for the standard one. */
export async function activeQuoteLayout(db: Db, tenantId: string): Promise<QuoteLayout | null> {
  const l = await getQuoteLayout(db, tenantId);
  return l?.enabled ? l.layout : null;
}

/** Keeps the broker's past quote and what Toy read from it (replacing the one before), switched on. */
export async function setQuoteLayout(db: Db, tenantId: string, fileName: string, bytes: Uint8Array): Promise<{ error: "size" | "not_docx" | "macros" } | { found: LayoutFound }> {
  const why = checkWordFile(bytes);
  if (why) return { error: why };
  let learned;
  try {
    learned = learnLayout(bytes);
  } catch {
    return { error: "not_docx" };
  }
  const { wordTemplates } = await import("../db/schema");
  const name = (fileName || "Quote.docx").replace(/[\r\n<>]/g, "").slice(0, 120);
  const row = { fileName: name, docx: Buffer.from(bytes).toString("base64"), layout: JSON.stringify(learned.layout), found: JSON.stringify(learned.found), enabled: true, updatedAt: new Date() };
  await db.insert(wordTemplates).values({ tenantId, ...row }).onConflictDoUpdate({ target: wordTemplates.tenantId, set: row });
  return { found: learned.found };
}

export async function setQuoteLayoutEnabled(db: Db, tenantId: string, enabled: boolean): Promise<void> {
  const { wordTemplates } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  await db.update(wordTemplates).set({ enabled, updatedAt: new Date() }).where(eq(wordTemplates.tenantId, tenantId));
}

export async function removeQuoteLayout(db: Db, tenantId: string): Promise<void> {
  const { wordTemplates } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  await db.delete(wordTemplates).where(eq(wordTemplates.tenantId, tenantId));
}

/** The uploaded file, as it was uploaded. */
export async function getQuoteLayoutFile(db: Db, tenantId: string): Promise<{ fileName: string; bytes: Uint8Array } | null> {
  const { wordTemplates } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  const [t] = await db.select({ fileName: wordTemplates.fileName, docx: wordTemplates.docx }).from(wordTemplates).where(eq(wordTemplates.tenantId, tenantId));
  return t ? { fileName: t.fileName, bytes: new Uint8Array(Buffer.from(t.docx, "base64")) } : null;
}
