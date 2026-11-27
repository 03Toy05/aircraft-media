import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import type { FileStore } from "../storage";
import { aircraft as aircraftTable, quoteLinks, quoteVersions, users } from "../db/schema";
import type { Actor } from "./action";
import type { Classification } from "./constants";
import { createAircraft, createAircraftType, createOrganisation } from "./directory";
import { approveMedia, getLineup, getMediaDetail, ingestUpload, retireMedia, setMediaAssociation, updateMediaMetadata } from "./media";
import { QUOTE_LOCALE, QUOTE_WORDS, buildQuoteParts, type QuoteAircraft, type QuoteLanguage } from "./quote";
import { cleanSnapshot, saveQuoteVersion } from "./requests";
import { ensureLink, setLink } from "./quoteLinks";
import { routingLines, type Leg } from "./routing";
import { findAirport } from "./airports";

/**
 * The public website's "Let me try" ends with a real client link. It lives in its own demo workspace
 * (demo@aircraftmedia.my), never a broker's: one aircraft with its photos, and the same quote in English,
 * Traditional and Simplified Chinese, each with its own link that ends on a set date.
 * Running it again changes nothing and gives back the same links.
 */
export const DEMO_EMAIL = "demo@aircraftmedia.my";
export const DEMO_LANGS = { en: "en", "zh-hant": "zh-Hant", "zh-hans": "zh-Hans" } as const satisfies Record<string, QuoteLanguage>;
export type DemoLang = keyof typeof DEMO_LANGS;

export interface DemoInput {
  aircraft: { manufacturer: string; model: string; category?: string; operator: string; tail?: string | null; base?: string | null; yom?: number | null; capacity?: number | null; price: string };
  /** Photos in the order to show, with what each is. */
  photos: { name: string; bytes: Uint8Array; classification: Classification }[];
  legs: Leg[];
  expiresAt: Date;
  /** The links exist already: put these photos (and this wording) in as the next version of each quote, same links. */
  refresh?: boolean;
}

export interface DemoResult { created: boolean; refreshed?: boolean; links: Record<DemoLang, string> }

async function demoUser(db: Db, now: Date): Promise<Actor> {
  const [u] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL));
  if (u) return { id: u.id, tenantId: u.tenantId };
  const [n] = await db.insert(users).values({
    tenantId: randomUUID(), email: DEMO_EMAIL, displayName: "Aircraft Media", role: "owner",
    status: "active", plan: "full", firstSignInAt: now, lastSignInAt: now,
  }).returning();
  return { id: n.id, tenantId: n.tenantId };
}

/** The demo's links (and their requests), by language, when they were already made. */
async function existingLinks(db: Db, tenantId: string): Promise<Partial<Record<DemoLang, { token: string; requestId: string }>>> {
  const rows = await db.select({ token: quoteLinks.token, requestId: quoteLinks.requestId, lang: sql<string>`${quoteVersions.content}->>'lang'` }).from(quoteLinks)
    .innerJoin(quoteVersions, eq(quoteVersions.requestId, quoteLinks.requestId)).where(and(eq(quoteLinks.tenantId, tenantId), eq(quoteLinks.active, true)));
  const out: Partial<Record<DemoLang, { token: string; requestId: string }>> = {};
  for (const lang of Object.keys(DEMO_LANGS) as DemoLang[]) {
    const r = rows.find((x) => x.lang === DEMO_LANGS[lang]);
    if (r) out[lang] = { token: r.token, requestId: r.requestId };
  }
  return out;
}

