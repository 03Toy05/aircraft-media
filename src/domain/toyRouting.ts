import { findAirport } from "./airports";
import type { Leg } from "./routing";

/**
 * Reads a routing typed in the chat, one line at a time:
 *   "HKG-LHR 12 Dec 1630 8 pax"   "12/12 VHHH > EGLF 4:30pm, 8 passengers"   "HKG-LHR-HKG 12 Dec 8 pax"
 *   "Dec 12 HKG to FAB dep 16:30"   "12月12日 HKG-LHR 8人"   "tomorrow HKG-SIN 0900 6 pax"
 * Airports: ICAO or IATA codes joined by -, >, →, / or "to" (codes in capitals may also be separated by spaces when the
 * line has a date or passengers). Dates are day first (12/12 = 12 December); with no year, the next such date.
 * Times are local departure times. Codes we don't know are reported, never guessed.
 */
export interface RoutingRead {
  legs: Leg[];
  /** Codes that look like airports but aren't in the list ("XYZQ"). */
  unknown: string[];
  /** The line with the routing taken out ("Draft me a quote"). */
  rest: string;
}

const SEP = String.raw`\s*(?:->|=>|[-–—>→/]|\s+to\s+|至|到)\s*`;
const CODE = String.raw`[A-Za-z]{3,4}`;
const CHAIN = new RegExp(String.raw`(?<![A-Za-z0-9])${CODE}(?:${SEP}${CODE})+(?![A-Za-z0-9])`);
const SPACED = /(?<![A-Za-z0-9])([A-Z]{3,4})\s+([A-Z]{3,4})(?![A-Za-z0-9])/;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`;
const ORD = String.raw`(?:st|nd|rd|th)?`;

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** With no year: this year's date, or next year's when it has passed. */
function withYear(m: number, d: number, today: Date): string | null {
  const y0 = today.getFullYear();
  const todayIso = iso(y0, today.getMonth() + 1, today.getDate());
  for (const y of [y0, y0 + 1]) if (validDate(y, m, d) && iso(y, m, d) >= todayIso) return iso(y, m, d);
  return null;
}
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** Takes a date out of the text. A year counts only when it is this year or the next two ("12 Dec 1630" is a time). */
function takeDate(s: string, today: Date): { date: string | null; rest: string } {
  const y0 = today.getFullYear();
  const okYear = (y: string | undefined) => !!y && fullYear(y) >= y0 && fullYear(y) <= y0 + 2;
  // Each reader gives the date and the text it used (without a year it didn't accept).
  const dm = (m: RegExpMatchArray, mo: number, d: number, y: string | undefined, yearText: string | undefined): [string | null, string] =>
    okYear(y) ? [validDate(fullYear(y!), mo, d) ? iso(fullYear(y!), mo, d) : null, m[0]] : [withYear(mo, d, today), yearText ? m[0].slice(0, m[0].lastIndexOf(yearText)) : m[0]];
  const tries: [RegExp, (m: RegExpMatchArray) => [string | null, string]][] = [
    [/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, (m) => [validDate(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null, m[0]]],
    [new RegExp(String.raw`\b(\d{1,2})${ORD}\s*${MON}(?:,?\s*(\d{4}))?`, "i"), (m) => dm(m, MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1], m[3], m[3])],
    [new RegExp(String.raw`\b${MON}\s*(\d{1,2})${ORD}(?:,?\s*(\d{4}))?\b`, "i"), (m) => dm(m, MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2], m[3], m[3])],
    [/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日號号]?/, (m) => (m[1] ? [validDate(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null, m[0]] : [withYear(+m[2], +m[3], today), m[0]])],
    [/(?<![\d:])(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?(?![\d:])/, (m) => (m[3] ? [validDate(fullYear(m[3]), +m[2], +m[1]) ? iso(fullYear(m[3]), +m[2], +m[1]) : null, m[0]] : [withYear(+m[2], +m[1], today), m[0]])],
    [/\b(today|tomorrow)\b|今日|今天|明天|聽日|听日/i, (m) => {
      const t = new Date(today);
      if (/tomorrow|明天|聽日|听日/i.test(m[0])) t.setDate(t.getDate() + 1);
      return [iso(t.getFullYear(), t.getMonth() + 1, t.getDate()), m[0]];
    }],
  ];
  for (const [re, read] of tries) {
    const m = s.match(re);
    if (!m) continue;
    const [date, used] = read(m);
    if (date) return { date, rest: s.replace(used, " ") };
  }
  return { date: null, rest: s };
}

/** Takes a local departure time out of the text: 16:30, 4:30pm, 4pm, 1630 (times marked Z or UTC are left alone). */
function takeTime(s: string): { time: string | null; rest: string } {
  const tries: [RegExp, (m: RegExpMatchArray) => [number, number]][] = [
    [/\b(\d{1,2})[:.](\d{2})\s*(am|pm)\b/i, (m) => [(+m[1] % 12) + (/pm/i.test(m[3]) ? 12 : 0), +m[2]]],
    [/\b(\d{1,2})\s*(am|pm)\b/i, (m) => [(+m[1] % 12) + (/pm/i.test(m[2]) ? 12 : 0), 0]],
    [/(?<![\d/.:-])(\d{1,2}):(\d{2})(?!\d)(?!\s*(?:z|utc)\b)(?:\s*(?:lt|local|l)\b)?/i, (m) => [+m[1], +m[2]]],
    [/(?<![\d/.:-])([01]\d|2[0-3])([0-5]\d)(?!\d)(?!\s*(?:z|utc)\b)(?:\s*(?:lt|local|l|h|hrs)\b)?/i, (m) => [+m[1], +m[2]]],
  ];
  for (const [re, read] of tries) {
    const m = s.match(re);
    if (!m) continue;
    const [h, min] = read(m);
    if (h > 23 || min > 59) continue;
    return { time: `${pad(h)}:${pad(min)}`, rest: s.replace(m[0], " ") };
  }
  return { time: null, rest: s };
}

/** Takes the number of passengers out of the text: 8 pax, 8 passengers, pax 8, 8人. */
function takePax(s: string): { pax: number | null; rest: string } {
  const m = s.match(/\b(\d{1,3})\s*(?:pax|passengers?|people|persons?|ppl|guests?)\b|(\d{1,3})\s*(?:人|位|名)(?:乘客)?|\b(?:pax|passengers?)\s*[:x×]?\s*(\d{1,3})\b|(?:乘客|人數|人数)\s*[:：]?\s*(\d{1,3})/i);
  if (!m) return { pax: null, rest: s };
  const n = Number(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return n >= 1 && n <= 500 ? { pax: n, rest: s.replace(m[0], " ") } : { pax: null, rest: s };
}

const tidy = (s: string) => s.replace(/\b(?:dep(?:arting|arture)?|etd|on|at|for|from|with|leg\s*\d*)\b[:.]?/gi, " ").replace(/^[\s,;:.·•\-–—]+|[\s,;:.·•\-–—]+$/g, "").replace(/\s{2,}/g, " ").trim();

/** One line's routing, or null when the line has no airports in it. */
export function parseRoutingLine(line: string, today = new Date()): RoutingRead | null {
  let codes: string[] | null = null;
  let rest = line;
  const chain = line.match(CHAIN);
  if (chain) {
    const parts = chain[0].split(new RegExp(SEP, "i")).map((c) => c.trim()).filter(Boolean);
    const known = parts.every((c) => findAirport(c));
    const capitals = parts.every((c) => c === c.toUpperCase());
    // "Air-Jet" or "tag-team" are words, not airports: lower-case codes must all be real airports.
    if (known || capitals) { codes = parts.map((c) => c.toUpperCase()); rest = line.replace(chain[0], " "); }
  }
  let date: string | null, time: string | null, pax: number | null;
  ({ date, rest } = takeDate(rest, today));
  ({ pax, rest } = takePax(rest));
  ({ time, rest } = takeTime(rest));
  if (!codes) {
    // "HKG LHR 12 Dec 8 pax": two codes in capitals, both real airports, on a line with a date or passengers.
    const m = rest.match(SPACED);
    if (!m || !(date || pax) || !findAirport(m[1]) || !findAirport(m[2])) return null;
    codes = [m[1], m[2]];
    rest = rest.replace(m[0], " ");
  }
  const unknown = codes.filter((c) => !findAirport(c));
  const icao = codes.map((c) => findAirport(c)?.icao ?? c);
  const legs: Leg[] = [];
  for (let i = 0; i + 1 < icao.length; i++) {
    legs.push({ from: icao[i], to: icao[i + 1], date: i === 0 ? date : null, time: i === 0 ? time : null, pax });
  }
  return { legs, unknown: [...new Set(unknown)], rest: tidy(rest) };
}
