import type { Db } from "../db/client";
import { getCatalogue } from "./catalogue";
import { normalizeKey } from "./constants";
import { mentions } from "./chocksLookup";

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

/** Aircraft whose tail, type or operator contains every word of the request. */
export async function findAircraftsForShare(db: Db, tenantId: string, text: string) {
  const rows = await getCatalogue(db, tenantId);
  // Chinese filler ("的", "飛機", "一架") is dropped and Latin names are separated from Chinese characters next to them.
  const cleaned = text
    .replace(/['’]s\b/gi, "")
    .replace(/(?:私人)?(?:飛機|飞机|噴射機|喷射机)|[的嘅架部個个]/g, " ")
    .replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, "$1 $2")
    .replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, "$1 $2");
  const words = cleaned.split(/\s+/).map(normalizeKey).filter((w) => w.length >= 2);
  const STOP = ["the", "of", "for", "aircraft", "plane", "jet"];
  const find = (ws: string[]) => ws.length === 0 ? [] : rows.filter((r) => {
    const hay = normalizeKey(`${r.tail ?? ""} ${r.aircraft} ${r.operator ?? ""}`);
    // A word matches when it is in the name, or is one typo away from it ("CapacJet" finds CapaJet).
    return ws.every((w) => hay.includes(w) || mentions(hay, w));
  });
  // Every word first ("Jet Aviation" is a name); without filler words only when that finds nothing ("the G280 jet").
  const exact = find(words);
  return (exact.length ? exact : find(words.filter((w) => !STOP.includes(w))))
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
  const m = message.trim().replace(/[.!?。！？]+$/, "");
  if (/\r?\n/.test(m)) return null;
  // Chinese: "給我 CapacJet 的 G550 和 Tag 的 G650ER 的模板和相片", "幫我整 CapaJet G550 嘅報價"
  if (/報價|报价|模板|範本|范本|訊息|信息|消息|資料卡|资料卡/.test(m) && /[\u3400-\u9fff]/.test(m)) {
    const lead = m.replace(/^(?:請|请)?(?:幫我|帮我|給我|给我|俾我|我要|我想要|我需要|我想|傳給我|传给我)?\s*(?:生成|整|做|準備|准备|預備|预备)?\s*(?:一份|一個|一个)?/, "");
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
    const what = body.split(/\s*(?:,|&|\band\b|\bplus\b|\bwith\b)\s*/i).map((x) => x.trim().replace(/^(?:the|my|a|an)\s+/i, "").trim()).filter(Boolean);
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
