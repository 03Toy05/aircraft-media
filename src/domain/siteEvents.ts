import { gte, isNotNull, min, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { quoteShares, siteEvents, users } from "../db/schema";

/**
 * What the public website reports, in the order a visitor goes through it. Counts per day and language only:
 * no cookies, no IP address, nothing that tells one visitor from another.
 */
export const SITE_EVENTS = [
  "front_interaction",
  "demo_play",
  "demo_complete",
  "letmetry_complete",
  "pricing_view",
  "make_toy_yours_click",
] as const;
export type SiteEvent = (typeof SITE_EVENTS)[number];
export const SITE_LANGS = ["en", "zh-hant", "zh-hans"] as const;
export type SiteLang = (typeof SITE_LANGS)[number];

export function isSiteEvent(e: unknown): e is SiteEvent {
  return typeof e === "string" && (SITE_EVENTS as readonly string[]).includes(e);
}

/** Any language the site sends, as one of ours ("zh-Hant", "zh-TW" → zh-hant); anything else counts as English. */
export function siteLang(l: unknown): SiteLang {
  const s = typeof l === "string" ? l.toLowerCase() : "";
  if (s === "zh-hans" || s === "zh-cn" || s === "zh-sg") return "zh-hans";
  if (s.startsWith("zh")) return "zh-hant";
  return "en";
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export async function countSiteEvent(db: Db, event: SiteEvent, lang: SiteLang, now = new Date()) {
  await db
    .insert(siteEvents)
    .values({ day: dayOf(now), event, lang, n: 1 })
    .onConflictDoUpdate({ target: [siteEvents.day, siteEvents.event, siteEvents.lang], set: { n: sql`${siteEvents.n} + 1` } });
}

/**
 * A simple guard against a script flooding the counter: at most this many counts a minute across the whole site
 * (one server, so memory is enough). Real visitors never come near it.
 */
const PER_MINUTE = 600;
let windowStart = 0;
let inWindow = 0;
export function underSiteLimit(now = Date.now()): boolean {
  if (now - windowStart >= 60_000) { windowStart = now; inWindow = 0; }
  return ++inWindow <= PER_MINUTE;
}

export type FunnelRow = { event: SiteEvent | "signup_complete" | "first_quote"; d7: number; d30: number; byLang30: Record<SiteLang, number> | null };

/**
 * The website's steps for the admin's Users page: the last 7 and 30 days, and the 30 days by language. Sign-ups and
 * first quotes come from the app's own records (when someone signed up; when a workspace first shared a quote).
 */
export async function siteFunnel(db: Db, adminEmail: string, now = new Date()): Promise<FunnelRow[]> {
  const d7 = dayOf(new Date(now.getTime() - 6 * 864e5)), d30 = dayOf(new Date(now.getTime() - 29 * 864e5));
  const rows = await db.select().from(siteEvents).where(gte(siteEvents.day, d30));
  const out: FunnelRow[] = SITE_EVENTS.map((event) => {
    const byLang30 = { en: 0, "zh-hant": 0, "zh-hans": 0 } as Record<SiteLang, number>;
    let a = 0, b = 0;
    for (const r of rows) {
      if (r.event !== event) continue;
      b += r.n;
      if (r.day >= d7) a += r.n;
      byLang30[siteLang(r.lang)] += r.n;
    }
    return { event, d7: a, d30: b, byLang30 };
  });

  const t7 = new Date(`${d7}T00:00:00Z`).getTime(), t30 = new Date(`${d30}T00:00:00Z`).getTime();
  const signups = (await db.select({ at: users.signedUpAt, email: users.email }).from(users).where(isNotNull(users.signedUpAt)))
    .filter((u) => u.email.toLowerCase() !== adminEmail.toLowerCase())
    .map((u) => u.at!.getTime());
  out.push({ event: "signup_complete", d7: signups.filter((t) => t >= t7).length, d30: signups.filter((t) => t >= t30).length, byLang30: null });

  const firsts = (await db.select({ at: min(quoteShares.createdAt) }).from(quoteShares).groupBy(quoteShares.tenantId))
    .map((r) => (r.at ? new Date(r.at).getTime() : 0));
  out.push({ event: "first_quote", d7: firsts.filter((t) => t >= t7).length, d30: firsts.filter((t) => t >= t30).length, byLang30: null });
  return out;
}

/** For tests: start the per-minute guard afresh. */
export function resetSiteLimit() { windowStart = 0; inWindow = 0; }
