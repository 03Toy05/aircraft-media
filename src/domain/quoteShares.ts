import { countDistinct, gte, max } from "drizzle-orm";
import type { Db } from "../db/client";
import { quoteShares } from "../db/schema";
import type { Actor } from "./action";

/**
 * Quotes shared out: recorded when the phone's share sheet hands a quote to an app (not cancelled) or the
 * quote message is copied. The phone cannot tell whether the message was then actually sent, so this counts
 * quotes shared out, not quotes delivered. Sharing one quote option by option, or again later, counts once.
 */
export async function recordQuoteShare(db: Db, actor: Actor, input: { quoteKey: string; how: "share" | "copy" | "email"; options: number }) {
  const quoteKey = input.quoteKey.trim().slice(0, 100);
  if (!quoteKey) return;
  const options = Math.max(1, Math.min(50, Math.round(input.options) || 1));
  await db.insert(quoteShares).values({ tenantId: actor.tenantId, userId: actor.id, quoteKey, how: input.how === "copy" || input.how === "email" ? input.how : "share", options });
}

export interface QuoteShareStats { quotes: number; last30: number; lastAt: Date | null }

/** Per workspace: quotes shared out in all, in the last 30 days, and when the last one was. */
export async function quoteShareStats(db: Db): Promise<Map<string, QuoteShareStats>> {
  const since = new Date(Date.now() - 30 * 864e5);
  const all = await db
    .select({ t: quoteShares.tenantId, n: countDistinct(quoteShares.quoteKey), last: max(quoteShares.createdAt) })
    .from(quoteShares)
    .groupBy(quoteShares.tenantId);
  const recent = await db
    .select({ t: quoteShares.tenantId, n: countDistinct(quoteShares.quoteKey) })
    .from(quoteShares)
    .where(gte(quoteShares.createdAt, since))
    .groupBy(quoteShares.tenantId);
  const recentBy = new Map(recent.map((r) => [r.t, Number(r.n)]));
  return new Map(all.map((r) => [r.t, { quotes: Number(r.n), last30: recentBy.get(r.t) ?? 0, lastAt: r.last ? new Date(r.last) : null }]));
}
