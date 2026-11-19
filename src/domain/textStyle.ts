/**
 * Bold, italic, strikethrough and underline in a plain-text message.
 *
 * Messengers only carry plain text, so styles are written the way WhatsApp reads them: *bold*, _italic_, ~strike~.
 * WhatsApp shows those as real formatting. Underline has no WhatsApp marker, so it is drawn with a combining low
 * line under each character, which every app shows. For apps that do not read the markers (WeChat, LINE, Telegram,
 * Signal…) `forOtherApps` turns bold and italic Latin letters and digits into their Unicode bold and italic forms;
 * Chinese characters have no such forms and are left plain.
 */

export type Mark = "bold" | "italic" | "strike";
export const MARKER: Record<Mark, string> = { bold: "*", italic: "_", strike: "~" };
const UNDERLINE = "̲";

export interface Edit { text: string; start: number; end: number }

/** Wrap (or unwrap, when it is already wrapped) the selection, line by line, keeping spaces outside the markers. */
export function toggleMark(text: string, start: number, end: number, mark: Mark): Edit {
  const m = MARKER[mark];
  if (start === end) {
    // Nothing selected: use the word under the cursor.
    const left = text.slice(0, start).search(/\S+$/);
    const right = text.slice(start).match(/^\S*/)?.[0].length ?? 0;
    const s = left < 0 ? start : left;
    if (s === start + right) return { text, start, end };
    return toggleMark(text, s, start + right, mark);
  }
  // Already wrapped just outside the selection: *word* with "word" selected.
  if (text.slice(start - 1, start) === m && text.slice(end, end + 1) === m) {
    return { text: text.slice(0, start - 1) + text.slice(start, end) + text.slice(end + 1), start: start - 1, end: end - 1 };
  }
  const sel = text.slice(start, end);
  const lines = sel.split("\n");
  const wrapped = lines.every((l) => !l.trim() || isWrapped(l.trim(), m));
  const next = lines.map((l) => {
    if (!l.trim()) return l;
    const lead = l.match(/^\s*/)![0];
    const trail = l.match(/\s*$/)![0];
    const core = l.trim();
    return lead + (wrapped ? core.slice(m.length, -m.length) : m + core + m) + trail;
  }).join("\n");
  return { text: text.slice(0, start) + next + text.slice(end), start, end: start + next.length };
}

const isWrapped = (s: string, m: string) => s.length > 2 * m.length && s.startsWith(m) && s.endsWith(m);

/** Underline the selection (or remove the underline when it is all underlined already). */
export function toggleUnderline(text: string, start: number, end: number): Edit {
  if (start === end) return { text, start, end };
  const sel = text.slice(start, end);
  const plain = sel.replaceAll(UNDERLINE, "");
  const cs = [...sel];
  const all = cs.some((c) => c.trim() && c !== UNDERLINE) && cs.every((c, i) => c === UNDERLINE || !c.trim() || cs[i + 1] === UNDERLINE);
  const next = all ? plain : [...plain].map((c) => (c === "\n" ? c : c + UNDERLINE)).join("");
  return { text: text.slice(0, start) + next + text.slice(end), start, end: start + next.length };
}

/** Remove every style from the selection, or from the whole text when nothing is selected. */
export function clearStyles(text: string, start: number, end: number): Edit {
  const [s, e] = start === end ? [0, text.length] : [start, end];
  const next = stripStyles(text.slice(s, e));
  return { text: text.slice(0, s) + next + text.slice(e), start: s, end: s + next.length };
}

export function stripStyles(text: string): string {
  return parseStyled(text).map((p) => p.text).join("").replaceAll(UNDERLINE, "");
}

export interface Span { text: string; bold?: boolean; italic?: boolean; strike?: boolean; underline?: boolean }

/** Split text into styled spans the way WhatsApp reads the markers (one line at a time, no space just inside a marker). */
export function parseStyled(text: string): Span[] {
  const out: Span[] = [];
  const re = /([*_~])(?=\S)([^\n]*?\S)\1(?![\p{L}\p{N}])/gu;
  const walk = (s: string, style: Omit<Span, "text">) => {
    let last = 0;
    for (const m of s.matchAll(re)) {
      const i = m.index ?? 0;
      // The opening marker must start a word (WhatsApp ignores a*b*c).
      if (i > 0 && /[\p{L}\p{N}]/u.test(s[i - 1])) continue;
      if (i > last) push(s.slice(last, i), style);
      const key = m[1] === "*" ? "bold" : m[1] === "_" ? "italic" : "strike";
      walk(m[2], { ...style, [key]: true });
      last = i + m[0].length;
    }
    if (last < s.length) push(s.slice(last), style);
  };
  const push = (s: string, style: Omit<Span, "text">) => {
    // Underlined characters become their own spans.
    const re2 = new RegExp(`((?:.${UNDERLINE})+)`, "gsu");
    let last = 0;
    for (const m of s.matchAll(re2)) {
      const i = m.index ?? 0;
      if (i > last) out.push({ text: s.slice(last, i), ...style });
      out.push({ text: m[1].replaceAll(UNDERLINE, ""), ...style, underline: true });
      last = i + m[0].length;
    }
    if (last < s.length) out.push({ text: s.slice(last), ...style });
  };
  walk(text, {});
  return out.filter((p) => p.text);
}

// Unicode Mathematical Sans-Serif Bold / Italic / Bold Italic.
const BASE = { bold: [0x1d5d4, 0x1d5ee, 0x1d7ec], italic: [0x1d608, 0x1d622, null], both: [0x1d63c, 0x1d656, null] } as const;
function styleChar(c: string, kind: keyof typeof BASE): string {
  const code = c.codePointAt(0)!;
  const [upper, lower, digit] = BASE[kind];
  if (code >= 65 && code <= 90) return String.fromCodePoint(upper + code - 65);
  if (code >= 97 && code <= 122) return String.fromCodePoint(lower + code - 97);
  if (code >= 48 && code <= 57 && digit) return String.fromCodePoint(digit + code - 48);
  return c;
}

/** The message for apps that do not read WhatsApp's markers: bold and italic become Unicode letters, strike and underline become combining lines. */
export function forOtherApps(text: string): string {
  return parseStyled(text).map((p) => {
    const kind = p.bold && p.italic ? "both" : p.bold ? "bold" : p.italic ? "italic" : null;
    let s = kind ? [...p.text].map((c) => styleChar(c, kind)).join("") : p.text;
    if (p.strike) s = [...s].map((c) => (c.trim() ? c + "̶" : c)).join("");
    if (p.underline) s = [...s].map((c) => (c === "\n" ? c : c + UNDERLINE)).join("");
    return s;
  }).join("");
}

/** The message for WhatsApp: the markers stay as they are. */
export const forWhatsApp = (text: string) => text;

/** Which form of the message each app needs. */
export const readsMarkers = (appId: string) => appId === "whatsapp";
