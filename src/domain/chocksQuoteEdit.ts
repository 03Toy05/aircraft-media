import { takePrice } from "./chocksShare";
import { matchAircraft, type CommandAircraft } from "./quoteCommands";

/**
 * Changes typed after Toy shows a quote, read against the aircraft in that quote:
 *   "For 605, price is USD 70k. For G280, price is EUR 60k"  -> two prices (the quote only)
 *   "For Vista 605, the YOM shall be 2016. Change it"         -> a change to that aircraft's record (asked first)
 * A clause that names an aircraft but nothing else ("For 605") carries over to the next clause ("price is USD 70k").
 */

export type EditField = "yom" | "yor" | "capacity";
export interface FieldEdit { id: string; field: EditField; value: number }
export interface QuoteFollowUp {
  prices: Record<string, string>;
  edits: FieldEdit[];
  /** Clauses with a price or a change whose aircraft could not be told apart. */
  unclear: string[];
}

const YOM = "yom|year of manufacture|year built|manufactured|出廠年份|出厂年份|製造年份|制造年份|出廠|出厂";
const YOR = "yor|year of refurb(?:ishment)?|refurb(?:ished|ishment)?|翻新年份|改裝年份|改装年份|翻新";
const CAP = "capacity|seats?|pax|passengers?|載客量|载客量|座位數|座位数|座位";
const FIELD_OF = (w: string): EditField => new RegExp(`^(?:${YOM})$`, "i").test(w) ? "yom" : new RegExp(`^(?:${YOR})$`, "i").test(w) ? "yor" : "capacity";
const LINK = "(?:\\s*(?:(?:shall|should|will|must|has to|needs to)\\s+be|be\\s+changed\\s+to|changed\\s+to|is|to|=|:|：|as|be|at|in|為|为|係|改為|改为|改成|改做))?";
const FORWARD = new RegExp(`(?:\\bthe\\s+)?(?<![A-Za-z])(${YOM}|${YOR}|${CAP})(?![A-Za-z])${LINK}\\s*(\\d{1,4})(?!\\d)`, "i");
const REVERSE = new RegExp(`(?<![\\d.])(\\d{1,4})\\s*-?\\s*(${YOM}|${YOR}|${CAP})(?![A-Za-z])`, "i");

/** Words that only carry the sentence ("for", "change it", "please"). */
const FILLER = /\b(?:for|of|on|the|its?|is|are|price[sd]?|cost|rate|change|changes|update|set|make|please|pls|shall|should|will|must|be|to|now|instead|also|and|then|thanks?|thank you|ok(?:ay)?|no|yes|aircraft|record|details?|quote|one)\b|請|请|幫我|帮我|改|的|嘅/gi;

function takeField(text: string): { field: EditField; value: number; rest: string } | null {
  const m = text.match(FORWARD);
  if (m) return { field: FIELD_OF(m[1]), value: Number(m[2]), rest: text.replace(m[0], " ") };
  const r = text.match(REVERSE);
  if (r) return { field: FIELD_OF(r[2]), value: Number(r[1]), rest: text.replace(r[0], " ") };
  return null;
}

export const validEdit = (field: EditField, value: number) => field === "capacity" ? value >= 1 && value <= 500 : value >= 1950 && value <= 2100;

/** Splits on sentence ends, new lines and commas; a full stop or comma inside a number ("1.2m", "70,000") is kept. */
function clausesOf(text: string): string[] {
  return text.split(/(?:[.;!。；！](?!\d)|\r?\n|,(?!\d)|，|、|\s+then\s+)/i).map((c) => c.trim()).filter(Boolean);
}

export function parseQuoteFollowUp(message: string, list: CommandAircraft[]): QuoteFollowUp | null {
  if (!list.length || /[?？]\s*$/.test(message.trim())) return null; // a question is a lookup, not a change
  const prices: Record<string, string> = {};
  const edits: FieldEdit[] = [];
  const unclear: string[] = [];
  let named: string | null = null; // the aircraft the last clause named
  let found = false;
  for (const clause of clausesOf(message)) {
    const p = takePrice(clause);
    const f = takeField(p.rest);
    const rest = (f ? f.rest : p.rest).replace(FILLER, " ").replace(/[:：=]/g, " ").replace(/\s{2,}/g, " ").trim();
    let hit: CommandAircraft[] = rest ? matchAircraft(list, rest) : [];
    if (rest && !hit.length && !p.price && !f) continue; // a clause about something else
    if (hit.length === 1) named = hit[0].id;
    if (!p.price && !f) continue;
    found = true;
    if (!hit.length && !rest) hit = named ? list.filter((a) => a.id === named) : list.length === 1 ? list : [];
    if (hit.length !== 1) { unclear.push(clause); continue; }
    if (p.price) prices[hit[0].id] = p.price;
    if (f) edits.push({ id: hit[0].id, field: f.field, value: f.value });
  }
  return found ? { prices, edits, unclear } : null;
}
