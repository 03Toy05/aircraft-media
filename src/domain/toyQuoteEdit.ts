import { parseWifiValue, parseYesNoValue } from "./card";
import { takePrice } from "./toyShare";
import type { WifiStatus, YesNoStatus } from "./constants";
import { matchAircraft, type CommandAircraft } from "./quoteCommands";

/**
 * Changes typed after Toy shows a quote, read against the aircraft in that quote:
 *   "For 605, price is USD 70k. For G280, price is EUR 60k"  -> two prices (the quote only)
 *   "For Vista 605, the YOM shall be 2016. Change it"         -> a change to that aircraft's record (asked first)
 *   "G280 WIFI: Yes, at USD 10/MB" / "605 no pets" / "605 notes: catering on request" -> the same, for those fields
 * A clause that names an aircraft but nothing else ("For 605") carries over to the next clause ("price is USD 70k").
 */

export type EditField = "yom" | "yor" | "capacity" | "wifi" | "pets" | "smoking" | "notes";
export type FieldEdit =
  | { id: string; field: "yom" | "yor" | "capacity"; value: number }
  | { id: string; field: "wifi"; value: WifiStatus; detail: string }
  | { id: string; field: "pets" | "smoking"; value: YesNoStatus }
  /** append: "add a note: …" adds to the notes; "notes: …" replaces them ("notes: none" clears them). */
  | { id: string; field: "notes"; value: string; append: boolean };
type TextEdit = Exclude<FieldEdit, { field: "yom" | "yor" | "capacity" }> extends infer E ? E extends { id: string } ? Omit<E, "id"> : never : never;

export interface QuoteFollowUp {
  prices: Record<string, string>;
  edits: FieldEdit[];
  /** Clauses with a price or a change whose aircraft could not be told apart. */
  unclear: string[];
}

const YOM = "yom|year of manufacture|year built|manufactured|出廠年份|出厂年份|製造年份|制造年份|出廠|出厂";
const YOR = "yor|year of refurb(?:ishment)?|refurb(?:ished|ishment)?|翻新年份|改裝年份|改装年份|翻新";
const CAP = "capacity|seats?|載客量|载客量|座位數|座位数|座位";
const FIELD_OF = (w: string): "yom" | "yor" | "capacity" => new RegExp(`^(?:${YOM})$`, "i").test(w) ? "yom" : new RegExp(`^(?:${YOR})$`, "i").test(w) ? "yor" : "capacity";
const LINK = "(?:\\s*(?:(?:shall|should|will|must|has to|needs to)\\s+be|be\\s+changed\\s+to|changed\\s+to|is|are|to|=|:|：|as|be|at|in|為|为|係|改為|改为|改成|改做))?";
const FORWARD = new RegExp(`(?:\\bthe\\s+)?(?<![A-Za-z])(${YOM}|${YOR}|${CAP})(?![A-Za-z])${LINK}\\s*(\\d{1,4})(?!\\d)`, "i");
const REVERSE = new RegExp(`(?<![\\d.])(\\d{1,4})\\s*-?\\s*(${YOM}|${YOR}|${CAP})(?![A-Za-z])`, "i");

/** Words that only carry the sentence ("for", "change it", "please"). */
const FILLER = /\b(?:for|of|on|the|its?|is|are|price[sd]?|cost|rate|change|changes|update|set|make|please|pls|shall|should|will|must|be|to|now|instead|also|and|then|thanks?|thank you|ok(?:ay)?|no|yes|aircraft|record|details?|quote|one)\b|請|请|幫我|帮我|改|的|嘅/gi;

function takeField(text: string): { field: "yom" | "yor" | "capacity"; value: number; rest: string } | null {
  const m = text.match(FORWARD);
  if (m) return { field: FIELD_OF(m[1]), value: Number(m[2]), rest: text.replace(m[0], " ") };
  const r = text.match(REVERSE);
  if (r) return { field: FIELD_OF(r[2]), value: Number(r[1]), rest: text.replace(r[0], " ") };
  return null;
}

// ---------------------------------------------------------------- WIFI, pets, smoking, notes

const WIFI_W = "wi-?fi|wi fi|無線網絡|无线网络|無線上網|无线上网";
const PETS_W = "pets?|寵物|宠物";
const SMOKE_W = "smoking|吸煙|吸烟|抽煙|抽烟";
const NOTES_W = "notes?|備註|备注";
const kindOf = (w: string): "wifi" | "pets" | "smoking" | "notes" =>
  new RegExp(`^(?:${WIFI_W})$`, "i").test(w) ? "wifi" : new RegExp(`^(?:${PETS_W})$`, "i").test(w) ? "pets" : new RegExp(`^(?:${SMOKE_W})$`, "i").test(w) ? "smoking" : "notes";
