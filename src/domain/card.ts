import type { WifiStatus } from "./constants";

/**
 * Compact aircraft card (handoff section 8). Parsing is deterministic and AI-free.
 * Canonical field keys are stored once; only the visible labels vary by language.
 * English is implemented now; further languages are added to CARD_LABELS in phase 4.
 */
export const CARD_FIELDS = ["operator", "region", "aircraft", "tail", "base", "yom", "yor", "capacity", "wifi", "notes"] as const;
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
    notes: ["notes", "note"],
  },
};

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
  const seats = line.match(/^(\d{1,3})\s*(seats?|seater|pax|passengers?)$/i);
  if (seats && out.capacity == null) {
    out.capacity = Number(seats[1]);
    return `"${line}" read as Capacity ${out.capacity}`;
  }
  if (/^(19[5-9]\d|20[0-4]\d)$/.test(line)) {
    if (out.yom == null) {
      out.yom = Number(line);
      return `"${line}" read as YOM (year of manufacture)`;
    }
    if (out.yor == null) {
      out.yor = Number(line);
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
  if (text.includes("\n")) return text;
  const labels = Object.values(CARD_LABELS[lang] ?? CARD_LABELS.en).flat().sort((x, y) => y.length - x.length);
  const escaped = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp("(?:^|[\\s,.;])(" + escaped.join("|") + ")(?=[\\s:：])", "gi");
  const hits = [...text.matchAll(re)];
  if (hits.length < 2) return text;
  const starts = hits.map((h) => (h.index ?? 0) + (h[0].length - h[1].length));
  const parts = starts.map((st, i) => text.slice(st, starts[i + 1] ?? text.length).replace(/[\s,.;]+$/, ""));
  const lead = text.slice(0, starts[0]).replace(/[\s,.;]+$/, "");
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
  return t;
}

export function parseAircraftCard(text: string, lang = "en"): ParsedCard {
  text = splitInlineLabels(normalizeSpoken(text), lang);
  const labels = CARD_LABELS[lang] ?? CARD_LABELS.en;
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
      const label = [...lookup.keys()].sort((a, b) => b.length - a.length).find((l) => lower.startsWith(l + " ") && line.slice(l.length).trim() !== "");
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
        const parts = value.split(/\s*[\/,;]\s*/).map((p) => p.trim()).filter(Boolean);
        if (parts.length === 1 && parts[0].toLowerCase() === "floating") out.base = { mode: "floating", locations: [] };
        else if (parts.some((p) => p.toLowerCase() === "floating")) out.problems.push("Base cannot combine Floating with locations");
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
        const w = value.match(/^(yes|no|tbc|unknown)\b[\s,;:\-–—]*(.*)$/i);
        if (w) {
          out.wifi = w[1].toLowerCase() as WifiStatus;
          if (w[2].trim()) out.wifiDetail = w[2].trim();
        } else out.problems.push(`WIFI must start with Yes, No, TBC or Unknown: ${value}`);
        break;
      }
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
    `${L.notes}: ${card.notes ?? ""}`,
  ].join("\n");
}
