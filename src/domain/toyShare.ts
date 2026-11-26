import type { Db } from "../db/client";
import { getAircraftNames, operatorAliasesByName } from "./catalogue";
import { normalizeKey, type Classification } from "./constants";
import { mentions } from "./toyLookup";
import { parseRoutingLine } from "./toyRouting";
import { typeAliasesFor } from "./directory";
import type { Leg } from "./routing";

/** "send the G280 photos to Mr Chan" -> { what: "G280", who: "Mr Chan" }. Single-line messages only. */
export function parseShareRequest(message: string): { what: string; who: string } | null {
  const m = message.trim().match(/^(?:please\s+|can you\s+|could you\s+)?(?:send|share|forward|message|whatsapp)\s+(?:the\s+|my\s+)?(.+?)\s+(?:to|with)\s+(.+?)[.!?]*$/i);
  if (!m) {
    // Chinese: "把 G280 發給 陳生", "發送 G280 的相片給 陳生"
    const zh = message.trim().match(/^(?:請|请)?(?:幫我|帮我)?(?:把|將|将)?\s*(?:發送|发送|分享|傳送|传送|轉發|转发|發|发|傳|传)?\s*(.+?)\s*(?:發送給|发送给|發給|发给|傳給|传给|分享給|分享给|轉發給|转发给|寄給|寄给|發俾|发俾|傳俾|传俾|給|给)\s*(.+?)[。！!]*$/);
    if (!zh || !/[\u3400-\u9fff]/.test(message)) return null;
    const whatZh = zh[1].replace(/(?:的)?(?:相片|照片|圖片|图片|模板|報價|报价|資料卡|资料卡)\s*$/, "").trim();
    return whatZh && zh[2].trim() ? { what: whatZh, who: zh[2].trim() } : null;
  }
  const what = m[1].replace(/\b(photos?|pictures?|pics?|images?|card|details|info(?:rmation)?)\s*$/i, "").replace(/\b(and|&)\s*$/i, "").trim();
  const who = m[2].trim();
  return what && who ? { what, who } : null;
}

/**
 * The short names brokers type for a type, as the words of its full name: "CL605" is the Challenger 605, "F7X" the
 * Falcon 7X, "G7500" the Global 7500, "GLEX" the Global Express, "LJ45" the Learjet 45, "P300" the Phenom 300.
 * (A Gulfstream's own short name, "G650", is already in its name.)
 */
export function typeShortNames(word: string): string[] {
  const w = normalizeKey(word);
  const out: string[] = [];
  let m: RegExpMatchArray | null;
  if ((m = w.match(/^cl(\d{3}[a-z]*)$/))) out.push(`challenger${m[1]}`);
  if ((m = w.match(/^(?:g|gl)(\d{4})$/))) out.push(`global${m[1]}`);
  if (/^(?:glex|gex|bd700|globalex)$/.test(w)) out.push("globalexpress");
  if ((m = w.match(/^(?:f|fa)(\d{1,4}[a-z]*)$/)) && /x$|^(?:50|900|2000)/.test(m[1])) out.push(`falcon${m[1]}`);
  if ((m = w.match(/^(?:lj|lr|lear)(\d{2}[a-z]*)$/))) out.push(`learjet${m[1]}`);
  if ((m = w.match(/^(?:p|ph|emb)(100|300)(e|ev)?$/))) out.push(`phenom${m[1]}${m[2] ?? ""}`);
  if ((m = w.match(/^(?:l|leg|erj)(600|650)$/))) out.push(`legacy${m[1]}`);
  if ((m = w.match(/^(?:hawker|hs|h)(\d{3}[a-z]*)$/)) && /^(?:400|750|800|850|900|4000)/.test(m[1])) out.push(`hawker${m[1]}`);
  return out;
}

/**
 * Aircraft whose tail, type or operator (or one of the operator's other names, like "VJ") contains every word of the
 * request. aliases: other names to use instead of this workspace's own (the library is searched with the broker's).
 */
