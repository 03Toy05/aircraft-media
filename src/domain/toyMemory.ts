import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { requests, quoteVersions, toyChoices, toyConversations } from "../db/schema";
import { desc } from "drizzle-orm";

/**
 * Toy's memory, kept with each person's account (not in the browser), so it carries on in a new tab, on the phone, or
 * the next day:
 *  - the conversation: what Toy last asked, the quote in progress, and the recent messages (cleared after 90 days of
 *    no use, or at once on "start over");
 *  - the choices they made: which aircraft "Lux 7X" meant, the photo kinds they send.
 * Each person sees only their own. Toy reads it before every answer; nothing here is guessed.
 */

export const KEEP_DAYS = 90;
export const KEEP_MESSAGES = 40;
const DAY = 86_400_000;

/** A chat message as shown (the browser's own shape), stored as is. */
export type SavedMessage = Record<string, unknown> & { id: string; role: "user" | "toy" };

export async function loadConversation(db: Db, userId: string, tenantId: string, now = new Date()): Promise<{ draft: Record<string, unknown>; messages: SavedMessage[]; updatedAt: Date } | null> {
  await db.delete(toyConversations).where(lt(toyConversations.updatedAt, new Date(now.getTime() - KEEP_DAYS * DAY)));
  const [c] = await db.select().from(toyConversations).where(eq(toyConversations.userId, userId));
  if (!c || c.tenantId !== tenantId) return null;
  try {
    return { draft: JSON.parse(c.draft), messages: JSON.parse(c.messages), updatedAt: c.updatedAt };
  } catch {
    return null;
  }
}

/** Keeps the conversation's state and adds this turn's messages (only the most recent are kept). */
export async function saveConversation(db: Db, userId: string, tenantId: string, draft: unknown, added: SavedMessage[], now = new Date()) {
  const [c] = await db.select({ messages: toyConversations.messages, tenantId: toyConversations.tenantId }).from(toyConversations).where(eq(toyConversations.userId, userId));
  let before: SavedMessage[] = [];
  try { if (c && c.tenantId === tenantId) before = JSON.parse(c.messages); } catch { /* start the list again */ }
  const messages = JSON.stringify([...before, ...added].slice(-KEEP_MESSAGES));
  const row = { tenantId, draft: JSON.stringify(draft), messages, updatedAt: now };
  await db.insert(toyConversations).values({ userId, ...row }).onConflictDoUpdate({ target: toyConversations.userId, set: row });
}

export async function clearConversation(db: Db, userId: string) {
  await db.delete(toyConversations).where(eq(toyConversations.userId, userId));
}

// ---------------------------------------------------------------- choices

export type ChoiceKind = "aircraft" | "photos";

export async function getChoice<T>(db: Db, userId: string, kind: ChoiceKind, key: string): Promise<T | null> {
  const [c] = await db.select().from(toyChoices).where(and(eq(toyChoices.userId, userId), eq(toyChoices.kind, kind), eq(toyChoices.key, key)));
  try { return c ? (JSON.parse(c.value) as T) : null; } catch { return null; }
}

export async function setChoice(db: Db, userId: string, kind: ChoiceKind, key: string, value: unknown, now = new Date()) {
  const row = { value: JSON.stringify(value), updatedAt: now };
  await db.insert(toyChoices).values({ userId, kind, key, ...row }).onConflictDoUpdate({ target: [toyChoices.userId, toyChoices.kind, toyChoices.key], set: row });
}

// ---------------------------------------------------------------- past quotes

export interface PastQuote { requestId: string; reference: string; version: number; savedAt: Date; content: import("./requests").QuoteSnapshot; /** The request's routing, "HKG → NRT". */ route: string }

/** The latest saved version of each of the most recent requests in this workspace, newest first. */
export async function recentQuotes(db: Db, tenantId: string, limit = 5): Promise<PastQuote[]> {
  const { routeLabel } = await import("./routing");
  const { airportsFor } = await import("./airports");
  const rows = await db.select({ requestId: quoteVersions.requestId, reference: requests.reference, legs: requests.legs, version: quoteVersions.version, savedAt: quoteVersions.createdAt, content: quoteVersions.content })
    .from(quoteVersions).innerJoin(requests, eq(requests.id, quoteVersions.requestId))
    .where(and(eq(quoteVersions.tenantId, tenantId), eq(requests.archived, false)))
    .orderBy(desc(quoteVersions.createdAt)).limit(limit * 10);
  const seen = new Set<string>();
  const out: PastQuote[] = [];
  for (const r of rows) {
    if (seen.has(r.requestId)) continue;
    seen.add(r.requestId);
    const content = r.content as unknown as PastQuote["content"];
    const legs = content.legs?.length ? content.legs : r.legs;
    out.push({ requestId: r.requestId, reference: r.reference, version: r.version, savedAt: r.savedAt, content: { ...content, legs }, route: routeLabel(legs, airportsFor(legs.flatMap((l) => [l.from, l.to]))) });
    if (out.length >= limit) break;
  }
  return out;
}
