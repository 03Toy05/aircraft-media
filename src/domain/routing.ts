import type { Airport } from "./airports";
import { dayDiff, localParts, utcFromLocal } from "./zoneTime";

/**
 * A request's routing: legs from the client (airports by ICAO/IATA, departure date and local time, flight time,
 * passengers), the times that follow from them (arrival, local and UTC), and how they read in lists and quotes.
 * Pure, so the browser and the server share it; airport details are passed in.
 */
export interface Leg {
  /** ICAO code ("VHHH"). */
  from: string;
  to: string;
  /** Departure date and time, local at `from`. */
  date?: string | null;
  time?: string | null;
  /** Flight time in minutes. */
  flight?: number | null;
  /** The flight time is the app's estimate (it follows the chosen aircraft until the broker types one). */
  flightEst?: boolean;
  pax?: number | null;
}
export type AirportInfo = Pick<Airport, "icao" | "iata" | "name" | "city" | "cc" | "tz" | "lat" | "lon">;
export type Airports = Record<string, AirportInfo>;

export const MAX_LEGS = 12;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Checks and tidies legs typed by the broker. With `find`, every airport must be known, and is stored by its ICAO code.
 * Throws a plain message when something is missing or wrong.
 */
export function cleanLegs(input: unknown, find?: (code: string) => AirportInfo | null): Leg[] {
  if (!Array.isArray(input)) throw new Error("Add the routing: at least one leg, from and to.");
  const legs: Leg[] = [];
  for (const raw of input.slice(0, MAX_LEGS + 1)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    let from = String(r.from ?? "").trim().toUpperCase().slice(0, 10);
    let to = String(r.to ?? "").trim().toUpperCase().slice(0, 10);
    const date = String(r.date ?? "").trim();
    const time = String(r.time ?? "").trim();
    const num = (v: unknown) => (v === "" || v == null ? null : Number(v));
    const pax = num(r.pax), flight = num(r.flight);
    if (!from && !to && !date && !time && pax == null && flight == null) continue; // an empty row
    const n = legs.length + 1;
    if (!from || !to) throw new Error(`Leg ${n}: add the departure and arrival airports.`);
    if (find) {
      const a = find(from), b = find(to);
      if (!a) throw new Error(`Leg ${n}: “${from}” isn't an airport code we know. Use its ICAO or IATA code (e.g. VHHH or HKG).`);
      if (!b) throw new Error(`Leg ${n}: “${to}” isn't an airport code we know. Use its ICAO or IATA code (e.g. EGLF or FAB).`);
      from = a.icao; to = b.icao;
    }
    if (from === to) throw new Error(`Leg ${n}: departure and arrival are the same airport.`);
    if (date && (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) throw new Error(`Leg ${n}: the date isn't right.`);
    if (time && !TIME.test(time)) throw new Error(`Leg ${n}: the departure time isn't right (e.g. 16:30).`);
    if (flight != null && (!Number.isInteger(flight) || flight < 5 || flight > 24 * 60)) throw new Error(`Leg ${n}: the flight time isn't right (e.g. 12:45).`);
    if (pax != null && (!Number.isInteger(pax) || pax < 1 || pax > 500)) throw new Error(`Leg ${n}: passengers should be a whole number.`);
    legs.push({ from, to, date: date || null, time: time || null, flight, flightEst: flight != null && r.flightEst === true, pax });
  }
  if (!legs.length) throw new Error("Add the routing: at least one leg, from and to.");
  if (legs.length > MAX_LEGS) throw new Error(`${MAX_LEGS} legs at most.`);
  return legs;
}

/** What may not change between versions of one request: the airports and the dates. */
export const routingKey = (legs: Leg[]) => legs.map((l) => `${l.from}>${l.to}@${l.date ?? ""}`).join("|");

/** "HKG" (IATA when there is one, else ICAO). */
export const airportCode = (code: string, airports: Airports) => airports[code]?.iata || airports[code]?.icao || code;
/** "Hong Kong (HKG)". */
export const airportPlace = (code: string, airports: Airports) => {
  const a = airports[code];
  return a ? `${a.city || a.name} (${a.iata || a.icao})` : code;
};

/** The times of a leg: departure and arrival, local at each end and in UTC. */
export interface LegTimes { depLocal?: { date: string; time: string }; depUtc?: { date: string; time: string }; arrLocal?: { date: string; time: string }; arrUtc?: { date: string; time: string }; arrDays: number }
export function legTimes(leg: Leg, airports: Airports): LegTimes {
  const a = airports[leg.from], b = airports[leg.to];
  if (!leg.date || !leg.time || !a) return { arrDays: 0 };
  const dep = utcFromLocal(leg.date, leg.time, a.tz);
  const out: LegTimes = { depLocal: { date: leg.date, time: leg.time }, depUtc: localParts(dep, "UTC"), arrDays: 0 };
  if (leg.flight && b) {
    const arr = new Date(dep.getTime() + leg.flight * 60000);
    out.arrLocal = localParts(arr, b.tz);
    out.arrUtc = localParts(arr, "UTC");
    out.arrDays = dayDiff(leg.date, out.arrLocal.date);
  }
  return out;
}

/** "HKG → FAB → HKG"; a gap between legs (A→B, then C→D) shows as " / ". */
export function routeLabel(legs: Leg[], airports: Airports = {}): string {
  let out = "";
  let last = "";
  for (const l of legs) {
    const from = airportCode(l.from, airports), to = airportCode(l.to, airports);
    if (!out) out = from;
    else if (from !== last) out += ` / ${from}`;
    out += ` → ${to}`;
    last = to;
  }
  return out;
}

const fmtDate = (iso: string, locale: string, withYear: boolean) => {
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  } catch {
    return iso;
  }
};

