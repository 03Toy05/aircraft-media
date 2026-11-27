import { and, count, countDistinct, eq, gte, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { aircraftMedia, quoteLinks, quoteShares, quoteVersions, users } from "../db/schema";
import { accessFor } from "./accounts";

/** What each workspace has done, for the admin's Users page (counts per workspace). */
export interface Activity {
  /** Quote versions saved (each "Save as request" / "Save as next version"). */
  saved: number;
  /** Quotes emailed from the app (each quote once). */
  emailed: number;
  /** Client links made, and how many of them the client opened. */
  links: number;
  opened: number;
  /** Photos added in the last 30 days. */
  photos30: number;
}

export async function activityByTenant(db: Db, now = new Date()): Promise<Map<string, Activity>> {
  const since = new Date(now.getTime() - 30 * 864e5);
  const out = new Map<string, Activity>();
  const get = (t: string) => out.get(t) ?? (out.set(t, { saved: 0, emailed: 0, links: 0, opened: 0, photos30: 0 }), out.get(t)!);
  for (const r of await db.select({ t: quoteVersions.tenantId, n: count() }).from(quoteVersions).groupBy(quoteVersions.tenantId)) get(r.t).saved = Number(r.n);
  for (const r of await db.select({ t: quoteShares.tenantId, n: countDistinct(quoteShares.quoteKey) }).from(quoteShares).where(eq(quoteShares.how, "email")).groupBy(quoteShares.tenantId)) get(r.t).emailed = Number(r.n);
  for (const r of await db.select({ t: quoteLinks.tenantId, n: count() }).from(quoteLinks).groupBy(quoteLinks.tenantId)) get(r.t).links = Number(r.n);
  for (const r of await db.select({ t: quoteLinks.tenantId, n: count() }).from(quoteLinks).where(isNotNull(quoteLinks.firstViewedAt)).groupBy(quoteLinks.tenantId)) get(r.t).opened = Number(r.n);
  for (const r of await db.select({ t: aircraftMedia.tenantId, n: count() }).from(aircraftMedia).where(and(eq(aircraftMedia.lifecycleState, "active"), gte(aircraftMedia.createdAt, since))).groupBy(aircraftMedia.tenantId)) get(r.t).photos30 = Number(r.n);
  return out;
}

/** The numbers at the top of the Users page. */
export async function userOverview(db: Db, adminEmail: string, now = new Date()) {
  const all = (await db.select().from(users)).filter((u) => u.email.toLowerCase() !== adminEmail.toLowerCase() && u.status !== "applied");
  const week = now.getTime() - 7 * 864e5, month = now.getTime() - 30 * 864e5;
  let trial = 0, ended = 0, full = 0, off = 0;
  for (const u of all) {
    if (u.status === "blocked") off++;
    else if (u.plan === "full") full++;
    else if (accessFor(u, now).expired) ended++;
    else trial++;
  }
  return {
    people: all.length,
    trial, ended, full, off,
    signups7: all.filter((u) => u.signedUpAt && u.signedUpAt.getTime() >= week).length,
    active30: all.filter((u) => u.lastSignInAt && u.lastSignInAt.getTime() >= month).length,
    endingSoon: all.filter((u) => u.plan === "trial" && u.trialEndsAt && u.trialEndsAt.getTime() > now.getTime() && u.trialEndsAt.getTime() - now.getTime() <= 3 * 864e5).length,
  };
}
