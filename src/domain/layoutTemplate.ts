import { paraText, type LBlock, type LPara, type LTable, type Layout } from "./docxLayout";

/**
 * Toy turns a broker's past quote (a Word file) into their quote layout: it finds the values by their labels
 * ("Price: USD 120,000", "Seats | 13"), the routing (a From/To table, or lines like "HKG → NRT"), the aircraft and prices
 * without labels, the greeting, and the photos, and swaps each for a field that every new quote fills in. The rest
 * (headings, terms, bank details, fonts, colours) stays exactly as written. The client's name is left blank.
 * Deterministic: rules only, no AI. Tags typed by the broker ({price}) are kept as they are.
 */

export interface LEach { t: "each"; blocks: LBlock[]; /** Each aircraft after the first starts on a new page (as the second one did in the Word file). */ newPage?: boolean }
export type TBlock = LBlock | LEach;
export interface QuoteLayout extends Omit<Layout, "body"> { body: TBlock[] }
export interface LayoutFound {
  /** Fields found, in the order of the list below ("aircraft", "price", "routing table"…). */
  fields: string[];
  photos: number;
  logo: boolean;
  /** Repeated once per aircraft. */
  section: boolean;
  clientBlanked: boolean;
}

type F = string; // a field name, as the tag it becomes

/** Labels, in English and Chinese, for each field. "" = left blank (the old client's name). */
const LABELS: [F, string][] = [
  ["reference", String.raw`(?:our\s+)?ref(?:erence)?(?:\s*(?:no\.?|number|#))?|quot(?:e|ation)\s*(?:no\.?|number|#|ref(?:erence)?)|報價編號|报价编号|參考編號|参考编号|編號|编号`],
  ["date", String.raw`date|issue date|日期`],
  ["", String.raw`to|attn\.?|attention|client|customer|guest|lead passenger|致|客戶|客户|收件人`],
  ["route", String.raw`routing|route|itinerary|trip|sector|sectors|行程|航程|路線|路线`],
  ["pax", String.raw`passengers|no\.?\s*of\s*(?:passengers|pax)|pax|乘客|人數|人数`],
  ["aircraft", String.raw`aircraft(?:\s*type)?|type|model|機型|机型|飛機型號|飞机型号|飛機|飞机`],
  ["operator", String.raw`operator|營運商|运营商|營運者`],
  ["tail", String.raw`tail(?:\s*(?:no\.?|number))?|registration|reg\.?|註冊編號|注册编号|機尾編號|机尾编号`],
  ["base", String.raw`(?:home\s*)?base|基地`],
  ["yom", String.raw`year\s*of\s*manufacture|yom|year\s*built|built|manufactured|出廠年份|出厂年份|製造年份|制造年份`],
  ["yor", String.raw`(?:year\s*of\s*)?refurb(?:ishment|ished)?(?:\s*year)?|yor|翻新(?:年份)?`],
  ["seats", String.raw`seats?|seating(?:\s*capacity)?|capacity|max(?:imum)?\s*passengers|座位(?:數|数)?|載客量|载客量`],
  ["wifi", String.raw`wi-?fi|internet|connectivity|無線網絡|无线网络`],
  ["smoking", String.raw`smoking|吸煙|吸烟`],
  ["pets", String.raw`pets?|寵物|宠物`],
  ["price", String.raw`(?:charter\s*)?price|total(?:\s*(?:price|cost|amount))?|cost|rate|quote|價格|价格|報價|报价|收費|收费|費用|费用`],
];
const LABEL_RE = LABELS.map(([f, src]) => [f, new RegExp(`^\\s*(?:${src})\\s*$`, "i")] as const);
const labelOf = (s: string) => LABEL_RE.find(([, re]) => re.test(s.replace(/[:：]\s*$/, "")))?.[0];
/** "Label: value" inside a paragraph, at its start or after a tab, a wide gap or a bar. */
const INLINE = new RegExp(`(^|\\t|\\n| {2,}|\\s\\|\\s*|｜)(\\s*(?:${LABELS.map(([, s]) => s).join("|")})\\s*[:：]\\s*)`, "gi");
const INLINE_TEST = new RegExp(INLINE.source, "i");
const SEP = /\t|\n| {2,}|\s\|\s*|｜/;