export async function findAircraftsForShare(db: Db, tenantId: string, text: string, aliases?: Map<string, string[]>) {
  const rows = await getAircraftNames(db, tenantId);
  const other = aliases ?? await operatorAliasesByName(db, [tenantId]);
  // The type's other names saved in the directory ("CL605" set as an alias), alongside its full name.
  const typeAlias = new Map<string, string[]>();
  for (const a of await typeAliasesFor(db, tenantId)) typeAlias.set(a.aircraftTypeId, [...(typeAlias.get(a.aircraftTypeId) ?? []), a.normalizedAlias]);
  // Chinese filler ("的", "飛機", "一架") is dropped and Latin names are separated from Chinese characters next to them.
  const cleaned = text
    .replace(/['’]s\b/gi, "")
    .replace(/(?:私人)?(?:飛機|飞机|噴射機|喷射机)|[的嘅架部個个]/g, " ")
    .replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, "$1 $2")
    .replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, "$1 $2");
  const words = cleaned.split(/\s+/).map(normalizeKey).filter((w) => w.length >= 2);
  const STOP = ["the", "of", "for", "aircraft", "plane", "jet"];
  const find = (ws: string[]) => ws.length === 0 ? [] : rows.filter((r) => {
    const hay = normalizeKey(`${r.tail ?? ""} ${r.aircraft} ${r.operator ?? ""} ${(r.operator ? other.get(normalizeKey(r.operator)) ?? [] : []).join(" ")} ${(typeAlias.get(r.aircraftTypeId) ?? []).join(" ")}`);
    // A word matches when it is in the name, is a short name for the type ("CL605"), or is one typo away ("CapacJet" finds CapaJet).
    return ws.every((w) => hay.includes(w) || typeShortNames(w).some((v) => hay.includes(v)) || mentions(hay, w));
  });
  // Every word first ("Jet Aviation" is a name); without filler words only when that finds nothing ("the G280 jet").
  const exact = find(words);
  return (exact.length ? exact : find(words.filter((w) => !STOP.includes(w))))
    .map((r) => ({ id: r.aircraftId, label: [r.operator, r.aircraft, r.tail].filter(Boolean).join(" · ") }));
}

const QUOTE_WORD = /\b(?:quote|quotation|quoting)s?\b/i;
const TRAILING_WORDS = /\s*\b(?:(?:quote|quotation|template|templates|message|text|photos?|pictures?|pics?|images?)\b\s*(?:,|&|\band\b|\bplus\b|\bwith\b)?\s*)+$/i;

export interface QuoteRequest {
  /** What the broker named for each option, in order ("Advance aviation G280"). */
  what: string[];
  /** The price typed for each option, as typed ("USD 90,000"); "" when none. Only present when a price was given. */
  prices?: string[];
  /** The photo kinds asked for ("with EXT and cabin photos"); [] for "no photos". Only present when asked. */
  kinds?: Classification[];
  /** The routing typed with the request ("HKG-LHR 12 Dec 1630 8 pax"), leg by leg. Only present when given. */
  legs?: Leg[];
  /** Airport codes in the routing that we don't know. */
  unknownAirports?: string[];
  /** The template's "Opening:" and "Closing:" lines, when filled in: they replace the standard opening and closing lines. */
  greeting?: string;
  closing?: string;
}

/** The quote template's own opening and closing lines ("Opening: Dear Mr Chan, …" / "開場白：…"). */
const OPENING_LINE = /^\s*(?:opening(?:\s+line)?|greeting|開場白|开场白)\s*[:：]\s*(.*)$/i;
const CLOSING_LINE = /^\s*(?:closing(?:\s+line)?|結尾語|结尾语|結尾|结尾)\s*[:：]\s*(.*)$/i;

const CURRENCY = "USD|US\\$|HKD|HK\\$|EUR|GBP|SGD|RMB|CNY|JPY|AUD|CAD|CHF|AED|THB|€|£|¥|\\$";
const CURRENCY_AFTER = "USD|HKD|EUR|GBP|SGD|RMB|CNY|JPY|AUD|CAD|CHF|AED|THB|美元|美金|港元|港幣|港币|人民幣|人民币|歐元|欧元";
const AMOUNT = "(?<![A-Za-z\\d.,-])\\d[\\d,.]*(?:\\s?(?:k|m|mn|million|萬|万))?";
const PER = "(?:\\s*(?:per|/|一)\\s*(?:hour|hr|h|flight|leg|trip|way|小時|小时))?";
const PRICE_LEAD = "(?:\\b(?:price[sd]?|cost|rate|fare|at|for|is|of)\\b|@|:|：|=|價錢|价钱|價格|价格|報價|报价|價|价|\\s)*";
// "605 USD 70,000": a currency written before the amount wins, so the type's number is not read as "605 USD".
const MONEY_FIRST = new RegExp(`${PRICE_LEAD}((?:${CURRENCY})\\s?${AMOUNT}${PER})`, "i");
const MONEY = new RegExp(`${PRICE_LEAD}((?:${CURRENCY})\\s?${AMOUNT}${PER}|${AMOUNT}\\s?(?:${CURRENCY_AFTER})${PER})`, "i");
// A bare number only counts as a price right after a price word: "price 90,000", "價錢 90000".
const BARE_PRICE = new RegExp(`(?:\\b(?:price[sd]?|cost|rate)\\b|價錢|价钱|價格|价格)\\s*(?:\\b(?:at|is|of)\\b|:|：|=)?\\s*(${AMOUNT}${PER})`, "i");

