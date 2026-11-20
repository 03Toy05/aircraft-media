import { and, gte, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { timings } from "../db/schema";

export const TIMING_KINDS = ["page", "action", "toy"] as const;
export type TimingKind = (typeof TIMING_KINDS)[number];
export interface TimingEvent { kind: TimingKind; name: string; ms: number; serverMs?: number | null }

/** Ids in a path become ":id", so every aircraft page counts as one page ("/aircraft/:id"). */
export function timingName(name: string): string {
  return name.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id").replace(/\s+/g, " ").trim().slice(0, 80) || "?";
}

/** Saves what one person just waited for. Odd values (negative, over 10 minutes) are dropped. Keeps 90 days. */
export async function recordTimings(db: Db, who: { tenantId: string; userId: string }, events: TimingEvent[]): Promise<number> {
  const rows = events
    .filter((e) => (TIMING_KINDS as readonly string[]).includes(e.kind) && Number.isFinite(e.ms) && e.ms >= 0 && e.ms <= 600_000)
    .slice(0, 50)
    .map((e) => ({
      tenantId: who.tenantId, userId: who.userId, kind: e.kind, name: timingName(String(e.name)), ms: Math.round(e.ms),
      serverMs: e.serverMs != null && Number.isFinite(e.serverMs) ? Math.round(e.serverMs) : null,
    }));
  if (!rows.length) return 0;
  await db.insert(timings).values(rows);
  if (Math.random() < 0.02) await db.delete(timings).where(lt(timings.createdAt, new Date(Date.now() - 90 * 86_400_000)));
  return rows.length;
}

export interface SpeedRow { kind: TimingKind; name: string; count: number; typical: number; slow: number; slowest: number; server: number | null }

/**
 * Per page, button and kind of Toy reply over the last `days`: how many times, the typical wait (median), a slow
 * one (9 in 10 were faster) and the slowest. Busiest first.
 */
export async function speedReport(db: Db, days = 7): Promise<SpeedRow[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      kind: timings.kind,
      name: timings.name,
      count: sql<number>`count(*)::int`,
      typical: sql<number>`percentile_cont(0.5) within group (order by ${timings.ms})`,
      slow: sql<number>`percentile_cont(0.9) within group (order by ${timings.ms})`,
      slowest: sql<number>`max(${timings.ms})`,
      server: sql<number | null>`percentile_cont(0.5) within group (order by ${timings.serverMs})`,
    })
    .from(timings)
    .where(and(gte(timings.createdAt, since)))
    .groupBy(timings.kind, timings.name);
  return rows
    .map((r) => ({ kind: r.kind as TimingKind, name: r.name, count: Number(r.count), typical: Math.round(Number(r.typical)), slow: Math.round(Number(r.slow)), slowest: Number(r.slowest), server: r.server == null ? null : Math.round(Number(r.server)) }))
    .sort((a, b) => b.count - a.count);
}