const TEXT_LINK = "(?:\\s*(?:(?:shall|should|will|must)\\s+be|be\\s+changed\\s+to|changed\\s+to|change\\s+to|is|are|to|=|as|為|为|係|改為|改为|改成|改做))?\\s*[:：]?";
/** "WIFI: Yes, at USD 10/MB", "the pets shall be no", "add a note: …", "寵物：不可以". The value runs to the end of the line. */
const LABELLED = new RegExp(`(?:^|(?<=[\\s,，.;；]))(?:the\\s+)?(?:(add(?:\\s+(?:a|an|the|to\\s+the))?\\s+(?:note|notes)|append(?:\\s+to\\s+the)?\\s+notes?)|(${WIFI_W}|${PETS_W}|${SMOKE_W}|${NOTES_W}))(?![A-Za-z])${TEXT_LINK}\\s*(.+)$`, "i");
/** "no pets", "non-smoking", "smoking not allowed", "pet friendly", "no WIFI". */
const NATURAL: [RegExp, (m: RegExpMatchArray) => TextEdit][] = [
  [/\b(?:no|without)\s+(pets?|smoking|wi-?fi)\b/i, (m) => edit(kindOf(m[1]), "no")!],
  [/\bnon-?smoking\b/i, () => ({ field: "smoking", value: "no" })],
  [/\bpet[- ]friendly\b/i, () => ({ field: "pets", value: "yes" })],
  [/\b(pets?|smoking)\s+(?:is\s+|are\s+)?(not\s+)?(?:allowed|permitted|ok)\b/i, (m) => ({ field: kindOf(m[1]) as "pets" | "smoking", value: m[2] ? "no" : "yes" })],
  [/(禁止|不准|不可以?|不能|唔可以|可以)\s*(吸煙|吸烟|抽煙|抽烟|帶寵物|带宠物|攜帶寵物|携带宠物)/, (m) => ({ field: /煙|烟/.test(m[2]) ? "smoking" : "pets", value: m[1] === "可以" ? "yes" : "no" })],
];

function edit(field: "wifi" | "pets" | "smoking" | "notes", value: string, append = false): TextEdit | null {
  if (field === "notes") {
    const v = value.trim();
    return { field, value: /^(none|nil|n\/a|-|—|empty|clear|remove|delete|無|无|冇|刪除|删除)$/i.test(v) ? "" : v, append };
  }
  // Only the first sentence is the value: "yes. Change it" is "yes".
  const v = value.split(/[.;。；!！](?:\s|$)/)[0].trim();
  if (field === "wifi") { const w = parseWifiValue(v); return w ? { field, value: w.status, detail: w.detail } : null; }
  const y = parseYesNoValue(v);
  return y ? { field, value: y.status } : null;
}

/** Takes the WIFI, pets, smoking or notes change out of a line; the rest of the line still names the aircraft. */
function takeTextEdit(line: string): { edit: TextEdit; rest: string } | null {
  for (const [re, make] of NATURAL) {
    const m = line.match(re);
    if (m) return { edit: make(m), rest: line.replace(m[0], " ") };
  }
  const m = line.match(LABELLED);
  if (!m) return null;
  const notes = !!m[1] || kindOf(m[2]) === "notes";
  // A trailing "Change it" / "please" is the request, not part of a note.
  const value = notes ? m[3].replace(/(?:[.。;；,，]?\s*(?:please\s+)?(?:change|update|save)\s+it|[.。;；,，]?\s*please)[.!。！]?\s*$/i, "").trim() : m[3];
  const e = edit(notes ? "notes" : kindOf(m[2]), value, !!m[1]);
  return e ? { edit: e, rest: line.slice(0, m.index) } : null;
}

export const validEdit = (field: "yom" | "yor" | "capacity", value: number) => field === "capacity" ? value >= 1 && value <= 500 : value >= 1950 && value <= 2100;

/** Splits on sentence ends, new lines and commas; a full stop or comma inside a number ("1.2m", "70,000") is kept. */
function clausesOf(text: string): string[] {
  return text.split(/(?:[.;!。；！](?!\d)|\r?\n|,(?!\d)|，|、|\s+then\s+)/i).map((c) => c.trim()).filter(Boolean);
}

const TOKEN = (i: number) => ` \u0001${i}\u0001 `;

export function parseQuoteFollowUp(message: string, list: CommandAircraft[]): QuoteFollowUp | null {
  if (!list.length || /[?？]\s*$/.test(message.trim())) return null; // a question is a lookup, not a change
  // WIFI, pets, smoking and notes first, line by line: their values may hold commas and prices ("Yes, at USD 10/MB").
  const texts: TextEdit[] = [];
  const lines = message.split(/\r?\n/).map((line) => {
    const t = takeTextEdit(line);
    if (!t) return line;
    texts.push(t.edit);
    return t.rest + TOKEN(texts.length - 1);
  });
  const prices: Record<string, string> = {};
  const edits: FieldEdit[] = [];
  const unclear: string[] = [];
  let named: string | null = null; // the aircraft the last clause named
  let found = false;
  for (const clause of clausesOf(lines.join("\n"))) {
    const tok = clause.match(/\u0001(\d+)\u0001/);
    const text = tok ? texts[Number(tok[1])] : null;
    const shown = text ? clause.replace(/\s*\u0001\d+\u0001\s*/, " ").trim() || message.trim() : clause;
    const plain = clause.replace(/\u0001\d+\u0001/g, " ");
    const p = text ? { price: null, rest: plain } : takePrice(plain);
    const f = text ? null : takeField(p.rest);
    const rest = (f ? f.rest : p.rest).replace(FILLER, " ").replace(/[:：=]/g, " ").replace(/\s{2,}/g, " ").trim();
    let hit: CommandAircraft[] = rest ? matchAircraft(list, rest) : [];
    if (rest && !hit.length && !p.price && !f && !text) continue; // a clause about something else
    if (hit.length === 1) named = hit[0].id;
    if (!p.price && !f && !text) continue;
    found = true;
    if (!hit.length && !rest) hit = named ? list.filter((a) => a.id === named) : list.length === 1 ? list : [];
    if (hit.length !== 1) { unclear.push(shown); continue; }
    const id = hit[0].id;
    if (p.price) prices[id] = p.price;
    if (f) edits.push({ id, field: f.field, value: f.value });
    if (text) edits.push({ id, ...text } as FieldEdit);
  }
  return found ? { prices, edits, unclear } : null;
}