const MAKERS = String.raw`Gulfstream|Bombardier|Global|Challenger|Learjet|Embraer|Legacy|Praetor|Phenom|Lineage|Dassault|Falcon|Cessna|Citation|Textron|Hawker|Beechcraft|King\s?Air|Premier|Boeing|BBJ|Airbus|ACJ|Pilatus|HondaJet|Cirrus|Nextant|Eclipse|Sikorsky|Leonardo|AgustaWestland|Bell|灣流|湾流|龐巴迪|庞巴迪|環球|环球|挑戰者|挑战者|巴航工業|巴航工业|獵鷹|猎鹰|獎狀|奖状|空中巴士|空客|波音`;
const AIRCRAFT_NAME = new RegExp(`(?:${MAKERS})(?:[ \\-]?(?:[A-Z0-9][\\w\\-]*|[\\u4e00-\\u9fff]+))*`, "u");
const STRONG_MAKER = /^(?:Gulfstream|Bombardier|Embraer|Dassault|Cessna|Learjet|Hawker|Beechcraft|Pilatus|HondaJet|Airbus|Boeing|灣流|湾流|龐巴迪|庞巴迪|巴航工業|巴航工业|空中巴士|空客|波音)/;
const PRICE = /(?:USD|HKD|EUR|GBP|SGD|RMB|CNY|JPY|AUD|CAD|CHF|MYR|THB|US\$|HK\$|S\$|€|£|¥|\$)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:USD|HKD|EUR|GBP|SGD|RMB|CNY|JPY))?|\d[\d,]{3,}(?:\.\d+)?\s?(?:USD|HKD|EUR|GBP|SGD|RMB|CNY|JPY)/;
const OPTION_NO = /\b(Option|Aircraft|Choice|Proposal)\s*(?:No\.?\s*)?(\d{1,2})\b|(選項|选项|方案|飛機|飞机)\s*(\d{1,2})/i;
const ROUTE_LINE = /\b[A-Z]{3,4}\b\s*(?:→|->|–|—|-|>|\/|to)\s*\b[A-Z]{3,4}\b/;
const GREETING = /^\s*(?:dear\b|hi\b|hello\b|good\s+(?:morning|afternoon|evening)\b|親愛的|亲爱的|您好|你好)/i;
const AIRCRAFT_TAG = /\{(?:aircraft|operator|tail|base|yom|yor|seats|wifi|smoking|pets|price|notes|extra|owner_approval|number)\}/;

/** Replaces characters [start, end) of a paragraph's text with `text`, keeping the style of the run where it starts. */
export function replaceRange(p: LPara, start: number, end: number, text: string) {
  const runs = p.runs.filter((r) => !r.image);
  if (!runs.length) { p.runs.push({ text, size: 11 }); return; }
  let pos = 0;
  const at = runs.map((r) => { const a = pos; pos += r.text.length; return a; });
  let ti = runs.findIndex((r, k) => start >= at[k] && start < at[k] + r.text.length);
  if (ti < 0) ti = runs.length - 1;
  runs.forEach((r, k) => {
    const len = r.text.length;
    const s = Math.min(Math.max(start - at[k], 0), len), e = Math.min(Math.max(end - at[k], 0), len);
    r.text = r.text.slice(0, s) + (k === ti ? text : "") + r.text.slice(Math.max(e, s));
  });
}
const setText = (p: LPara, text: string) => replaceRange(p, 0, paraText(p).length, text);

const cellText = (c: { blocks: LPara[] }) => c.blocks.map(paraText).join("\n").trim();
const tableText = (t: LTable) => t.rows.map((r) => r.cells.map(cellText).join(" ")).join("\n");
const blockText = (b: TBlock): string => (b.t === "p" ? paraText(b) : b.t === "tbl" ? tableText(b) : b.blocks.map(blockText).join("\n"));
const hasImage = (b: TBlock): boolean => (b.t === "p" ? b.runs.some((r) => r.image) : b.t === "tbl" ? b.rows.some((r) => r.cells.some((c) => c.blocks.some(hasImage))) : b.blocks.some(hasImage));
const images = (b: TBlock) => (b.t === "p" ? b.runs.filter((r) => r.image) : b.t === "tbl" ? b.rows.flatMap((r) => r.cells.flatMap((c) => c.blocks.flatMap((p) => p.runs.filter((x) => x.image)))) : []);

