/**
 * The Fleet search's matching, shared by the page and the suggestions shown while typing (so both agree).
 * Every word typed must be found: inside the text ("lux" finds Luxaviation, "650" finds Challenger 650), or, for words
 * of 5 letters or more, one typo away from the start of a word ("phenix" finds Phenix Jet, "luxaviaton" finds Luxaviation).
 */

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const squash = (s: string) => norm(s).replace(/[^a-z0-9㐀-鿿]/g, "");

function within1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function searchWords(q: string): string[] {
  return norm(q).split(/[\s,/·]+/).map(squash).filter(Boolean);
}

export function matchesWords(hay: string, words: string[]): boolean {
  if (!words.length) return true;
  const whole = squash(hay);
  const tokens = norm(hay).split(/[^a-z0-9㐀-鿿]+/).filter(Boolean);
  return words.every((w) =>
    whole.includes(w) ||
    (w.length >= 5 && tokens.some((t) => within1(w, t.slice(0, w.length)) || within1(w, t) || within1(w, t.slice(0, w.length + 1)))));
}
