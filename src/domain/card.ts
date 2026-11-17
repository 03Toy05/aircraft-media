import type { WifiStatus } from "./constants";

/**
 * Compact aircraft card (handoff section 8). Parsing is deterministic and AI-free.
 * Canonical field keys are stored once; only the visible labels vary by language.
 * English is implemented now; further languages are added to CARD_LABELS in phase 4.
 */
export const CARD_FIELDS = ["operator", "aircraft", "tail", "base", "yom", "yor", "capacity", "wifi", "notes"] as const;
export type CardField = (typeof CARD_FIELDS)[number];

export const CARD_LABELS: Record<string, Record<CardField, string[]>> = {
  en: {
    operator: ["operator"],
    aircraft: ["aircraft"],
    tail: ["tail number", "tail", "registration"],
    base: ["base"],
    yom: ["yom"],
    yor: ["yor"],
    capacity: ["capacity"],
    wifi: ["wifi", "wi-fi", "wi fi"],
    notes: ["notes", "note"],
  },
};

export const CARD_DISPLAY_LABELS: Record<string, Record<CardField, string>> = {
  en: {
    operator: "Operator",
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
  aircraft?: string;
  tail?: string;
  base?: { mode: "based" | "floating"; locations: string[] };
  yom?: number | null;
  yor?: number | null;
  capacity?: number | null;
  wifi?: WifiStatus;
  notes?: string;
  /** Lines that were not recognised, kept so nothing is silently dropped. */
  unrecognised: string[];
  /** Field-level problems (e.g. YOM is not a number). The raw text is still kept in evidence. */
  problems: string[];
}

export function parseAircraftCard(text: string, lang = "en"): ParsedCard {
  const labels = CARD_LABELS[lang] ?? CARD_LABELS.en;
  const lookup = new Map<string, CardField>();
  for (const f of CARD_FIELDS) for (const l of labels[f]) lookup.set(l.toLowerCase(), f);

  const out: ParsedCard = { unrecognised: [], problems: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([^:：]+)[:：]\s*(.*)$/);
    const field = m ? lookup.get(m[1].trim().toLowerCase()) : undefined;
    if (!m || !field) {
      out.unrecognised.push(line);
      continue;
    }
    const value = m[2].trim();
    if (value === "") continue; // omitted is not "No" and not "0": leave the field unset
    switch (field) {
      case "operator":
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
        const v = value.toLowerCase();
        if (v === "yes" || v === "no" || v === "tbc" || v === "unknown") out.wifi = v;
        else out.problems.push(`WIFI must be Yes, No, TBC or Unknown: ${value}`);
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
    `${L.wifi}: ${wifi}`,
    `${L.notes}: ${card.notes ?? ""}`,
  ].join("\n");
}
