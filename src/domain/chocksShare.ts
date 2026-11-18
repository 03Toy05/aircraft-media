import type { Db } from "../db/client";
import { getCatalogue } from "./catalogue";
import { normalizeKey } from "./constants";
import { mentions } from "./chocksLookup";

/** "send the G280 photos to Mr Chan" -> { what: "G280", who: "Mr Chan" }. Single-line messages only. */
export function parseShareRequest(message: string): { what: string; who: string } | null {
  const m = message.trim().match(/^(?:please\s+|can you\s+|could you\s+)?(?:send|share|forward|message|whatsapp)\s+(?:the\s+|my\s+)?(.+?)\s+(?:to|with)\s+(.+?)[.!?]*$/i);
  if (!m) return null;
  const what = m[1].replace(/\b(photos?|pictures?|pics?|images?|card|details|info(?:rmation)?)\s*$/i, "").replace(/\b(and|&)\s*$/i, "").trim();
  const who = m[2].trim();
  return what && who ? { what, who } : null;
}

/** Aircraft whose tail, type or operator contains every word of the request. */
export async function findAircraftsForShare(db: Db, tenantId: string, text: string) {
  const rows = await getCatalogue(db, tenantId);
  const words = text.replace(/['’]s\b/gi, "").split(/\s+/).map(normalizeKey).filter((w) => w.length >= 2 && !["the", "of", "for", "aircraft", "plane", "jet"].includes(w));
  if (words.length === 0) return [];
  return rows
    .filter((r) => {
      const hay = normalizeKey(`${r.tail ?? ""} ${r.aircraft} ${r.operator ?? ""}`);
      // A word matches when it is in the name, or is one typo away from it ("CapacJet" finds CapaJet).
      return words.every((w) => hay.includes(w) || mentions(hay, w));
    })
    .map((r) => ({ id: r.aircraftId, label: [r.operator, r.aircraft, r.tail].filter(Boolean).join(" · ") }));
}

const QUOTE_WORD = /\b(?:quote|quotation|quoting)s?\b/i;
const TRAILING_WORDS = /\s*\b(?:(?:quote|quotation|template|templates|message|text|photos?|pictures?|pics?|images?)\b\s*(?:,|&|\band\b|\bplus\b|\bwith\b)?\s*)+$/i;

/**
 * "make a quote for the G650 and B-KXX" -> ["G650", "B-KXX"]; plain "quote" -> [].
 * "give me CapaJet's G550 and Tag's G650ER template and photos" -> ["CapaJet's G550", "Tag's G650ER"].
 * Single-line messages only.
 */
export function parseQuoteRequest(message: string): { what: string[] } | null {
  const m = message.trim().replace(/[.!?]+$/, "");
  if (/\r?\n/.test(m)) return null;
  const split = (t: string) => t.split(/\s*(?:,|&|\band\b|\bplus\b)\s*/i).map((x) => x.replace(/^(?:the|my)\s+/i, "").trim()).filter(Boolean);
  if (QUOTE_WORD.test(m)) {
    const after = m.replace(/^.*?\b(?:quote|quotation|quoting)s?\b\s*(?:message|text|template)?\s*(?:for|of|on|with)?\s*/i, "").trim();
    return { what: after ? split(after) : [] };
  }
  // No "quote" word: "give me X and Y template and photos" (needs a request verb and a template/message word).
  if (!/\b(?:template|templates|message)\b/i.test(m)) return null;
  const stripped = m.replace(/^(?:please\s+|can you\s+|could you\s+)?(?:give|get|send|prepare|make|show|pull up|i need|i want|need|want)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?/i, "");
  if (stripped === m) return null;
  const subject = stripped.replace(TRAILING_WORDS, "").trim();
  if (!subject || /\s(?:to|for)\s/i.test(` ${subject} `) && /\bto\s+\S/i.test(subject)) return null; // "...to Mr Chan" is a send request
  return { what: split(subject) };
}
