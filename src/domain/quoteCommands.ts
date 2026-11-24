import { normalizeKey } from "./constants";
import type { QuoteLanguage } from "./quote";

/**
 * Spoken or typed commands on the Quote page ("add the Jet Aviation G650ER, Chinese, price 85,000, copy").
 * Deterministic: each clause is matched against a short list of patterns and your own aircraft. Anything it does not
 * understand is handed back so the caller can pass it to Toy.
 */

export interface CommandAircraft { id: string; type: string; tail: string | null; operator: string | null; /** The operator's other names ("VJ"). */ aliases?: string[] }
export type Toggle = "operator" | "tail" | "base" | "notes" | "greeting" | "closing";

export type QuoteCommand =
  | { do: "add"; ids: string[]; what: string }
  | { do: "remove"; ids: string[]; what: string }
  | { do: "clear" }
  | { do: "findOperator"; text: string }
  | { do: "lang"; lang: QuoteLanguage }
  | { do: "price"; id: string | null; value: string }
  | { do: "extra"; id: string | null; value: string }
  | { do: "show"; what: Toggle; on: boolean }
  | { do: "copy" }
  | { do: "share" }
  | { do: "send"; app: string };

const LANGS: [RegExp, QuoteLanguage][] = [
  [/simplified|mandarin|簡體|简体|普通話|普通话/i, "zh-Hans"],
  [/chinese|traditional|cantonese|繁體|繁体|中文|廣東話|广东话/i, "zh-Hant"],
  [/english|英文|英語|英语/i, "en"],
  [/japanese|日文|日語/i, "ja"], [/korean|韓文|韩文/i, "ko"], [/vietnamese|越南/i, "vi"], [/thai|泰文/i, "th"],
  [/indonesian|bahasa|印尼/i, "id"], [/french|法文/i, "fr"], [/german|德文/i, "de"], [/russian|俄文/i, "ru"], [/arabic|阿拉伯/i, "ar"],
];
const APPS: [RegExp, string][] = [
  [/whats ?app/i, "whatsapp"], [/we ?chat|微信/i, "wechat"], [/telegram/i, "telegram"], [/\bline\b/i, "line"],
  [/signal/i, "signal"], [/viber/i, "viber"], [/kakao/i, "kakaotalk"], [/imessage|\bsms\b|text message/i, "imessage"], [/e-?mail|電郵|电邮|郵件|邮件/i, "email"],
];
const TOGGLES: [RegExp, Toggle][] = [
  [/tail|registration|機尾|机尾/i, "tail"], [/\bbase\b|基地/i, "base"], [/notes?|備註|备注/i, "notes"],
  [/opening|greeting|開頭|开头|問候|问候/i, "greeting"], [/closing|ending|結尾|结尾/i, "closing"], [/operator|營運商|运营商/i, "operator"],
];