const KIND_WORDS: [Classification, RegExp][] = [
  ["exterior", /\b(?:ext|exteriors?|outside)\b|外觀|外观|外部/gi],
  ["cabin", /\b(?:cabins?|int|interiors?|inside)\b|客艙|客舱|機艙|机舱|內部|内部|內艙|内舱/gi],
  ["floor_plan", /\bfloor\s*-?\s*plans?\b|\blayouts?\b|\bfp\b|平面圖|平面图|佈局圖|布局图|佈局|布局/gi],
  ["combined", /\b(?:combined|combo|collage)\b|組合圖|组合图|組合|组合|合併圖|合并图/gi],
];
const NO_PHOTOS = /\b(?:no|without)\s+(?:photos?|pictures?|pics?|images?)\b|\b(?:text|message)\s+only\b|不要(?:相片|照片|圖片|图片)|唔要相|只要(?:訊息|信息|文字)/i;
const ALL_PHOTOS = /\ball\s+(?:the\s+)?(?:photos?|pictures?|pics?|images?)\b|所有(?:相片|照片|圖片|图片)|全部(?:相片|照片|圖片|图片)/i;

const KIND_ANY = KIND_WORDS.map(([, re]) => `(?:${re.source})`).join("|");
const PHOTO_NOUN = "(?:\\b(?:photos?|pictures?|pics?|images?|views?)\\b|相片|照片|圖片|图片)";
/** "with EXT, cabin and floor plan photos only", "plus combined photo", "要外觀同客艙相片": the whole phrase, joining words included. */
const KIND_PHRASE = new RegExp(
  `(?:(?:\\b(?:with|only|just|plus|and|include|including|send)\\b|[,，&+]|只要|要|加|和|及|同)\\s*)*(?:${KIND_ANY})` +
  `(?:\\s*(?:,|，|、|&|\\+|\\band\\b|\\bplus\\b|和|及|同|與|与)?\\s*(?:${KIND_ANY}))*` +
  `(?:\\s*(?:的|嘅)?\\s*${PHOTO_NOUN})?(?:\\s*\\bonly\\b)?`, "gi");

/** Takes the photo kinds out of a line: "G280 with EXT and cabin photos" -> exterior, cabin; "G280". */
function takeKinds(line: string): { kinds: Classification[] | null; rest: string } {
  if (NO_PHOTOS.test(line)) return { kinds: [], rest: line.replace(NO_PHOTOS, " ") };
  if (ALL_PHOTOS.test(line)) return { kinds: ["exterior", "cabin", "floor_plan"], rest: line.replace(ALL_PHOTOS, " ") };
  const phrases = line.match(KIND_PHRASE);
  if (!phrases) return { kinds: null, rest: line };
  const said = phrases.join(" ");
  const kinds = KIND_WORDS.filter(([, re]) => new RegExp(re.source, "i").test(said)).map(([k]) => k);
  return { kinds, rest: line.replace(KIND_PHRASE, " ") };
}

/** Takes a price out of a line: "Price at USD 90,000" -> "USD 90,000"; "G280 at HKD 700k per hour" -> "HKD 700k per hour". */
export function takePrice(line: string): { price: string | null; rest: string } {
  const m = line.match(MONEY_FIRST) ?? line.match(MONEY) ?? line.match(BARE_PRICE);
  if (!m) return { price: null, rest: line };
  return { price: m[1].trim(), rest: line.replace(m[0], " ") };
}

