import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { aircraftTypes, organisations } from "../db/schema";
import { fleetLink, looksLikeFleetRequest, parseFleetQuery, runFleetQuery, sortAircraft } from "./fleetQuery";
import { getCatalogue } from "./catalogue";
import { AIRCRAFT_CATEGORIES, AIRCRAFT_CATEGORY_LABEL, normalizeKey, normalizeRegistration } from "./constants";
import { isChinese, plural, tr, trUnderstood, trWifi, type ChatLang } from "./chocksText";
import { getAircraftCard, orgAliasesFor } from "./directory";
import { getLineup } from "./media";
import { buildQuote } from "./quote";
import { getQuoteTemplates } from "./quoteTemplates";

/** "Can you show me what aircraft Capa Jet has?" / "what does B-KXX have" / "list Metrojet". Single-line questions only. */
export function isLookupQuestion(message: string): boolean {
  const m = message.trim();
  if (!m || /\r?\n/.test(m)) return false;
  return (
    /[?？]\s*$/.test(m) ||
    /^(?:please\s+|can you\s+|could you\s+)?(?:show|list|tell me|what|which|how many|give me|find|look up|sort|order|filter|arrange|rank|group|do (?:i|we) have)\b/i.test(m) ||
    /^(?:請|请)?(?:幫我|帮我)?(?:顯示|显示|列出|查詢|查询|查|睇|看|搜尋|搜索|排序|篩選|筛选|整理|給我看|给我看|有咩|有什麼|有什么|哪些|邊啲|边啲)/.test(m) ||
    /(有咩|有什麼|有什么|有哪些|有幾架|有几架|幾多架|几多架|多少架)/.test(m) ||
    /(?:相片|照片|圖片|图片)[。！？?!]*$/.test(m)
  );
}

