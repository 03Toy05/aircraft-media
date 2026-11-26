import { and, desc, eq, inArray, like, max, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { quoteVersions, requests } from "../db/schema";
import type { Actor } from "./action";
import { cleanLegs, requestLabel, type Leg } from "./routing";
import { airportsFor, findAirport } from "./airports";

/**
 * Requests and their saved quotes. A request is the routing the client asked for (no client details are kept);
 * each saved quote is a version under it (v1, v2…), never changed after saving.
 */

export interface QuoteSnapshotPhoto { id: string; label: string; classification: string }
export interface QuoteSnapshotOption {
  aircraftId: string; type: string; operator: string | null; tail: string | null; base: string | null;
  yom: number | null; yor: number | null; capacity: number | null; price: string; extra: string; photos: QuoteSnapshotPhoto[];
  /** yes | no | tbc | unknown (Wi-Fi), yes | no | unknown (smoking, pets), and the aircraft's notes ("Owner's approval required"). */
  wifi?: string; smoking?: string; pets?: string; notes?: string | null;
}
/** What a saved quote holds: the routing and message as sent, each option as quoted, and the Quote page's state to reopen it. */
export interface QuoteSnapshot {
  lang: string; text: string; legs: Leg[]; options: QuoteSnapshotOption[]; builder: Record<string, unknown>;
  /** The opening and closing lines as written (for the client's page and the PDF), and whether times show UTC. */
  greeting?: string | null; closing?: string | null; utc?: boolean;
  /** The broker's own name for this version ("Revised price"), shown with the reference. */
  label?: string | null;
}


export const MAX_SNAPSHOT_BYTES = 300_000;

const pad = (n: number) => String(n).padStart(3, "0");

/** The next free reference this month: AM-2611-001, AM-2611-002… */
export async function nextReference(db: Db, tenantId: string, now = new Date()): Promise<string> {
  const prefix = `AM-${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, "0")}-`;
  const rows = await db.select({ r: requests.reference }).from(requests).where(and(eq(requests.tenantId, tenantId), like(requests.reference, `${prefix}%`)));
  const top = rows.reduce((m, x) => Math.max(m, Number(x.r.slice(prefix.length)) || 0), 0);
  return prefix + pad(top + 1);
}

export async function createRequest(db: Db, actor: Actor, input: { legs: unknown; notes?: string | null }, now = new Date()): Promise<{ id: string; reference: string }> {
  const legs = cleanLegs(input.legs, findAirport);
  const notes = (input.notes ?? "").trim().slice(0, 2000) || null;
  for (let attempt = 0; ; attempt++) {
    const reference = await nextReference(db, actor.tenantId, now);
    try {
      const [r] = await db.insert(requests).values({ tenantId: actor.tenantId, reference, legs, notes, createdBy: actor.id }).returning({ id: requests.id });
      return { id: r.id, reference };
    } catch (e) {
      // Two made at once took the same number: try the next one.
      if (attempt >= 4) throw e;
    }
  }
}

export async function getRequest(db: Db, tenantId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [r] = await db.select().from(requests).where(and(eq(requests.id, id), eq(requests.tenantId, tenantId)));
  return r ?? null;
}

export async function updateRequest(db: Db, actor: Actor, id: string, input: { legs: unknown; notes?: string | null }) {
  const r = await getRequest(db, actor.tenantId, id);
  if (!r) throw new Error("That request is no longer here.");
  const legs = cleanLegs(input.legs, findAirport);
  await db.update(requests).set({ legs, notes: (input.notes ?? "").trim().slice(0, 2000) || null, updatedAt: new Date() }).where(eq(requests.id, id));
}

export async function setArchived(db: Db, actor: Actor, id: string, archived: boolean) {
  await db.update(requests).set({ archived, updatedAt: new Date() }).where(and(eq(requests.id, id), eq(requests.tenantId, actor.tenantId)));
}

export interface RequestRow { id: string; reference: string; legs: Leg[]; label: string; notes: string | null; archived: boolean; updatedAt: Date; versions: number; lastSavedAt: Date | null }

/** This workspace's requests, newest first; `q` finds a reference, an airport or a note. */
export async function listRequests(db: Db, tenantId: string, opts: { q?: string; archived?: boolean } = {}): Promise<RequestRow[]> {
  const rows = await db.select().from(requests)
    .where(and(eq(requests.tenantId, tenantId), eq(requests.archived, !!opts.archived)))
    .orderBy(desc(requests.updatedAt)).limit(500);
  const ids = rows.map((r) => r.id);
  const counts = ids.length
    ? await db.select({ id: quoteVersions.requestId, n: sql<number>`count(*)`, last: max(quoteVersions.createdAt) }).from(quoteVersions).where(inArray(quoteVersions.requestId, ids)).groupBy(quoteVersions.requestId)
    : [];
  const byId = new Map(counts.map((c) => [c.id, c]));
  const words = (opts.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return rows
    .map((r) => ({
      id: r.id, reference: r.reference, legs: r.legs, label: requestLabel(r.legs, airportsFor(r.legs.flatMap((l) => [l.from, l.to]))), notes: r.notes, archived: r.archived, updatedAt: r.updatedAt,
      versions: Number(byId.get(r.id)?.n ?? 0), lastSavedAt: byId.get(r.id)?.last ? new Date(byId.get(r.id)!.last as unknown as string) : null,
    }))
    .filter((r) => {
      if (!words.length) return true;
      const hay = `${r.reference} ${r.label} ${r.legs.map((l) => `${l.from} ${l.to}`).join(" ")} ${r.notes ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
}

/** Checks a quote snapshot's shape and size (it comes from the Quote page). */
export function cleanSnapshot(input: unknown): QuoteSnapshot {
  const s = (input ?? {}) as Partial<QuoteSnapshot>;
  if (typeof s.text !== "string" || !s.text.trim()) throw new Error("The quote is empty.");
  if (!Array.isArray(s.options) || !s.options.length) throw new Error("Choose at least one aircraft.");
  if (s.options.length > 20) throw new Error("20 aircraft at most in one quote.");
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const options: QuoteSnapshotOption[] = s.options.map((o) => ({
    aircraftId: str(o?.aircraftId, 40), type: str(o?.type, 120), operator: str(o?.operator, 120) || null, tail: str(o?.tail, 20) || null, base: str(o?.base, 200) || null,
    yom: numOrNull(o?.yom), yor: numOrNull(o?.yor), capacity: numOrNull(o?.capacity), price: str(o?.price, 120), extra: str(o?.extra, 500),
    wifi: str(o?.wifi, 10) || "unknown", smoking: str(o?.smoking, 10) || "unknown", pets: str(o?.pets, 10) || "unknown", notes: str(o?.notes, 1000) || null,
    photos: (Array.isArray(o?.photos) ? o.photos : []).slice(0, 30).map((p) => ({ id: str(p?.id, 40), label: str(p?.label, 40), classification: str(p?.classification, 30) })).filter((p) => /^[0-9a-f-]{36}$/.test(p.id)),
  }));
  const snap: QuoteSnapshot = {
    lang: str(s.lang, 10) || "en", text: s.text.slice(0, 20_000), legs: [], options,
    greeting: str(s.greeting, 2000) || null, closing: str(s.closing, 2000) || null, utc: s.utc !== false, label: str(s.label, 80).trim() || null,
    builder: (s.builder && typeof s.builder === "object" ? s.builder : {}) as Record<string, unknown> };
  if (JSON.stringify(snap).length > MAX_SNAPSHOT_BYTES) throw new Error("This quote is too large to save.");
  return snap;
}

/**
 * Saves the quote as the next version of its request, or as version 1 of a new request (no `requestId`). Any
 * version may add, remove or change legs; the request keeps the latest routing, and each version keeps its own.
 * Photos must already have been checked as the broker's to use.
 */
export async function saveQuoteVersion(
  db: Db, actor: Actor, requestId: string | null, legsInput: unknown, snapshot: QuoteSnapshot,
): Promise<{ requestId: string; reference: string; version: number }> {
  const legs = cleanLegs(legsInput, findAirport);
  let r = requestId ? await getRequest(db, actor.tenantId, requestId) : null;
  if (requestId && !r) throw new Error("That request is no longer here.");
  if (!r) {
    const made = await createRequest(db, actor, { legs });
    r = await getRequest(db, actor.tenantId, made.id);
  } else {
    await db.update(requests).set({ legs, updatedAt: new Date() }).where(eq(requests.id, r.id));
  }
  const req = r!;
  const version = await nextVersion(db, actor, req.id, { ...snapshot, legs });
  return { requestId: req.id, reference: req.reference, version };
}

async function nextVersion(db: Db, actor: Actor, requestId: string, snapshot: QuoteSnapshot): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    const [top] = await db.select({ v: max(quoteVersions.version) }).from(quoteVersions).where(eq(quoteVersions.requestId, requestId));
    const version = Number(top?.v ?? 0) + 1;
    try {
      await db.insert(quoteVersions).values({ tenantId: actor.tenantId, requestId, version, content: snapshot as unknown as Record<string, unknown>, createdBy: actor.id });
      await db.update(requests).set({ updatedAt: new Date() }).where(eq(requests.id, requestId));
      return version;
    } catch (e) {
      if (attempt >= 4) throw e;
    }
  }
}

export async function listVersions(db: Db, tenantId: string, requestId: string) {
  const rows = await db.select().from(quoteVersions).where(and(eq(quoteVersions.requestId, requestId), eq(quoteVersions.tenantId, tenantId))).orderBy(desc(quoteVersions.version));
  return rows.map((v) => ({ id: v.id, version: v.version, createdAt: v.createdAt, content: v.content as unknown as QuoteSnapshot }));
}

export async function getVersion(db: Db, tenantId: string, requestId: string, version: number) {
  const [v] = await db.select().from(quoteVersions).where(and(eq(quoteVersions.requestId, requestId), eq(quoteVersions.tenantId, tenantId), eq(quoteVersions.version, version)));
  return v ? { version: v.version, createdAt: v.createdAt, content: v.content as unknown as QuoteSnapshot } : null;
}

export { needsOwnerApproval, optionNeedsApproval } from "./quote";