// ---------------------------------------------------------------- the routing table

const LEG_COLS: [string, RegExp][] = [
  ["{leg_date}", /^(?:date|flight date|日期)$/i],
  ["{leg_from}", /^(?:from|origin|departure airport|dep(?:arture)?\s*airport|出發地|出发地|起點|起点|出發機場|出发机场)$/i],
  ["{leg_to}", /^(?:to|destination|arrival airport|arr(?:ival)?\s*airport|目的地|到達機場|到达机场)$/i],
  ["{leg_dep}", /^(?:dep(?:\.|arture)?(?:\s*time)?(?:\s*\(?(?:lt|local)\)?)?|etd|起飛(?:時間)?|起飞(?:时间)?|出發時間|出发时间|出發|出发)$/i],
  ["{leg_arr}", /^(?:arr(?:\.|ival)?(?:\s*time)?(?:\s*\(?(?:lt|local)\)?)?|eta|降落(?:時間)?|降落(?:时间)?|抵達時間|抵达时间|抵達|抵达)$/i],
  ["{leg_time}", /^(?:flight\s*time|flying\s*time|duration|block\s*time|飛行時間|飞行时间)$/i],
  ["{leg_pax}", /^(?:pax|passengers|no\.?\s*of\s*pax|乘客|人數|人数)$/i],
  ["{leg_route}", /^(?:route|routing|sector|leg|itinerary|行程|航段|航程)$/i],
];

function routingTable(t: LTable): boolean {
  if (t.rows.length < 2) return false;
  const head = t.rows[0].cells.map((c) => cellText(c).replace(/[:：]$/, ""));
  const kinds = head.map((h) => LEG_COLS.find(([, re]) => re.test(h))?.[0] ?? null);
  // "Departure / Arrival" alone are the airports when there is no From / To column.
  if (!kinds.includes("{leg_from}")) { const i = kinds.indexOf("{leg_dep}"); if (i >= 0 && /^(?:departure|出發|出发)$/i.test(head[i])) kinds[i] = "{leg_from}"; }
  if (!kinds.includes("{leg_to}")) { const i = kinds.indexOf("{leg_arr}"); if (i >= 0 && /^(?:arrival|抵達|抵达)$/i.test(head[i])) kinds[i] = "{leg_to}"; }
  const n = kinds.filter(Boolean).length;
  if (n < 2 || !kinds.some((k) => k === "{leg_from}" || k === "{leg_to}" || k === "{leg_route}" || k === "{leg_date}")) return false;
  const row = t.rows[1];
  row.cells.forEach((c, i) => {
    const k = kinds[i];
    if (!c.blocks.length) c.blocks.push({ t: "p", runs: [], align: "left", before: 0, after: 0, indent: 0 });
    c.blocks.splice(1);
    setText(c.blocks[0], k === "{leg_route}" ? "{leg_from} → {leg_to}" : k ?? "");
  });
  row.repeat = "legs";
  t.rows.splice(2);
  return true;
}

// ---------------------------------------------------------------- values in a paragraph