/** "12 Dec – 18 Dec" (first and last dates), "12 Dec", or "" when no dates. */
export function datesLabel(legs: Leg[], locale = "en-GB"): string {
  const ds = legs.map((l) => l.date).filter((d): d is string => !!d).sort();
  if (!ds.length) return "";
  const first = fmtDate(ds[0], locale, false), last = fmtDate(ds[ds.length - 1], locale, false);
  return first === last ? first : `${first} – ${last}`;
}

/** The most passengers on any leg. */
export const maxPax = (legs: Leg[]) => legs.reduce((m, l) => Math.max(m, l.pax ?? 0), 0) || null;

/** One line for lists: "HKG → FAB → HKG · 12 Dec – 18 Dec · 4 pax". */
export function requestLabel(legs: Leg[], airports: Airports = {}): string {
  const pax = maxPax(legs);
  return [routeLabel(legs, airports), datesLabel(legs), pax ? `${pax} pax` : ""].filter(Boolean).join(" · ");
}

export interface RoutingWords { routing: string; colon: string; dep: string; arr: string; lt: string; pax: (n: number) => string; duration: (h: number, m: number) => string }

/**
 * The routing as it reads in a quote, in the quote's language:
 *   Hong Kong (HKG) → Farnborough (FAB)
 *   12 Dec 2026 · Dep 16:30 LT (08:30 UTC) · Arr 21:15 LT (21:15 UTC) · 12h 45m · 4 pax
 */
export function routingLines(legs: Leg[], airports: Airports, words: RoutingWords, locale: string, opts: { utc?: boolean } = {}): string {
  const utc = opts.utc !== false;
  const blocks = legs.map((l) => {
    const t = legTimes(l, airports);
    const bits: string[] = [];
    if (l.date) bits.push(fmtDate(l.date, locale, true));
    if (t.depLocal) bits.push(`${words.dep} ${t.depLocal.time} ${words.lt}${utc && t.depUtc ? ` (${t.depUtc.time} UTC)` : ""}`);
    if (t.arrLocal) bits.push(`${words.arr} ${t.arrLocal.time} ${words.lt}${t.arrDays ? ` (${t.arrDays > 0 ? "+" : ""}${t.arrDays})` : ""}${utc && t.arrUtc ? ` (${t.arrUtc.time} UTC)` : ""}`);
    if (l.flight) bits.push(words.duration(Math.floor(l.flight / 60), l.flight % 60));
    if (l.pax) bits.push(words.pax(l.pax));
    return [`${airportPlace(l.from, airports)} → ${airportPlace(l.to, airports)}`, bits.join(" · ")].filter(Boolean).join("\n");
  });
  return `${words.routing}${words.colon.trimEnd()}\n${blocks.join("\n\n")}`;
}
