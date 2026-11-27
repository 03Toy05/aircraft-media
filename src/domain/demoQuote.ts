import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import type { FileStore } from "../storage";
import { quoteLinks, quoteVersions, users } from "../db/schema";
import type { Actor } from "./action";
import type { Classification } from "./constants";
import { createAircraft, createAircraftType, createOrganisation } from "./directory";
import { approveMedia, getLineup, getMediaDetail, ingestUpload, setMediaAssociation, updateMediaMetadata } from "./media";
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
}

export interface DemoResult { created: boolean; links: Record<DemoLang, string> }

async function demoUser(db: Db, now: Date): Promise<Actor> {
  const [u] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL));
  if (u) return { id: u.id, tenantId: u.tenantId };
  const [n] = await db.insert(users).values({
    tenantId: randomUUID(), email: DEMO_EMAIL, displayName: "Aircraft Media", role: "owner",
    status: "active", plan: "full", firstSignInAt: now, lastSignInAt: now,
  }).returning();
  return { id: n.id, tenantId: n.tenantId };
}

/** The demo's links, by language, when they were already made. */
async function existingLinks(db: Db, tenantId: string): Promise<Partial<Record<DemoLang, string>>> {
  const rows = await db.select({ token: quoteLinks.token, lang: sql<string>`${quoteVersions.content}->>'lang'` }).from(quoteLinks)
    .innerJoin(quoteVersions, eq(quoteVersions.requestId, quoteLinks.requestId)).where(and(eq(quoteLinks.tenantId, tenantId), eq(quoteLinks.active, true)));
  const out: Partial<Record<DemoLang, string>> = {};
  for (const lang of Object.keys(DEMO_LANGS) as DemoLang[]) {
    const r = rows.find((x) => x.lang === DEMO_LANGS[lang]);
    if (r) out[lang] = r.token;
  }
  return out;
}

export async function makeDemoQuote(db: Db, store: FileStore, input: DemoInput, now = new Date()): Promise<DemoResult> {
  const me = await demoUser(db, now);
  const have = await existingLinks(db, me.tenantId);
  if (Object.keys(have).length === Object.keys(DEMO_LANGS).length) return { created: false, links: have as Record<DemoLang, string> };

  const a = input.aircraft;
  const k = () => randomUUID();
  const orgId = (await createOrganisation(db, me, k(), { name: a.operator })).result.organisationId;
  const typeId = (await createAircraftType(db, me, k(), { manufacturer: a.manufacturer, model: a.model, category: a.category })).result.aircraftTypeId;
  const aircraftId = (await createAircraft(db, me, k(), {
    aircraftTypeId: typeId, registration: a.tail ?? null, operatorId: orgId,
    info: { yom: a.yom ?? null, yor: null, capacity: a.capacity ?? null, wifiStatus: "unknown", notes: null },
  })).result.aircraftId;

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
  const item: QuoteAircraft = { type, operator: a.operator, tail: a.tail ?? null, base: a.base ?? null, yom: a.yom ?? null, yor: null, capacity: a.capacity ?? null, wifi: "unknown", price: a.price };
  const airports = Object.fromEntries(input.legs.flatMap((l) => [l.from, l.to]).map((c) => [c, findAirport(c)!]).filter(([, x]) => x));
  const links: Partial<Record<DemoLang, string>> = { ...have };
  for (const [site, lang] of Object.entries(DEMO_LANGS) as [DemoLang, QuoteLanguage][]) {
    if (links[site]) continue;
    // As the quote builder writes it: greeting, routing, the aircraft, closing. Operator left out (the broker's default).
    const opts = { language: lang, includeTail: true, includeBase: true, greeting: true };
    const parts = buildQuoteParts([item], opts);
    const routing = routingLines(input.legs, airports, QUOTE_WORDS[lang], QUOTE_LOCALE[lang]);
    const text = [parts.greeting, routing, ...parts.blocks, parts.closing].filter((x): x is string => !!x && x.trim() !== "").join("\n\n");
    const snap = cleanSnapshot({
      lang, text, greeting: parts.greeting, closing: parts.closing,
      options: [{ aircraftId, type, operator: a.operator, tail: a.tail ?? null, base: a.base ?? null, yom: a.yom ?? null, capacity: a.capacity ?? null, price: a.price, wifi: "unknown", photos }],
      builder: { inc: { operator: false, tail: true, base: true } },
    });
    const { requestId } = await saveQuoteVersion(db, me, null, input.legs, snap);
    await ensureLink(db, me, requestId);
    await setLink(db, me, requestId, { expiresAt: input.expiresAt });
    links[site] = (await db.select({ token: quoteLinks.token }).from(quoteLinks).where(eq(quoteLinks.requestId, requestId)))[0].token;
  }
  return { created: true, links: links as Record<DemoLang, string> };
}