/** Swaps labelled values and unlabelled aircraft names and prices for fields. Returns the fields it set. */
function fillPara(p: LPara, found: Set<string>, opts: { unlabelled: boolean }) {
  let text = paraText(p);
  if (!text.trim()) return;
  // Labelled values, last first so earlier positions stay right.
  const hits = [...text.matchAll(INLINE)].map((m) => {
    const label = m[2];
    const field = labelOf(label) ?? null;
    const vStart = m.index! + m[1].length + label.length;
    const rest = text.slice(vStart);
    const sep = rest.search(SEP);
    return { field, vStart, vEnd: vStart + (sep < 0 ? rest.length : sep) };
  });
  for (const h of hits.reverse()) {
    if (h.field === null) continue;
    const old = text.slice(h.vStart, h.vEnd);
    if (/\{\w+\}/.test(old)) continue; // a tag the broker typed
    replaceRange(p, h.vStart, h.vEnd, `{${h.field || "client"}}`);
    found.add(h.field || "client");
    text = paraText(p);
  }
  // Values without a label only in short lines (a heading, a price line), never inside terms or a long sentence.
  if (!opts.unlabelled || paraText(p).trim().length > 80) return;
  for (const [re, tag] of [[OPTION_NO, "number"], [PRICE, "price"], [AIRCRAFT_NAME, "aircraft"]] as const) {
    text = paraText(p);
    const m = re.exec(text);
    if (!m || text.slice(Math.max(0, m.index - 1), m.index + m[0].length + 1).includes("{")) continue;
    if (tag === "aircraft" && !/\d/.test(m[0]) && !STRONG_MAKER.test(m[0])) continue; // "Premier Aviation" is not an aircraft
    if (tag === "number") {
      const digits = m[2] ?? m[4];
      const at = m.index + m[0].lastIndexOf(digits);
      replaceRange(p, at, at + digits.length, "{number}");
    } else replaceRange(p, m.index, m.index + m[0].length, `{${tag}}`);
    found.add(tag);
  }
}

// ---------------------------------------------------------------- the whole document

