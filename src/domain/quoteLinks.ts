import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { quoteLinks, quoteVersions, requests, users } from "../db/schema";
import type { Actor } from "./action";
import type { QuoteSnapshot } from "./requests";
import { getBrand, type Brand } from "./branding";

/**
 * The client's link to a request's quote: aircraftmedia.my/q/<token>. It shows the latest saved version, so a new
 * version reaches the client through the same link. Only whoever has the link sees it (a long random token, not
 * guessable); the broker can switch it off or give it an end date.
 */

export const newToken = () => randomBytes(18).toString("base64url"); // 24 characters

export type QuoteLink = typeof quoteLinks.$inferSelect;

/** This request's link (the newest one), if it has one. */
export async function linkFor(db: Db, tenantId: string, requestId: string): Promise<QuoteLink | null> {
  const [l] = await db.select().from(quoteLinks).where(and(eq(quoteLinks.requestId, requestId), eq(quoteLinks.tenantId, tenantId))).orderBy(desc(quoteLinks.createdAt)).limit(1);
  return l ?? null;
}

/** The request's link, made now if it has none (switched back on if it was off). */
export async function ensureLink(db: Db, actor: Actor, requestId: string): Promise<QuoteLink> {
  const [r] = await db.select({ id: requests.id }).from(requests).where(and(eq(requests.id, requestId), eq(requests.tenantId, actor.tenantId)));
  if (!r) throw new Error("That request is no longer here.");
  const cur = await linkFor(db, actor.tenantId, requestId);
  if (cur) {
    if (!cur.active) await db.update(quoteLinks).set({ active: true }).where(eq(quoteLinks.id, cur.id));
    return { ...cur, active: true };
  }
  const [l] = await db.insert(quoteLinks).values({ tenantId: actor.tenantId, requestId, token: newToken(), createdBy: actor.id }).returning();
  return l;
}

/** Switch the link off (or on again), and set or clear its end date. */
export async function setLink(db: Db, actor: Actor, requestId: string, input: { active?: boolean; expiresAt?: Date | null }) {
  const cur = await linkFor(db, actor.tenantId, requestId);
  if (!cur) throw new Error("This request has no client link yet.");
  await db.update(quoteLinks).set({
    ...(input.active !== undefined ? { active: input.active } : {}),
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
  }).where(eq(quoteLinks.id, cur.id));
}

/** A new link for the request: the old one stops working (e.g. it was sent to the wrong person). */
export async function replaceLink(db: Db, actor: Actor, requestId: string): Promise<QuoteLink> {
  const cur = await linkFor(db, actor.tenantId, requestId);
  if (cur) await db.update(quoteLinks).set({ active: false }).where(eq(quoteLinks.id, cur.id));
  const [l] = await db.insert(quoteLinks).values({ tenantId: actor.tenantId, requestId, token: newToken(), createdBy: actor.id }).returning();
  return l;
}

export interface OpenedQuote {
  link: QuoteLink;
  reference: string;
  version: number;
  savedAt: Date;
  quote: QuoteSnapshot;
  broker: { name: string; email: string };
  brand: Brand;
}

/** What the client sees at /q/<token>: the latest version, or null when the link is unknown, off, expired or empty. */
export async function openLink(db: Db, token: string, now = new Date()): Promise<OpenedQuote | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [link] = await db.select().from(quoteLinks).where(eq(quoteLinks.token, token));
  if (!link || !link.active || (link.expiresAt && link.expiresAt <= now)) return null;
  const [r] = await db.select().from(requests).where(eq(requests.id, link.requestId));
  if (!r) return null;
  const [v] = await db.select().from(quoteVersions).where(eq(quoteVersions.requestId, r.id)).orderBy(desc(quoteVersions.version)).limit(1);
  if (!v) return null;
  const [u] = await db.select({ name: users.displayName, email: users.email }).from(users).where(eq(users.id, v.createdBy));
  return { link, reference: r.reference, version: v.version, savedAt: v.createdAt, quote: v.content as unknown as QuoteSnapshot, broker: { name: u?.name ?? "", email: u?.email ?? "" }, brand: await getBrand(db, link.tenantId) };
}

/** Notes that the client opened it (first and last time only). */
export async function noteOpened(db: Db, link: QuoteLink, now = new Date()) {
  await db.update(quoteLinks).set({ lastViewedAt: now, ...(link.firstViewedAt ? {} : { firstViewedAt: now }) }).where(eq(quoteLinks.id, link.id));
}

/** Whether this photo is part of the quote the link shows (only those are served to the client). */
export const quotePhotoIds = (q: QuoteSnapshot) => new Set(q.options.flatMap((o) => o.photos.map((p) => p.id)));