const COUNT_ONLY = /^(?:\d+|one|two|three|four|five|six|some|a few|few|several|multiple|these|following|the following|below|兩|两|二|三|四|五|幾|几)?\s*(?:options?|aircraft|jets?|份|個|个)?$/i;
const POLITE = /^(?:thanks?|thank you|please|pls|cheers|ok|okay|謝謝|谢谢|唔該|唔该|麻煩你|麻烦你)$/i;

/** A line with no quote word, inside a quote request: just the aircraft ("Tag aviation G650ER", "G280 and G550"). */
function aircraftOnly(line: string): string[] {
  return line
    .replace(/^\s*(?:[-*•·]|\d+[.)、]|(?:option|aircraft|選項|选项)\s*\d+\s*[:：.)-]?)\s*/i, "")
    .replace(/\b(?:quotes?|quotations?|photos?|pictures?|pics?|images?|template|message)\b|報價|报价|相片|照片/gi, " ")
    .replace(/\s{2,}/g, " ")
    .split(/\s*(?:,|，|、|&|\band\b|\bplus\b|和|及)\s*/i)
    .map((x) => x.replace(/^(?:the|my|a|an)\s+/i, "").replace(/^[\s:：\-–—|]+|[\s.!?。！？:：\-–—|]+$/g, "").trim())
    .filter((x) => x && !COUNT_ONLY.test(x) && !POLITE.test(x));
}

/** Labels in the chat's quote template and in typed requests ("Operator: Phenix Jet | Aircraft: Global 7500 | Price: USD 248,000"). */
const FIELD_LABELS: [string, RegExp][] = [
  ["date", /^(?:date|day|日期)$/i],
  ["from", /^(?:from|dep(?:arture)?|origin|出發|出发|由|起飛|起飞)$/i],
  ["to", /^(?:to|arr(?:ival)?|dest(?:ination)?|到達|到达|目的地|至)$/i],
  ["time", /^(?:time|etd|dep(?:arture)?\s*time|departs|時間|时间|起飛時間|起飞时间)$/i],
  ["pax", /^(?:pax|passengers?|乘客|人數|人数)$/i],
  ["operator", /^(?:operator|營運商|营运商|運營商|运营商)$/i],
  ["aircraft", /^(?:aircraft|aircraft type|type|jet|tail|tail number|飛機|飞机|機型|机型)$/i],
  ["price", /^(?:price|cost|rate|價格|价格|價錢|价钱)$/i],
];
const LABEL_WORDS = "date|day|from|to|dep(?:arture)?|arr(?:ival)?|time|etd|pax|passengers?|operator|aircraft(?: type)?|type|tail(?: number)?|price|cost|日期|出發|出发|到達|到达|時間|时间|乘客|營運商|营运商|飛機|飞机|機型|机型|價格|价格";
const LABELLED_SPLIT = new RegExp(`\\s*[|｜;；]\\s*|[,，]\\s*(?=(?:${LABEL_WORDS})\\s*[:：])`, "i");

type Labelled = { route?: string; operator?: string; aircraft?: string; price?: string; blank?: boolean };

/** A line of labelled fields, or null when it has none. Blank fields ("Date: | From: |") give { blank: true }. */
function readLabelled(line: string): Labelled | null {
  const body = line.replace(/^\s*(?:leg|option|航段|選項|选项)\s*\d*\s*[-–—.)]?\s*/i, "");
  const f: Record<string, string> = {};
  let labelled = 0;
  for (const part of body.split(LABELLED_SPLIT)) {
    const m = part.match(/^\s*([^:：]{1,24}?)\s*[:：]\s*(.*)$/);
    if (!m) continue;
    const key = FIELD_LABELS.find(([, re]) => re.test(m[1].trim()))?.[0];
    if (!key) continue;
    labelled++;
    if (m[2].trim()) f[key] = m[2].trim();
  }
  if (!labelled) return null;
  if (!Object.keys(f).length) return { blank: true };
  if (f.from || f.to || f.date || f.time || f.pax) {
    if (!f.from || !f.to) return { blank: true };
    return { route: [`${f.from}-${f.to}`, f.date ?? "", f.time ?? "", f.pax ? `${f.pax.replace(/\D+$/, "")} pax` : ""].filter(Boolean).join(" ") };
  }
  return { operator: f.operator, aircraft: f.aircraft, price: f.price };
}