export async function makeDemoQuote(db: Db, store: FileStore, input: DemoInput, now = new Date()): Promise<DemoResult> {
  const me = await demoUser(db, now);
  const have = await existingLinks(db, me.tenantId);
  const tokens = () => Object.fromEntries(Object.entries(have).map(([l, v]) => [l, v!.token])) as Record<DemoLang, string>;
  const complete = Object.keys(have).length === Object.keys(DEMO_LANGS).length;
  if (complete && !input.refresh) return { created: false, links: tokens() };

  const a = input.aircraft;
  const k = () => randomUUID();
  let aircraftId: string, typeId: string;
  const [existing] = complete ? await db.select().from(aircraftTable).where(and(eq(aircraftTable.tenantId, me.tenantId), eq(aircraftTable.active, true))) : [];
  if (existing) {
    // Refresh: the old photos go (kept in the record, no longer shown); the new ones come in below.
    aircraftId = existing.id; typeId = existing.aircraftTypeId;
    for (const l of await getLineup(db, { aircraftId, aircraftTypeId: typeId })) await retireMedia(db, me, k(), { mediaId: l.mediaId });
  } else {
    const orgId = (await createOrganisation(db, me, k(), { name: a.operator })).result.organisationId;
    typeId = (await createAircraftType(db, me, k(), { manufacturer: a.manufacturer, model: a.model, category: a.category })).result.aircraftTypeId;
    aircraftId = (await createAircraft(db, me, k(), {
      aircraftTypeId: typeId, registration: a.tail ?? null, operatorId: orgId,
      info: { yom: a.yom ?? null, yor: null, capacity: a.capacity ?? null, wifiStatus: "unknown", notes: null },
    })).result.aircraftId;
  }

  for (const p of input.photos) {
    const r = (await ingestUpload(db, store, me, { filename: p.name, bytes: p.bytes })).result;
    if (!r.mediaId) throw new Error(`The photo ${p.name} could not be added.`);
    let v = (await getMediaDetail(db, me.tenantId, r.mediaId))!.media.version;
    await updateMediaMetadata(db, me, k(), { mediaId: r.mediaId, expectedVersion: v, classification: p.classification });
    v++;
    await setMediaAssociation(db, me, k(), { mediaId: r.mediaId, expectedVersion: v, status: "actual_aircraft", aircraftId });
    const d = (await getMediaDetail(db, me.tenantId, r.mediaId))!;
    await approveMedia(db, me, { mediaId: r.mediaId, contentVersionId: d.media.currentContentVersionId!, expectedVersion: d.media.version });
  }
  const lineup = await getLineup(db, { aircraftId, aircraftTypeId: typeId });
  const photos = lineup.map((l) => ({ id: l.contentVersionId, label: l.label, classification: l.classification }));

  const type = `${a.manufacturer} ${a.model}`.trim();
  // The operator is never in the demo quote, not even in its saved data.
  const item: QuoteAircraft = { type, operator: null, tail: a.tail ?? null, base: a.base ?? null, yom: a.yom ?? null, yor: null, capacity: a.capacity ?? null, wifi: "unknown", price: a.price };
  const airports = Object.fromEntries(input.legs.flatMap((l) => [l.from, l.to]).map((c) => [c, findAirport(c)!]).filter(([, x]) => x));
  const links: Partial<Record<DemoLang, string>> = {};
  for (const [site, lang] of Object.entries(DEMO_LANGS) as [DemoLang, QuoteLanguage][]) {
    // As the quote builder writes it: greeting, routing, the aircraft, closing. Operator left out (the broker's default).
    const opts = { language: lang, includeTail: true, includeBase: true, greeting: true };
    const parts = buildQuoteParts([item], opts);
    const routing = routingLines(input.legs, airports, QUOTE_WORDS[lang], QUOTE_LOCALE[lang]);
    const text = [parts.greeting, routing, ...parts.blocks, parts.closing].filter((x): x is string => !!x && x.trim() !== "").join("\n\n");
    const snap = cleanSnapshot({
      lang, text, greeting: parts.greeting, closing: parts.closing,
      options: [{ aircraftId, type, operator: null, tail: a.tail ?? null, base: a.base ?? null, yom: a.yom ?? null, capacity: a.capacity ?? null, price: a.price, wifi: "unknown", photos }],
      builder: { inc: { operator: false, tail: true, base: true } },
    });
    const { requestId } = await saveQuoteVersion(db, me, have[site]?.requestId ?? null, input.legs, snap);
    await ensureLink(db, me, requestId);
    await setLink(db, me, requestId, { expiresAt: input.expiresAt });
    links[site] = (await db.select({ token: quoteLinks.token }).from(quoteLinks).where(eq(quoteLinks.requestId, requestId)))[0].token;
  }
  return { created: !complete, refreshed: complete, links: links as Record<DemoLang, string> };
}
