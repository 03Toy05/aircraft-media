import type { WifiStatus, YesNoStatus } from "./constants";

/**
 * Compact aircraft card (handoff section 8). Parsing is deterministic and AI-free.
 * Canonical field keys are stored once; only the visible labels vary by language.
 * English is implemented now; further languages are added to CARD_LABELS in phase 4.
 */
export const CARD_FIELDS = ["operator", "region", "aircraft", "tail", "base", "yom", "yor", "capacity", "wifi", "smoking", "pets", "cleaningFee", "notes"] as const;
export type CardField = (typeof CARD_FIELDS)[number];

export const CARD_LABELS: Record<string, Record<CardField, string[]>> = {
  en: {
    operator: ["operator", "operated by"],
    region: ["region", "operator region"],
    aircraft: ["aircraft type", "aircraft", "type", "model"],
    tail: ["tail number", "tail", "registration"],
    base: ["base"],
    yom: ["yom", "year of manufacture"],
    yor: ["yor", "year of refurbishment"],
    capacity: ["capacity", "seats", "pax"],
    wifi: ["wifi", "wi-fi", "wi fi"],
    smoking: ["smoking"],
    pets: ["pets", "pet", "pets allowed", "pet friendly"],
    cleaningFee: ["cleaning fee", "cleaning charge", "cleaning"],
    notes: ["notes", "note"],
  },
  // Traditional and Simplified Chinese. Both scripts are always recognised, whichever language the chat is set to.
  zh: {
    operator: ["營運商", "运营商", "運營商", "營運人", "运营人", "營運公司", "运营公司", "營運者"],
    region: ["地區", "地区", "區域", "区域"],
    aircraft: ["飛機型號", "飞机型号", "機型", "机型", "飛機", "飞机", "型號", "型号"],
    tail: ["機尾編號", "机尾编号", "機尾號", "机尾号", "註冊編號", "注册编号", "註冊號", "注册号", "尾號", "尾号", "機號", "机号"],
    base: ["基地"],
    yom: ["出廠年份", "出厂年份", "製造年份", "制造年份", "生產年份", "生产年份", "出廠", "出厂"],
    yor: ["翻新年份", "改裝年份", "改装年份", "翻新"],
    capacity: ["載客量", "载客量", "座位數", "座位数", "座位", "乘客數", "乘客数", "人數", "人数"],
    wifi: ["無線網絡", "无线网络", "無線上網", "无线上网"],
    smoking: ["吸煙", "吸烟", "抽煙", "抽烟"],
    pets: ["寵物", "宠物"],
    cleaningFee: ["清潔費", "清洁费"],
    notes: ["備註", "备注"],
  },
};

const isCjk = (t: string) => /[\u3400-\u9fff]/.test(t);

/** Every language's labels together: a card may be typed in any of them, whatever the chat language is. */
function allLabels(): Record<CardField, string[]> {
  const out = {} as Record<CardField, string[]>;
  for (const f of CARD_FIELDS) out[f] = Object.values(CARD_LABELS).flatMap((l) => l[f] ?? []);
  return out;
}

export const CARD_DISPLAY_LABELS: Record<string, Record<CardField, string>> = {
  en: {
    operator: "Operator",
    region: "Region",
    aircraft: "Aircraft",
    tail: "Tail number",
    base: "Base",
    yom: "YOM",
    yor: "YOR",
    capacity: "Capacity",
    wifi: "WIFI",
    smoking: "Smoking",
    pets: "Pets",
    cleaningFee: "Cleaning fee",
    notes: "Notes",
  },
};

export interface ParsedCard {
  operator?: string;
  /** The operator's region (a property of the operator, not of the aircraft). */
  region?: string;
  aircraft?: string;
  tail?: string;
  base?: { mode: "based" | "floating"; locations: string[] };
  yom?: number | null;
  yor?: number | null;
  capacity?: number | null;
  wifi?: WifiStatus;
  /** What follows Yes/No on the WIFI line: "WIFI: Yes, at USD 10/MB" -> "at USD 10/MB". */
  wifiDetail?: string;
  smoking?: YesNoStatus;
  pets?: YesNoStatus;
  cleaningFee?: string;
  notes?: string;
  /** Lines that were not recognised, kept so nothing is silently dropped. */
  unrecognised: string[];
  /** Field-level problems (e.g. YOM is not a number). The raw text is still kept in evidence. */
  problems: string[];
  /** Values read from unlabelled lines (e.g. "10 seats", "2025"). Shown to the owner as assumptions. */
  assumed: string[];
}