/** "8 pax" / "Pax: 8" / "8人" on a line of its own. */
const PAX_LINE = /^\s*(?:(\d{1,3})\s*(?:pax|passengers?|people|persons?|ppl|guests?|人|位|名)|(?:pax|passengers?|乘客|人數|人数)\s*[:：x×]?\s*(\d{1,3}))\s*[.。]?\s*$/i;

const MONEY_ALL = new RegExp(MONEY.source, "gi");
/** "Phenix Jet G7500 USD 248k, Tag G650ER USD 230k": one line per aircraft when a line carries several prices. */
function splitPricedLine(line: string): string[] {
  if ((line.match(MONEY_ALL) ?? []).length < 2) return [line];
  return line.split(/\s*[,，;；]\s*(?=\D)/).filter(Boolean);
}

/**
 * Reads a quote request, on one line or several:
 *   "Give me Advance aviation G280 quote" / "Price at USD 90,000"
 *   "Can you prepare 2 quotes?" / "Advance aviation G280 USD 90,000" / "Tag aviation G650ER, EXT and cabin photos"
 * Each line may carry an aircraft, a price (for that aircraft, or for the one above when the line has only a price)
 * and the photo kinds wanted. The first line must ask for a quote.
 */
export function parseQuoteRequest(message: string, today = new Date()): QuoteRequest | null {
  const lines = message.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).flatMap(splitPricedLine);
  if (!lines.length) return null;
  const what: string[] = [];
  const prices: string[] = [];
  let kinds: Classification[] | null = null;
  let pending: string | null = null; // a price typed before its aircraft
  const legs: Leg[] = [];
  const unknown: string[] = [];
  let pendingOperator: string | null = null; // "Operator: X" on its own line, the aircraft on the next
  // The request ("Draft me a quote for") may come after the routing; until it does, only routing lines are allowed.
  let started = false;
  let allPax: number | null = null; // "8 pax" on a line of its own: for every leg
  let greeting = "";
  let closing = "";
  for (const rawLine of lines) {
    const open = rawLine.match(OPENING_LINE);
    if (open) { greeting = open[1].trim(); continue; }
    const close = rawLine.match(CLOSING_LINE);
    if (close) { closing = close[1].trim(); continue; }
    const paxLine = rawLine.match(PAX_LINE);
    if (paxLine) { allPax = Number(paxLine[1] ?? paxLine[2]); continue; }
    // The template's labelled lines: a leg ("Date: 12 Dec | From: HKG | To: LHR") or an option ("Operator: … | Aircraft: … | Price: …").
    let raw = rawLine;
    const lab = readLabelled(rawLine);
    if (lab?.blank) continue;
    if (lab?.route) raw = lab.route;
    else if (lab && !started) return null; // "Operator: …" before any request: the add-an-aircraft template, not a quote
    else if (lab && (lab.operator || lab.aircraft)) {
      if (!lab.aircraft) { pendingOperator = lab.operator ?? null; if (lab.price) pending = lab.price; continue; }
      what.push([lab.operator ?? pendingOperator ?? "", lab.aircraft].filter(Boolean).join(" "));
      prices.push(lab.price ?? pending ?? "");
      pendingOperator = null; pending = null;
      continue;
    } else if (lab?.price) raw = `Price: ${lab.price}`;
    const k = takeKinds(raw);
    if (k.kinds) kinds = [...new Set([...(kinds ?? []), ...k.kinds])];
    const p = takePrice(k.rest);
    // A routing line ("HKG-LHR 12 Dec 1630 8 pax") is legs, not an aircraft. On the first line it may sit beside the request.
    const route = parseRoutingLine(p.rest, today);
    if (route) {
      legs.push(...route.legs);
      unknown.push(...route.unknown);
      if (started || !parseOneQuoteLine(route.rest)) continue; // a routing line on its own
      p.rest = route.rest; // the request with the routing beside it
    }
    const head = started ? null : parseOneQuoteLine(p.rest);
    if (!started && !head) return null;
    started = true;
    const names = (head ? head.what : aircraftOnly(p.rest)).filter((x) => !COUNT_ONLY.test(x) && !POLITE.test(x));
    if (names.length) {
      for (const x of names) { what.push(x); prices.push(p.price ?? pending ?? ""); }
      pending = null;
    } else if (p.price) {
      // "Price at USD 90,000" under an aircraft is its price; before any aircraft it waits for the next one.
      if (what.length) prices[prices.length - 1] = p.price;
      else pending = p.price;
    }
  }
  if (!started) return null;
  if (allPax != null) for (const l of legs) if (l.pax == null) l.pax = allPax;
  return {
    what,
    ...(prices.some(Boolean) ? { prices } : {}),
    ...(kinds ? { kinds } : {}),
    ...(legs.length || unknown.length ? { legs, ...(unknown.length ? { unknownAirports: [...new Set(unknown)] } : {}) } : {}),
    ...(greeting ? { greeting } : {}),
    ...(closing ? { closing } : {}),
  };
}