/** Word splits typed tags over runs ("{pri" + "ce}"): each is moved whole into the run where it starts. */
function joinTags(p: LPara) {
  for (const m of [...paraText(p).matchAll(/\{[#/]?[a-z][a-z0-9_]*(?: [\d.]+cm)?\}/g)]) replaceRange(p, m.index!, m.index! + m[0].length, m[0]);
}
function eachPara(blocks: LBlock[], fn: (p: LPara) => void) {
  for (const b of blocks) if (b.t === "p") fn(b); else for (const r of b.rows) for (const c of r.cells) c.blocks.forEach(fn);
}

export function layoutTemplate(source: Layout): { layout: QuoteLayout; found: LayoutFound } {
  const found = new Set<string>();
  const layout: Layout = structuredClone(source);
  eachPara([...layout.body, ...layout.header, ...layout.footer], joinTags);
  const body: TBlock[] = layout.body;

  // Tables: the routing, a list of the options (one row per aircraft), or label | value rows.
  for (const b of body) {
    if (b.t !== "tbl") continue;
    if (routingTable(b)) { found.add("routing table"); continue; }
    let optionRow = -1;
    for (const [ri, row] of b.rows.entries()) {
      for (const [ci, c] of row.cells.entries()) {
        const label = labelOf(cellText(c));
        const next = row.cells[ci + 1];
        if (label !== undefined && next && labelOf(cellText(next)) === undefined && !/\{\w+\}/.test(cellText(next))) {
          for (const p of next.blocks.slice(1)) setText(p, "");
          if (next.blocks[0]) setText(next.blocks[0], `{${label || "client"}}`); else next.blocks.push({ t: "p", runs: [{ text: `{${label || "client"}}`, size: c.blocks[0]?.runs[0]?.size ?? 11 }], align: "left", before: 0, after: 0, indent: 0 });
          found.add(label || "client");
        }
      }
      // A row with an aircraft name and a price is one option of a list.
      if (ri > 0) {
        const tags = new Set<string>();
        for (const c of row.cells) for (const p of c.blocks) {
          const t = paraText(p);
          if (/^\s*\d{1,2}\.?\s*$/.test(t)) { setText(p, "{number}"); tags.add("number"); continue; }
          const before = new Set(found);
          fillPara(p, found, { unlabelled: true });
          for (const f of found) if (!before.has(f)) tags.add(f);
          for (const m of paraText(p).matchAll(/\{(\w+)\}/g)) tags.add(m[1]);
        }
        if (tags.has("aircraft") && (tags.has("price") || tags.size >= 3)) {
          if (optionRow < 0) { optionRow = ri; row.repeat = "aircraft"; found.add("options list"); }
          else row.cells = [];
        }
      }
    }
    b.rows = b.rows.filter((r) => r.cells.length);
  }

  // Paragraphs: routing lines collapse into one {routing}; the greeting; labelled and unlabelled values.
  for (let i = 0; i < body.length; i++) {
    const b = body[i];
    if (b.t !== "p") continue;
    const text = paraText(b);
    if (ROUTE_LINE.test(text) && !/\{\w+\}/.test(text)) {
      setText(b, "{routing}");
      found.add("routing");
      while (body[i + 1]?.t === "p" && (ROUTE_LINE.test(paraText(body[i + 1] as LPara)) || (/\d{1,2}[:.]\d{2}/.test(paraText(body[i + 1] as LPara)) && !INLINE_TEST.test(paraText(body[i + 1] as LPara))))) body.splice(i + 1, 1);
      continue;
    }
    if (GREETING.test(text) && !text.includes("{")) { setText(b, "{greeting}"); found.add("greeting"); continue; }
    fillPara(b, found, { unlabelled: true });
  }
  for (const p of [...layout.header, ...layout.footer]) fillPara(p, found, { unlabelled: false });

  // The aircraft part: from the first aircraft to before the second (later copies of it are dropped);
  // or between {#aircraft} and {/aircraft} lines when the broker marked it.
  const isRepeatTable = (b: TBlock) => b.t === "tbl" && b.rows.some((r) => r.repeat);
  const aircraftish = (b: TBlock) => !isRepeatTable(b) && AIRCRAFT_TAG.test(blockText(b));
  let section: LEach | null = null;
  const open = body.findIndex((b) => b.t === "p" && paraText(b).trim() === "{#aircraft}");
  const close = body.findIndex((b) => b.t === "p" && paraText(b).trim() === "{/aircraft}");
  if (open >= 0 && close > open) {
    section = { t: "each", blocks: body.slice(open + 1, close) as LBlock[] };
    body.splice(open, close - open + 1, section);
  } else {
    const starts = body.map((b, i) => (!isRepeatTable(b) && /\{aircraft\}/.test(blockText(b)) ? i : -1)).filter((i) => i >= 0);
    const first = starts[0] ?? body.findIndex(aircraftish);
    if (first >= 0) {
      const back = (i: number) => (i > 0 && body[i - 1].t === "p" && /\{number\}/.test(blockText(body[i - 1])) ? i - 1 : i);
      const s1 = back(first);
      const s2 = starts[1] !== undefined ? back(starts[1]) : -1;
      let last = -1;
      body.forEach((b, i) => { if (i >= s1 && (aircraftish(b) || hasImage(b))) last = i; });
      const end = s2 > 0 ? s2 - 1 : last;
      // A picture right after the details belongs to the aircraft; stop at the next text that isn't the aircraft's.
      const second = s2 > 0 ? body[s2] : null;
      section = { t: "each", blocks: body.slice(s1, end + 1) as LBlock[], ...(second?.t === "p" && second.breakBefore ? { newPage: true } : {}) };
      const dropTo = s2 > 0 ? last : end;
      body.splice(s1, dropTo - s1 + 1, section);
    }
  }

  // Pictures: before the aircraft part, the logo (left blank); inside it, the photo places in order.
  const SLOTS = ["photo_exterior", "photo_cabin", "photo_cabin2", "photo_floorplan"];
  let photos = 0, logo = false;
  const sectionAt = section ? body.indexOf(section) : body.length;
  body.forEach((b, i) => {
    if (b === section) {
      for (const x of section!.blocks) for (const r of images(x)) {
        if (r.image && /\{photo_/.test(r.text)) continue;
        r.image!.slot = SLOTS[photos] ?? "none";
        if (photos < SLOTS.length) photos++;
      }
    } else for (const r of images(b)) { r.image!.slot = i < sectionAt ? "logo" : "none"; logo ||= i < sectionAt; }
  });
  for (const p of layout.header) for (const r of p.runs) if (r.image) { r.image.slot = "logo"; logo = true; }

  const order = ["reference", "date", "greeting", "route", "pax", "routing", "routing table", "options list", "number", "aircraft", "operator", "tail", "base", "yom", "yor", "seats", "wifi", "smoking", "pets", "price"];
  const fields = order.filter((f) => found.has(f));
  return {
    layout: { ...layout, body },
    found: { fields, photos, logo, section: !!section, clientBlanked: found.has("client") },
  };
}