/** Aircraft whose tail, type or operator contains every word said ("Jet Aviation G650ER", "B-KXX"). */
export function matchAircraft(list: CommandAircraft[], text: string): CommandAircraft[] {
  const words = text
    .replace(/['’]s\b/gi, "")
    .replace(/([A-Za-z0-9])([㐀-鿿])/g, "$1 $2").replace(/([㐀-鿿])([A-Za-z0-9])/g, "$1 $2")
    .replace(/(?:飛機|飞机|的|嘅|架)/g, " ")
    .split(/\s+/).map(normalizeKey).filter((w) => w.length >= 2);
  const STOP = ["the", "an", "of", "aircraft", "plane", "jet", "one", "for", "from", "by"];
  const find = (ws: string[]) => ws.length ? list.filter((a) => {
    const hay = normalizeKey(`${a.tail ?? ""} ${a.type} ${a.operator ?? ""} ${(a.aliases ?? []).join(" ")}`);
    return ws.every((w) => hay.includes(w));
  }) : [];
  // Every word first ("Jet Aviation" is a name); without the filler words only when that finds nothing ("the G280 jet").
  const all = find(words);
  return all.length ? all : find(words.filter((w) => !STOP.includes(w)));
}

/** Split a sentence into clauses: "add X, Chinese, then copy". A comma inside a number ("85,000") is kept. */
export function clauses(text: string): string[] {
  return text
    .split(/(?:[.;!?。；！？]\s*|\s+then\s+|\s+and then\s+|然後|然后|，|、|,(?!\d))/i)
    .map((c) => c.trim())
    .filter(Boolean);
}

export function parseQuoteCommands(text: string, aircraft: CommandAircraft[], chosenIds: string[]): { commands: QuoteCommand[]; unknown: string[] } {
  const commands: QuoteCommand[] = [];
  const unknown: string[] = [];
  const chosen = aircraft.filter((a) => chosenIds.includes(a.id));
  /** The aircraft a price or extra line is for: named in the clause, or the last one chosen. */
  const target = (rest: string): { id: string | null; value: string } => {
    const m = rest.match(/^(?:for|on)\s+(.+?)\s+(?:is|=|:|at)\s+(.+)$/i);
    if (m) {
      const hit = matchAircraft(chosen.length ? chosen : aircraft, m[1]);
      if (hit.length === 1) return { id: hit[0].id, value: m[2].trim() };
    }
    const last = [...chosenIds, ...commands.filter((c): c is Extract<QuoteCommand, { do: "add" }> => c.do === "add").flatMap((c) => c.ids)].at(-1) ?? null;
    return { id: last, value: rest.replace(/^(?:is|=|:|at)\s+/i, "").trim() };
  };

  for (const raw of clauses(text)) {
    const c = raw.replace(/^(?:please|ok(?:ay)?|toy|chocks)[\s,]+/i, "").replace(/[\s,]+please$/i, "").trim();
    let m: RegExpMatchArray | null;
    if (/^(?:copy|copy (?:the |it|that|message)|複製|复制)/i.test(c)) { commands.push({ do: "copy" }); continue; }
    if ((m = c.match(/^(?:send|share)(?:\s+it|\s+this|\s+the message)?(?:\s+(?:by|on|to|via|through|with))?\s+(.+)$/i)) && APPS.some(([re]) => re.test(m![1]))) {
      commands.push({ do: "send", app: APPS.find(([re]) => re.test(m![1]))![1] });
      continue;
    }
    if (/^(?:share|send)(?:\s+(?:it|this|everything|all|the photos|photos|with photos))*$|^(?:分享|傳送|发送|發送)$/i.test(c)) { commands.push({ do: "share" }); continue; }
    if (/^(?:clear|start over|remove all|reset aircraft|清除|全部移除)/i.test(c)) { commands.push({ do: "clear" }); continue; }
    if ((m = c.match(/^(?:in\s+|language\s+|switch to\s+|change (?:the )?language to\s+|用|轉|转|轉做|转做|轉成|转成)?(.+?)(?:\s+language)?$/i)) && LANGS.some(([re]) => re.test(m![1])) && m[1].split(/\s+/).length <= 3) {
      commands.push({ do: "lang", lang: LANGS.find(([re]) => re.test(m![1]))![1] });
      continue;
    }
    if ((m = c.match(/^(?:the\s+)?(?:price|價錢|价钱|價格|价格|報價|报价)\s*(?:is|:|：|=|為|为|係)?\s*(.+)$/i))) {
      const t = target(m[1]);
      commands.push({ do: "price", id: t.id, value: t.value });
      continue;
    }
    if ((m = c.match(/^(?:add (?:an? )?(?:extra )?line|extra line|add (?:a )?note|附加|加一句)\s*(?:saying|:|：)?\s*(.+)$/i))) {
      const t = target(m[1]);
      commands.push({ do: "extra", id: t.id, value: t.value });
      continue;
    }
    if ((m = c.match(/^(show|hide|include|remove|no|without|turn (?:on|off)|顯示|显示|隱藏|隐藏|不要|唔要)\s+(?:the\s+)?(.+?)(?:\s+(on|off))?$/i)) && TOGGLES.some(([re]) => re.test(m![2])) && m[2].split(/\s+/).length <= 3) {
      const off = /^(hide|remove|no|without|turn off|隱藏|隐藏|不要|唔要)/i.test(m[1]) || m[3] === "off";
      commands.push({ do: "show", what: TOGGLES.find(([re]) => re.test(m![2]))![1], on: !off });
      continue;
    }
    if ((m = c.match(/^(?:remove|take out|delete|drop|untick|移除|刪除|删除|拿走)\s*(.+)$/i))) {
      const hit = matchAircraft(chosen, m[1]);
      if (hit.length) { commands.push({ do: "remove", ids: hit.map((a) => a.id), what: m[1] }); continue; }
    }
    if ((m = c.match(/^(?:find|show|search(?: for)?|filter|look up|operator|搵|找|搜尋|搜索)\s+(?:operator\s+)?(.+)$/i))) {
      commands.push({ do: "findOperator", text: m[1].trim() });
      continue;
    }
    const what = c.replace(/^(?:add|choose|pick|select|tick|include|use|quote|加|加入|選|选|揀|用)\s*/i, "");
    const hit = matchAircraft(aircraft, what);
    if (hit.length && hit.length <= 6) { commands.push({ do: "add", ids: hit.map((a) => a.id), what }); continue; }
    unknown.push(raw);
  }
  return { commands, unknown };
}