/**
 * "make a quote for the G650 and B-KXX" -> ["G650", "B-KXX"]; plain "quote" -> [].
 * "give me CapaJet's G550 and Tag's G650ER template and photos" -> ["CapaJet's G550", "Tag's G650ER"].
 */
function parseOneQuoteLine(message: string): { what: string[] } | null {
  const m = message.trim().replace(/[.!?。！？]+$/, "").replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").replace(/(?:^|\s)[,，]+\s*$/, "").trim();
  // Chinese: "給我 CapacJet 的 G550 和 Tag 的 G650ER 的模板和相片", "幫我整 CapaJet G550 嘅報價"
  if (/報價|报价|模板|範本|范本|訊息|信息|消息|資料卡|资料卡/.test(m) && /[\u3400-\u9fff]/.test(m)) {
    const lead = m.replace(/^(?:請|请)?(?:幫我|帮我|給我|给我|俾我|我要|我想要|我需要|我想|傳給我|传给我)?\s*(?:生成|草擬|草拟|起草|擬定|拟定|擬|拟|整|做|準備|准备|預備|预备)?\s*(?:一份|一個|一个)?/, "");
    const subject = lead.replace(/(?:的|嘅)?\s*(?:(?:報價|报价|模板|範本|范本|訊息|信息|消息|資料卡|资料卡|相片|照片|圖片|图片)\s*(?:,|，|和|及|同|與|与|跟|、|以及)?\s*)+$/, "").trim();
    if (!subject) return { what: [] };
    if (/發給|发给|傳給|传给|發送給|发送给|分享給|分享给/.test(subject)) return null;
    return { what: subject.split(/\s*(?:,|，|、|和|及|同|與|与|跟|以及|\band\b|&)\s*/).map((x) => x.replace(/的$/, "").trim()).filter(Boolean) };
  }
  const split = (t: string) => t.split(/\s*(?:,|&|\band\b|\bplus\b)\s*/i).map((x) => x.replace(/^(?:the|my)\s+/i, "").trim()).filter(Boolean);
  if (QUOTE_WORD.test(m)) {
    // The aircraft can come before or after the word "quote": "quote for the G650", "Give me G280 quote and photo".
    const body = m
      .replace(/^(?:please\s+|can you\s+|could you\s+)?(?:give|get|send|prepare|make|show|pull up|draft|create|build|i need|i want|need|want)\s+(?:me\s+)?/i, "")
      .replace(/\b(?:quote|quotation|quoting)s?\b\s*(?:(?:message|text|template)\s*)?(?:for|of|on)?/gi, " ")
      .replace(/\b(?:a|an)\s+(?=\s)/gi, " ")
      .replace(/\b(?:template|templates|message|photos?|pictures?|pics?|images?|please|thanks?|thank you)\b/gi, " ")
      .replace(/^\s*(?:a|an)\s+/i, " ");
    const what = body.split(/\s*(?:,|&|\band\b|\bplus\b|\bwith\b)\s*/i).map((x) => x.trim().replace(/^[\s:：\-–—|]+|[\s:：\-–—|]+$/g, "").replace(/^(?:the|my|a|an)\s+/i, "").trim()).filter(Boolean);
    return { what };
  }
  // No "quote" word: "give me X and Y template and photos" (needs a request verb and a template/message word).
  if (!/\b(?:template|templates|message)\b/i.test(m)) return null;
  const stripped = m.replace(/^(?:please\s+|can you\s+|could you\s+)?(?:give|get|send|prepare|make|show|pull up|i need|i want|need|want)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?/i, "");
  if (stripped === m) return null;
  const subject = stripped.replace(TRAILING_WORDS, "").trim();
  if (!subject || /\s(?:to|for)\s/i.test(` ${subject} `) && /\bto\s+\S/i.test(subject)) return null; // "...to Mr Chan" is a send request
  return { what: split(subject) };
}
