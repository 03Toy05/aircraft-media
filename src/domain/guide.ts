import { count, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { quoteShares, quoteVersions } from "../db/schema";
import { getAircraftNames } from "./catalogue";
import { LIBRARY_TENANT_ID, scopeHasAircraft, type LibraryScope } from "./library";

/**
 * The starter guide's examples, made from an aircraft this person can really quote (their own first, else one from the
 * library shared with them), so "Try it" gives a working quote rather than "I couldn't find".
 */
export async function sampleAircraft(db: Db, tenantId: string, scope: LibraryScope | null): Promise<{ words: string; model: string } | null> {
  const pick = (rows: Awaited<ReturnType<typeof getAircraftNames>>) =>
    rows.find((r) => r.operator && r.tail) ?? rows.find((r) => r.operator) ?? rows[0] ?? null;
  let a = pick(await getAircraftNames(db, tenantId));
  if (!a && scope) a = pick((await getAircraftNames(db, LIBRARY_TENANT_ID)).filter((r) => scopeHasAircraft(scope, r.aircraftId)));
  if (!a) return null;
  // "Dassault Falcon 7X" -> "Falcon 7X": brokers type the model, and the operator and tail make it one aircraft.
  const model = a.aircraft.split(" ").slice(1).join(" ") || a.aircraft;
  return { words: [a.operator, model, a.tail].filter(Boolean).join(" "), model };
}

const DAY = 86_400_000;
const shortDate = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Hong_Kong" }).format(d);

/** "Luxaviation Falcon 7X OO-AIE quote HKG-NRT 12 Dec 4 pax USD 120k", two weeks from today. */
export function sampleQuoteText(a: { words: string } | null, now = new Date()): string {
  return `${a?.words ?? "G650"} quote HKG-NRT ${shortDate(new Date(now.getTime() + 14 * DAY))} 4 pax USD 120k`;
}

/** Someone who hasn't made a quote yet (nothing saved or sent): Toy greets them with the first steps. */
export async function isNewToQuotes(db: Db, tenantId: string): Promise<boolean> {
  const [v] = await db.select({ n: count() }).from(quoteVersions).where(eq(quoteVersions.tenantId, tenantId));
  if (Number(v?.n ?? 0) > 0) return false;
  const [s] = await db.select({ n: count() }).from(quoteShares).where(eq(quoteShares.tenantId, tenantId));
  return Number(s?.n ?? 0) === 0;
}