/** Unlabelled lines: "10 seats" -> capacity; a bare year -> YOM (then YOR); a hyphenated or N-number tail. */
function interpretLooseLine(line: string, out: ParsedCard): string | null {
  // A line starting with * is a note, for example: *subject to owner's approval
  const star = line.match(/^\*+\s*(.+)$/);
  if (star && !out.notes) {
    out.notes = star[1].trim();
    return `"${line}" read as Notes`;
  }
  // Value first, label after: "2013 YOM", "2020 YOR", "16 capacity".
  const rev = line.match(/^(\d{1,4})\s*(yom|yor|capacity)$/i);
  if (rev) {
    const n = Number(rev[1]);
    const f = rev[2].toLowerCase();
    if (f === "capacity" && out.capacity == null) { out.capacity = n; return `"${line}" read as Capacity ${n}`; }
    if (f !== "capacity" && n >= 1900 && n <= 2100 && out[f as "yom" | "yor"] == null) { out[f as "yom" | "yor"] = n; return `"${line}" read as ${f.toUpperCase()} ${n}`; }
  }
  const seats = line.match(/^(\d{1,3})\s*(seats?|seater|pax|passengers?|座位|座|人座|個座位|个座位)$/i);
  if (seats && out.capacity == null) {
    out.capacity = Number(seats[1]);
    return `"${line}" read as Capacity ${out.capacity}`;
  }
  if (/^(19[5-9]\d|20[0-4]\d)\s*年?$/.test(line)) {
    if (out.yom == null) {
      out.yom = Number(line.replace(/\D/g, ""));
      return `"${line}" read as YOM (year of manufacture)`;
    }
    if (out.yor == null) {
      out.yor = Number(line.replace(/\D/g, ""));
      return `"${line}" read as YOR (year of refurbishment)`;
    }
  }
  if (!out.tail && (/^[A-Z0-9]{1,2}-[A-Z0-9]{2,5}$/.test(line) || /^N\d{1,5}[A-Z]{0,2}$/.test(line))) {
    out.tail = line;
    return `"${line}" read as Tail number`;
  }
  return null;
}

/**
 * Dictated text arrives as one line: "Operator Advanced Aviation aircraft type G280 capacity 10".
 * Single-line messages that contain two or more field labels are split before each label.
 */
export function splitInlineLabels(text: string, lang = "en"): string {
  void lang;
  if (text.includes("\n")) return text;
  const labels = Object.values(allLabels()).flat().sort((x, y) => y.length - x.length);
  const esc = (l: string) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const latin = labels.filter((l) => !isCjk(l));
  const cjk = labels.filter(isCjk);
  const starts: number[] = [];
  for (const h of text.matchAll(new RegExp("(?:^|[\\s,.;，。；])(" + latin.map(esc).join("|") + ")(?=[\\s:：])", "gi"))) starts.push((h.index ?? 0) + (h[0].length - h[1].length));
  // Chinese labels need no spaces around them (dictation often has none); a label is followed by a space, a colon or a Latin letter/digit.
  for (const h of text.matchAll(new RegExp("(" + cjk.map(esc).join("|") + ")(?=[\\s:：A-Za-z0-9])", "g"))) starts.push(h.index ?? 0);
  starts.sort((x, y) => x - y);
  if (starts.length < 2) return text;
  const parts = starts.map((st, i) => text.slice(st, starts[i + 1] ?? text.length).replace(/[\s,.;，。；]+$/, ""));
  const lead = text.slice(0, starts[0]).replace(/[\s,.;，。；]+$/, "");
  return [lead, ...parts].filter(Boolean).join("\n");
}

/**
 * Turns a spoken or casually typed sentence into labelled form, so the label splitter can read it:
 *   "add new operator Vietstar Aviation bass in Ho Chi Minh aircraft Legacy 600 13 seats"
 *   -> "operator Vietstar Aviation base Ho Chi Minh aircraft Legacy 600 capacity 13"
 * Only single-line text is touched. "bass in" is how dictation often writes "base in".
 */