function distance(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Does the (spaces and punctuation removed) sentence contain this name, allowing one typo in longer names? */
export function mentions(sentence: string, name: string) {
  if (name.length < 3) return false;
  if (sentence.includes(name)) return true;
  if (name.length < 6) return false;
  for (const len of [name.length - 1, name.length, name.length + 1])
    for (let i = 0; i + len <= sentence.length; i++) if (distance(sentence.slice(i, i + len), name) <= 1) return true;
  return false;
}

const wordsFor = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface LookupAnswer {
  say: string[];
  /** Thumbnails to show in the chat when the question asked for photos. */
  photos: { id: string; label: string }[];
  link?: { href: string; label: string };
}

const WANTS_PHOTOS = /\b(photos?|pictures?|pics?|images?)\b|相片|照片|圖片|图片/i;

/** Answers a lookup question from the directory. Returns null when nothing in the message matches anything you have. */
export async function answerLookup(db: Db, tenantId: string, message: string, lang?: ChatLang): Promise<LookupAnswer | null> {
  const sentence = normalizeKey(message);
  const rows = await getCatalogue(db, tenantId);
  const wantsPhotos = WANTS_PHOTOS.test(message);

  const orgs = await db.select().from(organisations).where(eq(organisations.tenantId, tenantId));
  const aliases = await orgAliasesFor(db, tenantId);
  const hit = orgs.filter((o) => o.active && [o.canonicalName, ...aliases.filter((a) => a.organisationId === o.id).map((a) => a.alias)].some((n) => mentions(sentence, normalizeKey(n))));

  const lines: string[] = [];
  const photos: LookupAnswer["photos"] = [];
  const describe = async (r: (typeof rows)[number], maxPhotos: number) => {
    const card = await getAircraftCard(db, r.aircraftId);
    const lineup = await getLineup(db, { aircraftId: r.aircraftId, aircraftTypeId: r.aircraftTypeId });
    if (wantsPhotos) for (const l of lineup.slice(0, maxPhotos)) photos.push({ id: l.contentVersionId, label: `${r.tail ?? r.aircraft} ${l.label}` });
    const facts = [card?.yom != null && tr(lang, "YOM {n}", { n: card.yom }), card?.yor != null && tr(lang, "YOR {n}", { n: card.yor }), card?.capacity != null && tr(lang, "{n} seats", { n: card.capacity }), r.base && tr(lang, "Base: {x}", { x: r.base }), tr(lang, "{n} approved photo{s}", { n: lineup.length, s: plural(lineup.length) })].filter(Boolean);
    return `• ${r.aircraft} · ${r.tail ?? tr(lang, "no tail number yet")} · ${facts.join(" · ")}`;
  };

  if (hit.length) {
    for (const o of hit.slice(0, 3)) {
      const mine = rows.filter((r) => r.operatorId === o.id);
      lines.push(tr(lang, mine.length ? "{name}{region} has {n} aircraft:" : "{name}{region} has {n} aircraft.", { name: o.canonicalName, region: o.region ? ` (${o.region})` : "", n: mine.length }));
      for (const r of mine) lines.push(await describe(r, 4));
    }
    return { say: lines, photos: photos.slice(0, 12), link: { href: `/organisations/${hit[0].id}`, label: tr(lang, "Open {name}", { name: hit[0].canonicalName }) } };
  }

  // A tail number anywhere in the sentence, with or without a hyphen or space: "what does B-KXX have", "t7 lxx photos".
  const byTail = rows.filter((r) => r.tail && normalizeRegistration(r.tail).length >= 3 && sentence.includes(normalizeRegistration(r.tail).toLowerCase()));
  if (byTail.length) {
    for (const r of byTail) lines.push(`${r.operator ? r.operator + " · " : ""}${(await describe(r, 12)).slice(2)}`);
    return { say: lines, photos: photos.slice(0, 12), link: { href: `/aircraft/${byTail[0].aircraftId}`, label: tr(lang, "Open this aircraft") } };
  }
  return null;
}

const WIFI_WORD: Record<string, string> = { yes: "yes", no: "no", tbc: "TBC" };
const categoryKeyOf = (englishLabel: string) => AIRCRAFT_CATEGORIES.find((c) => AIRCRAFT_CATEGORY_LABEL[c] === englishLabel) ?? null;

/**
 * "Show heavy jets based in Hong Kong with wifi, newest first": the same filters and sorting as the
 * Operators & aircraft page. Returns what was found and a link that opens the page set up the same way.
 */
export async function answerFleet(db: Db, tenantId: string, message: string, lang?: ChatLang): Promise<{ say: string[]; link: { href: string; label: string } } | null> {
  const orgs = await db.select().from(organisations).where(eq(organisations.tenantId, tenantId));
  const rows = await getCatalogue(db, tenantId);
  const types = await db.select().from(aircraftTypes).where(eq(aircraftTypes.tenantId, tenantId));
  const parsed = parseFleetQuery(message, { orgs: orgs.filter((o) => o.active), rows });
  if (!looksLikeFleetRequest(message, parsed)) return null;

  const cards = new Map<string, Awaited<ReturnType<typeof getAircraftCard>>>();
  for (const r of rows) cards.set(r.aircraftId, await getAircraftCard(db, r.aircraftId));
  const result = runFleetQuery({ orgs: orgs.filter((o) => o.active), rows, types, cards }, parsed.query);

  const line = (r: (typeof rows)[number]) => {
    const c = cards.get(r.aircraftId);
    const wifi = c && WIFI_WORD[c.wifi] ? tr(lang, "WIFI {status}", { status: isChinese(lang) ? trWifi(lang, c.wifi) : WIFI_WORD[c.wifi] }) : null;
    const facts = [c?.yom != null && tr(lang, "YOM {n}", { n: c.yom }), c?.yor != null && tr(lang, "YOR {n}", { n: c.yor }), c?.capacity != null && tr(lang, "{n} seats", { n: c.capacity }), wifi, r.base && tr(lang, "Base: {x}", { x: r.base })].filter(Boolean);
    return `• ${r.aircraft} · ${r.tail ?? tr(lang, "no tail number yet")}${facts.length ? " · " + facts.join(" · ") : ""}`;
  };
  const shownGroups = result.groups.filter((g) => g.aircraft.length > 0 || !result.filtering);
  const total = shownGroups.reduce((n, g) => n + g.aircraft.length, 0) + result.unassigned.length;
  const notes = parsed.understood.map((u) => trUnderstood(lang, u, categoryKeyOf));
  const how = notes.length ? (isChinese(lang) ? `（${notes.join("；")}）` : ` (${notes.join("; ")})`) : "";
  const say: string[] = [];
  if (shownGroups.length === 0 && result.unassigned.length === 0) {
    say.push(tr(lang, "Nothing matches{how}. Try fewer filters.", { how }));
  } else {
    say.push(tr(lang, "{ops} operator{ops_s}, {n} aircraft{how}:", { ops: shownGroups.length, ops_s: plural(shownGroups.length), n: total, how }));
    const CAP = 25;
    if (parsed.query.acsort) {
      // Sorting by year, seats or WIFI is asked across everything, so the answer is one list with the operator on each line.
      const all = sortAircraft([...shownGroups.flatMap((g) => g.aircraft), ...result.unassigned], parsed.query.acsort, cards);
      for (const r of all.slice(0, CAP)) say.push(`${line(r)}${r.operator ? ` · ${r.operator}` : ""}`);
    } else {
      let shown = 0;
      for (const g of shownGroups) {
        if (shown >= CAP) break;
        const body = g.aircraft.slice(0, CAP - shown);
        shown += body.length;
        say.push([`${g.org.canonicalName}${g.org.region ? ` (${g.org.region})` : ""}`, ...body.map(line)].join("\n"));
      }
      if (result.unassigned.length && shown < CAP) say.push([tr(lang, "No operator"), ...result.unassigned.slice(0, CAP - shown).map(line)].join("\n"));
    }
    if (total > CAP) say.push(tr(lang, "…and {n} more. Open the page to see them all.", { n: total - CAP }));
  }
  return { say, link: { href: fleetLink(parsed.query), label: tr(lang, "Open this view on Operators & aircraft") } };
}

/** Just enough of the directory to read a sentence's filters (regions, bases). */
export async function fleetBasics(db: Db, tenantId: string) {
  const orgs = await db.select().from(organisations).where(eq(organisations.tenantId, tenantId));
  return { orgs: orgs.filter((o) => o.active), rows: await getCatalogue(db, tenantId) };
}

/**
 * The quotation message (in your saved wording, in the chat language) and a few photos for each chosen aircraft,
 * so Chocks can show "template and photos" right in the chat.
 */
export async function quotePreview(db: Db, tenantId: string, ids: string[], lang?: ChatLang): Promise<{ text: string; photos: { id: string; label: string }[] }> {
  const rows = await getCatalogue(db, tenantId);
  const templates = await getQuoteTemplates(db, tenantId);
  const items = [];
  const photos: { id: string; label: string }[] = [];
  for (const id of ids) {
    const r = rows.find((x) => x.aircraftId === id);
    const card = await getAircraftCard(db, id);
    if (!r || !card) continue;
    items.push({ type: card.aircraft, yom: card.yom, yor: card.yor, capacity: card.capacity, wifi: card.wifi, wifiDetail: card.wifiDetail });
    const lineup = await getLineup(db, { aircraftId: id, aircraftTypeId: r.aircraftTypeId });
    for (const l of lineup.slice(0, 4)) photos.push({ id: l.contentVersionId, label: `${card.aircraft} ${l.label}` });
  }
  const language = lang === "zh-Hant" || lang === "zh-Hans" ? lang : "en";
  return { text: buildQuote(items, { language, template: templates[language] ?? null, greeting: true }), photos };
}