export function normalizeSpoken(text: string): string {
  if (/\r?\n/.test(text)) return text;
  let t = text.trim();
  t = t.replace(/^(?:please\s+|can you\s+|could you\s+)?(?:(?:add|create|register|make|set up|enter)\s+)?(?:(?:a|an|the)\s+)?(?:new\s+)?(?=(?:operator|aircraft|plane)\b)/i, "");
  t = t.replace(/\b(?:based|base|bass)\s+(?:in|at|is)\s+/gi, "base ");
  t = t.replace(/\b(?:built|manufactured|made)\s+in\s+(?=\d{4}\b)/gi, "yom ");
  t = t.replace(/\b(\d{1,3})[- ]?(?:seats?|seater|passengers?|pax)\b/gi, "capacity $1");
  // Chinese: "新增營運商 X 基地在 Y 機型 Z 13座" -> labelled. "是/係/在" after a label is dropped; "2015年出廠" -> yom; "13座" -> capacity.
  t = t.replace(/^(?:請|请)?(?:幫我|帮我)?(?:新增|加入|添加|增加|登記|登记|建立|創建|创建|新建)(?:一個|一个|個|个)?(?:新)?(?=營運商|运营商|運營商|飛機|飞机)/, "");
  t = t.replace(/^新(?=營運商|运营商|運營商|飛機|飞机)/, "");
  t = t.replace(/(基地|營運商|运营商|運營商|機型|机型|機尾號|机尾号|地區|地区)\s*(?:是|係|為|为|叫|喺|在|位於|位于)\s*/g, "$1 ");
  t = t.replace(/(\d{4})\s*年\s*(?:出廠|出厂|製造|制造|生產|生产)/g, "yom $1");
  t = t.replace(/(\d{4})\s*年\s*(?:翻新|改裝|改装)/g, "yor $1");
  t = t.replace(/(\d{1,3})\s*(?:個座位|个座位|座位|人座|座|位乘客|名乘客)/g, "capacity $1");
  return t;
}

/** "Yes, at USD 10/MB", "有，每MB 10美元", "無", "待確認" -> status and the rest as detail. */
function parseWifiValue(value: string): { status: WifiStatus; detail: string } | null {
  const en = value.match(/^(yes|no|tbc|unknown)\b[\s,;:\-–—]*(.*)$/i);
  if (en) return { status: en[1].toLowerCase() as WifiStatus, detail: en[2].trim() };
  // How brochures say it: "complimentary", "free", "available" (yes, kept as the detail); "on request" (TBC); "none".
  if (/^(not available|unavailable|none|n\/a)\b/i.test(value)) return { status: "no", detail: "" };
  if (/^on request\b/i.test(value)) return { status: "tbc", detail: value.trim() };
  if (/^(complimentary|free|included|available|on ?board|equipped|fitted)\b/i.test(value)) return { status: "yes", detail: value.trim() };
  const zh = value.match(/^(待確認|待确认|未確認|未确认|待定|不明|未知|已包含|包含|不提供|沒有|没有|提供|有|是|無|无|冇|否)[\s,，;；:：\-–—]*(.*)$/);
  if (!zh) return null;
  const w = zh[1];
  const status: WifiStatus = /^(待|未確|未确)/.test(w) ? "tbc" : /^(不明|未知)$/.test(w) ? "unknown" : /^(不提供|沒有|没有|無|无|冇|否)$/.test(w) ? "no" : "yes";
  return { status, detail: zh[2].trim() };
}

/** "Yes", "No", "Yes, cleaning fee USD 500", "可以", "禁止" -> yes / no, and anything after as detail. */
function parseYesNoValue(value: string): { status: YesNoStatus; detail: string } | null {
  const en = value.match(/^(yes|allowed|ok|no|not allowed|unknown)\b[\s,;:\-–—]*(.*)$/i);
  if (en) {
    const w = en[1].toLowerCase();
    return { status: w === "unknown" ? "unknown" : /^(no|not allowed)$/.test(w) ? "no" : "yes", detail: en[2].trim() };
  }
  const zh = value.match(/^(不可以|不可|不允許|不允许|不准|禁止|不能|不行|否|無|无|冇|唔得|可以|允許|允许|准許|准许|有|是|得|不明|未知)[\s,，;；:：\-–—]*(.*)$/);
  if (!zh) return null;
  const w = zh[1];
  const status: YesNoStatus = /^(不明|未知)$/.test(w) ? "unknown" : /^(不|禁止|否|無|无|冇|唔得)/.test(w) ? "no" : "yes";
  return { status, detail: zh[2].trim() };
}

/** "cleaning fee USD 500" inside a Smoking or Pets line: the fee part. */
const feeIn = (detail: string) => detail.match(/(?:cleaning\s*(?:fee|charge)?|清潔費|清洁费)\s*[:：]?\s*(.+)$/i)?.[1].trim() ?? null;

export function parseAircraftCard(text: string, lang = "en"): ParsedCard {
  text = splitInlineLabels(normalizeSpoken(text), lang);
  const labels = allLabels();
  const lookup = new Map<string, CardField>();
  for (const f of CARD_FIELDS) for (const l of labels[f]) lookup.set(l.toLowerCase(), f);

  const out: ParsedCard = { unrecognised: [], problems: [], assumed: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m = line.match(/^([^:：]+)[:：]\s*(.*)$/);
    let field = m ? lookup.get(m[1].trim().toLowerCase()) : undefined;
    if (!field) {
      // "YOM 2025" / "Capacity 10": a known label followed by its value, no colon.
      const lower = line.toLowerCase();
      const label = [...lookup.keys()].sort((a, b) => b.length - a.length).find((l) => (isCjk(l) ? lower.startsWith(l) : lower.startsWith(l + " ")) && line.slice(l.length).trim() !== "");
      if (label) { field = lookup.get(label); m = [line, label, line.slice(label.length).trim()] as unknown as RegExpMatchArray; }
    }
    if (!m || !field) {
      // Unlabelled line: only unambiguous shapes are interpreted, and each is reported as an assumption.
      const loose = interpretLooseLine(line, out);
      if (loose) out.assumed.push(loose);
      else out.unrecognised.push(line);
      continue;
    }
    const value = m[2].trim();
    if (value === "") continue; // omitted is not "No" and not "0": leave the field unset
    switch (field) {
      case "operator":
      case "region":
      case "aircraft":
      case "tail":
      case "notes":
        out[field] = value;
        break;
      case "base": {
        const parts = value.split(/\s*[\/,;，、；]\s*/).map((p) => p.trim()).filter(Boolean);
        const floating = (p: string) => p.toLowerCase() === "floating" || /^(浮動|浮动|不固定|無固定基地|无固定基地)$/.test(p);
        if (parts.length === 1 && floating(parts[0])) out.base = { mode: "floating", locations: [] };
        else if (parts.some(floating)) out.problems.push("Base cannot combine Floating with locations");
        else out.base = { mode: "based", locations: parts };
        break;
      }
      case "yom":
      case "yor":
      case "capacity": {
        if (/^\d+$/.test(value)) out[field] = Number(value);
        else out.problems.push(`${CARD_DISPLAY_LABELS.en[field]} is not a number: ${value}`);
        break;
      }
      case "wifi": {
        const w = parseWifiValue(value);
        if (w) {
          out.wifi = w.status;
          if (w.detail) out.wifiDetail = w.detail;
        } else out.problems.push(`WIFI must start with Yes, No, TBC or Unknown: ${value}`);
        break;
      }
      case "smoking":
      case "pets": {
        const v = parseYesNoValue(value);
        if (v) {
          out[field] = v.status;
          const fee = feeIn(v.detail);
          if (fee && !out.cleaningFee) out.cleaningFee = fee;
        } else out.problems.push(`${CARD_DISPLAY_LABELS.en[field]} must be Yes or No: ${value}`);
        break;
      }
      case "cleaningFee":
        out.cleaningFee = value;
        break;
    }
  }
  return out;
}

/** Render the card in the approved field order. Unrecorded values stay blank; only WIFI shows Unknown. */
export function formatAircraftCard(
  card: {
    operator: string | null;
    aircraft: string;
    tailNumber: string | null;
    base: string | null;
    yom: number | null;
    yor: number | null;
    capacity: number | null;
    wifi: WifiStatus;
    wifiDetail?: string | null;
    smoking?: YesNoStatus;
    pets?: YesNoStatus;
    cleaningFee?: string | null;
    notes: string | null;
  },
  lang = "en",
): string {
  const L = CARD_DISPLAY_LABELS[lang] ?? CARD_DISPLAY_LABELS.en;
  const wifi = { yes: "Yes", no: "No", tbc: "TBC", unknown: "Unknown" }[card.wifi];
  return [
    `${L.operator}: ${card.operator ?? ""}`,
    `${L.aircraft}: ${card.aircraft}`,
    `${L.tail}: ${card.tailNumber ?? ""}`,
    `${L.base}: ${card.base ?? ""}`,
    `${L.yom}: ${card.yom ?? ""}`,
    `${L.yor}: ${card.yor ?? ""}`,
    `${L.capacity}: ${card.capacity ?? ""}`,
    `${L.wifi}: ${wifi}${card.wifiDetail && card.wifi !== "unknown" ? `, ${card.wifiDetail}` : ""}`,
    // Smoking, pets and the cleaning fee only once recorded, so older cards read as before.
    ...(card.smoking && card.smoking !== "unknown" ? [`${L.smoking}: ${card.smoking === "yes" ? "Yes" : "No"}`] : []),
    ...(card.pets && card.pets !== "unknown" ? [`${L.pets}: ${card.pets === "yes" ? "Yes" : "No"}`] : []),
    ...(card.cleaningFee ? [`${L.cleaningFee}: ${card.cleaningFee}`] : []),
    `${L.notes}: ${card.notes ?? ""}`,
  ].join("\n");
}
