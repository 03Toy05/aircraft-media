import { matchesWords, searchWords } from "./searchMatch";
import type { CatalogueRow } from "./catalogue";
import { AIRCRAFT_CATEGORIES, AIRCRAFT_CATEGORY_LABEL, normalizeKey, type AircraftCategory, type WifiStatus } from "./constants";

/**
 * The filters and sorting of the Operators & aircraft page, as one function. The page and Chocks both call it,
 * so "show heavy jets based in Hong Kong, newest first" gives the same answer in either place.
 */
export const AC_SORTS = [
  { id: "", label: "Default" },
  { id: "yom", label: "Newest (YOM)" },
  { id: "yom_old", label: "Oldest (YOM)" },
  { id: "yor", label: "Most recently refurbished (YOR)" },
  { id: "yor_old", label: "Oldest refurbishment (YOR)" },
  { id: "seats", label: "Most seats" },
  { id: "seats_low", label: "Fewest seats" },
  { id: "wifi", label: "WIFI (yes first)" },
  { id: "type", label: "Type A–Z" },
] as const;
export type AcSort = (typeof AC_SORTS)[number]["id"];
export type OperatorSort = "name" | "region" | "aircraft";

/** What the search looks at: aircraft and operators (default), aircraft only, or operators only. */
export type SearchIn = "all" | "aircraft" | "operator";

export interface FleetQuery {
  q?: string;
  in?: SearchIn;
  region?: string; // "__none" = no region set
  category?: string;
  base?: string; // "__none" = not recorded; "Floating"
  wifi?: "yes" | "no" | "tbc" | "unknown";
  sort?: OperatorSort;
  acsort?: AcSort;
}

export interface FleetData {
  orgs: { id: string; canonicalName: string; region: string | null; base?: string | null; /** Other names ("VJ"). */ aliases?: string[] }[];
  rows: CatalogueRow[];
  types: { id: string; category: string | null }[];
  cards: Map<string, { yom: number | null; yor: number | null; capacity: number | null; wifi: WifiStatus } | null | undefined>;
}

const basesOf = (r: CatalogueRow) => (r.base ? r.base.split(/\s*\/\s*/) : []);
const WIFI_RANK: Record<string, number> = { yes: 0, tbc: 1, unknown: 2, no: 3 };

/** Orders aircraft by YOM, YOR, seats, WIFI or type. Aircraft with no value for the field always go last. */
export function sortAircraft(list: CatalogueRow[], acSort: AcSort, cards: FleetData["cards"]): CatalogueRow[] {
  const out = [...list];
  const card = (r: CatalogueRow) => cards.get(r.aircraftId);
  const by = (value: (r: CatalogueRow) => number | null | undefined, desc: boolean) =>
    out.sort((a, b) => {
      const x = value(a), y = value(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return desc ? y - x : x - y;
    });
  if (acSort === "yom") by((r) => card(r)?.yom, true);
  else if (acSort === "yom_old") by((r) => card(r)?.yom, false);
  else if (acSort === "yor") by((r) => card(r)?.yor, true);
  else if (acSort === "yor_old") by((r) => card(r)?.yor, false);
  else if (acSort === "seats") by((r) => card(r)?.capacity, true);
  else if (acSort === "seats_low") by((r) => card(r)?.capacity, false);
  else if (acSort === "wifi") by((r) => WIFI_RANK[card(r)?.wifi ?? "unknown"], false);
  else if (acSort === "type") out.sort((x, y) => x.aircraft.localeCompare(y.aircraft));
  return out;
}

export function runFleetQuery(data: FleetData, query: FleetQuery) {
  const { orgs, rows, types, cards } = data;
  const q = (query.q ?? "").trim().toLowerCase();
  const words = searchWords(q);
  const searchIn: SearchIn = query.in === "aircraft" || query.in === "operator" ? query.in : "all";
  const regionFilter = (query.region ?? "").trim();
  const catFilter = (query.category ?? "").trim();
  const baseFilter = (query.base ?? "").trim();
  const wifiFilter = query.wifi ?? "";
  const sort: OperatorSort = query.sort === "region" || query.sort === "aircraft" ? query.sort : "name";
  const acSort: AcSort = AC_SORTS.some((s) => s.id === query.acsort) ? (query.acsort as AcSort) : "";

  const regions = [...new Set(orgs.map((o) => o.region).filter((r): r is string => !!r))].sort((a, b) => a.localeCompare(b));
  const baseOptions = [...new Set(rows.flatMap(basesOf))].sort((a, b) => (a === "Floating" ? 1 : b === "Floating" ? -1 : a.localeCompare(b)));

  const catOf = (r: CatalogueRow) => types.find((t) => t.id === r.aircraftTypeId)?.category ?? "";
  const card = (r: CatalogueRow) => cards.get(r.aircraftId);
  const aircraftMatch = (r: CatalogueRow) =>
    (!catFilter || catOf(r) === catFilter) &&
    (!baseFilter || (baseFilter === "__none" ? !r.base : basesOf(r).includes(baseFilter))) &&
    (!wifiFilter || (card(r)?.wifi ?? "unknown") === wifiFilter);

  const acRows = (list: CatalogueRow[]) => sortAircraft(list.filter(aircraftMatch), acSort, cards);

  const countOf = (id: string) => rows.filter((r) => r.operatorId === id).length;
  // Search: an operator found by its name (or other names, or region) shows its whole fleet; otherwise only the
  // aircraft that match are shown under it. "Aircraft" never matches by operator alone; "Operator" never by aircraft.
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const opText = (o: FleetData["orgs"][number]) => `${o.canonicalName} ${(o.aliases ?? []).join(" ")} ${o.region ?? ""}`;
  const opHit = (o: FleetData["orgs"][number]) => !words.length || (searchIn !== "aircraft" && matchesWords(opText(o), words));
  const acHit = (r: CatalogueRow) => {
    if (!words.length) return true;
    if (searchIn === "operator") return false;
    const o = r.operatorId ? orgById.get(r.operatorId) : undefined;
    return matchesWords(`${r.tail ?? ""} ${r.aircraft} ${o ? `${o.canonicalName} ${(o.aliases ?? []).join(" ")}` : ""}`, words);
  };
  const fleetOf = (o: FleetData["orgs"][number]) => {
    const all = acRows(rows.filter((r) => r.operatorId === o.id));
    return opHit(o) && words.length ? all : all.filter(acHit);
  };
  const aircraftFiltering = !!(catFilter || baseFilter || wifiFilter);

  const shown = orgs
    .filter((o) => !aircraftFiltering || acRows(rows.filter((r) => r.operatorId === o.id)).length > 0)
    .filter((o) => (!regionFilter || (regionFilter === "__none" ? !o.region : o.region === regionFilter)) && (opHit(o) || fleetOf(o).length > 0))
    .sort((a, b) =>
      sort === "region" ? (a.region ?? "~").localeCompare(b.region ?? "~") || a.canonicalName.localeCompare(b.canonicalName)
      : sort === "aircraft" ? countOf(b.id) - countOf(a.id) || a.canonicalName.localeCompare(b.canonicalName)
      : a.canonicalName.localeCompare(b.canonicalName));

  const filtering = !!(regionFilter || q || aircraftFiltering);
  return {
    regions, baseOptions, sort, acSort, q, regionFilter, catFilter, baseFilter, wifiFilter, filtering,
    searchIn,
    groups: shown.map((o) => ({ org: o, aircraft: fleetOf(o) })),
    // Aircraft with no operator: all of them when not filtering; the matching ones when searching.
    unassigned: !filtering ? acRows(rows.filter((r) => !r.operatorId))
      : words.length && !regionFilter && searchIn !== "operator" ? acRows(rows.filter((r) => !r.operatorId)).filter(acHit) : [],
  };
}

/** The same query as a link to the page: "/fleet?region=Asia&acsort=yom". */
export { matchesWords, searchWords };

export function fleetLink(query: FleetQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) p.set(k, String(v));
  return `/fleet${p.size ? `?${p}` : ""}`;
}

// ---------------------------------------------------------------- reading a sentence

const words = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}+\- ]+/gu, " ").replace(/\s+/g, " ")} `;

/** "heavy jets" -> heavy_jet. Matches the label (ignoring "(large)") or its plain form, singular or plural. */
const CATEGORY_WORDS: Record<AircraftCategory, string[]> = {
  very_light_jet: ["very light jet"],
  light_jet: ["light jet"],
  midsize_jet: ["midsize jet", "mid size jet", "mid-size jet"],
  super_midsize_jet: ["super midsize jet", "super mid size jet", "super mid-size jet"],
  heavy_jet: ["heavy jet", "large jet", "heavy large jet"],
  ultra_long_range_jet: ["ultra long range jet", "ultra-long-range jet", "ultra long range", "ulr"],
  executive_airliner: ["executive airliner", "airliner", "vip airliner"],
  turboprop: ["turboprop", "turbo prop"],
  helicopter: ["helicopter", "heli"],
  other: [],
};
// Traditional and Simplified Chinese names, added to the English ones.
const CATEGORY_ZH_WORDS: Record<AircraftCategory, string[]> = {
  very_light_jet: ["超輕型噴射機", "超轻型喷射机", "超輕型", "超轻型"],
  light_jet: ["輕型噴射機", "轻型喷射机", "輕型", "轻型"],
  midsize_jet: ["中型噴射機", "中型喷射机", "中型"],
  super_midsize_jet: ["超中型噴射機", "超中型喷射机", "超中型"],
  heavy_jet: ["大型噴射機", "大型喷射机", "大型", "重型"],
  ultra_long_range_jet: ["超遠程", "超远程"],
  executive_airliner: ["行政客機", "行政客机"],
  turboprop: ["渦輪螺旋槳", "涡轮螺旋桨", "螺旋槳", "螺旋桨"],
  helicopter: ["直升機", "直升机"],
  other: [],
};
const hasCjk = (t: string) => /[\u3400-\u9fff]/.test(t);
/** A name from your data inside the sentence: spaces matter for Latin names, not for Chinese ones. */
const mentionsName = (w: string, name: string) => (hasCjk(name) ? w.includes(name.toLowerCase()) : w.includes(` ${words(name).trim()} `));

export interface ParsedFleetQuery { query: FleetQuery; understood: string[] }

/**
 * Turns "show me heavy jets based in Hong Kong with wifi, newest first" into filters and a sort.
 * Only things that match what you really have are used (a region or base that isn't in your data is ignored,
 * so a stray word never filters everything away). `understood` lists what was applied, for Chocks to repeat back.
 */
export function parseFleetQuery(message: string, data: Pick<FleetData, "orgs" | "rows">): ParsedFleetQuery {
  const w = words(message);
  const query: FleetQuery = {};
  const understood: string[] = [];

  const region = [...new Set(data.orgs.map((o) => o.region).filter((r): r is string => !!r))]
    .sort((a, b) => b.length - a.length)
    .find((r) => mentionsName(w, r) || (normalizeKey(w).includes(normalizeKey(r)) && normalizeKey(r).length >= (hasCjk(r) ? 2 : 4)));
  if (region) { query.region = region; understood.push(`region: ${region}`); }
  else if (/\b(no region|without (?:a )?region|region not set)\b|沒有地區|没有地区|未設定地區|未设定地区/i.test(message)) { query.region = "__none"; understood.push("no region set"); }

  // "very light jet" also contains "light jet", so when several categories match textually the most specific (longest) wins.
  const formsOf = (c: AircraftCategory) => [...CATEGORY_WORDS[c], ...CATEGORY_ZH_WORDS[c], words(AIRCRAFT_CATEGORY_LABEL[c].replace(/\s*\(.*\)/, "")).trim()].filter(Boolean);
  const hits = AIRCRAFT_CATEGORIES.filter((c) => formsOf(c).some((f) => new RegExp(`(?<![a-z-])${f}s?(?![a-z])`, "i").test(w.trim())));
  if (hits.length) {
    const best = [...hits].sort((x, y) => Math.max(...formsOf(y).map((f) => f.length)) - Math.max(...formsOf(x).map((f) => f.length)))[0];
    query.category = best;
    understood.push(`category: ${AIRCRAFT_CATEGORY_LABEL[best]}`);
  }

  if (/\b(floating|no fixed base)\b|浮動|浮动|無固定基地|无固定基地/i.test(message)) { query.base = "Floating"; understood.push("base: Floating"); }
  else if (/\b(base not recorded|no base|without (?:a )?base)\b|沒有基地|没有基地|未記錄基地|未记录基地/i.test(message)) { query.base = "__none"; understood.push("base not recorded"); }
  else {
    const bases = [...new Set(data.rows.flatMap(basesOf))].filter((b) => b !== "Floating").sort((a, b) => b.length - a.length);
    const base = bases.find((b) => mentionsName(w, b));
    if (base && base !== query.region) { query.base = base; understood.push(`base: ${base}`); }
  }

  const zhWifiNo = /(?:無|无|沒有|没有|冇|不帶|不带)\s*(?:wi-?\s?fi|無線網絡|无线网络)/i.test(message);
  const zhWifiYes = !zhWifiNo && /(?:有|提供|附帶|附带|帶|带)\s*(?:wi-?\s?fi|無線網絡|无线网络)/i.test(message);
  if (zhWifiNo || /\b(without|no|lacking|doesn'?t have|don'?t have)\s+wi-?\s?fi\b|\bwi-?\s?fi\s*(?:is\s*)?(?:no|not available)\b/i.test(message)) { query.wifi = "no"; understood.push("WIFI: No"); }
  else if (zhWifiYes || /\b(?:with|has|have|having|that have|wifi\s*(?:is\s*)?yes)\b[^.?!]*\bwi-?\s?fi\b|\bwi-?\s?fi\s*(?:is\s*)?(?:yes|available|equipped)\b|\bwi-?\s?fi (?:aircraft|jets?|planes?)\b/i.test(message)) { query.wifi = "yes"; understood.push("WIFI: Yes"); }
  else if (/\bwi-?\s?fi\s*(?:is\s*)?tbc\b/i.test(message)) { query.wifi = "tbc"; understood.push("WIFI: TBC"); }

  // Sorting. "newest" / "oldest" mean YOM unless the sentence says refurbishment.
  const refurb = /\b(yor|refurb\w*|refit\w*)\b/i.test(message);
  const sortWord = message.match(/\b(?:sort(?:ed)?|order(?:ed)?|rank(?:ed)?|arrange(?:d)?)\s+(?:them\s+)?(?:by|on)\s+([^,.?!]+)/i)?.[1] ?? message;
  const sw = words(sortWord);
  const has = (re: RegExp) => re.test(sw);
  let acsort: AcSort = "";
  // Chinese: 最新 / 最舊 / 座位最多 / 座位最少 / 翻新 / 按WIFI排序 / 按機型排序
  const zhRefurb = /翻新|改裝|改装/.test(message);
  if (/最舊|最旧|最老|舊到新|旧到新/.test(message)) acsort = zhRefurb ? "yor_old" : "yom_old";
  else if (/最新|最近|新到舊|新到旧/.test(message)) acsort = zhRefurb ? "yor" : "yom";
  else if (/(?:座位|載客|载客|人數|人数)(?:最少|由少到多|少到多)|最少(?:座位|載客|载客)/.test(message)) acsort = "seats_low";
  else if (/(?:座位|載客|载客|人數|人数)(?:最多|由多到少|多到少)|最多(?:座位|載客|载客)/.test(message)) acsort = "seats";
  else if (/(?:按|依|根據|根据)\s*(?:wi-?\s?fi|無線網絡|无线网络)\s*(?:排序|排列|整理)|wi-?\s?fi\s*排序/i.test(message)) acsort = "wifi";
  else if (/(?:按|依|根據|根据)\s*(?:機型|机型|型號|型号)\s*(?:排序|排列|整理)/.test(message)) acsort = "type";
  else if (/(?:按|依|根據|根据)\s*(?:翻新|改裝|改装)/.test(message)) acsort = "yor";
  else if (/(?:按|依|根據|根据)\s*(?:出廠|出厂|年份|製造|制造)/.test(message)) acsort = "yom";
  if (acsort) { /* set from the Chinese wording above */ }
  else if (has(/\b(oldest|earliest)\b/) ) acsort = refurb ? "yor_old" : "yom_old";
  else if (has(/\b(newest|latest|most recent\w*)\b/)) acsort = refurb ? "yor" : "yom";
  else if (has(/\b(fewest|least|smallest|lowest)\b.*\b(seats?|capacity|pax)\b|\b(seats?|capacity|pax)\b.*\b(ascending|low to high|fewest|smallest)\b/)) acsort = "seats_low";
  else if (has(/\b(most|biggest|largest|highest|greatest)\b.*\b(seats?|capacity|pax)\b|\b(seats?|capacity|pax)\b/) && /\b(sort|order|rank|arrange|biggest|largest|most|highest|fewest)/i.test(message)) acsort = "seats";
  else if (has(/\byor\b|\brefurb\w*\b/)) acsort = "yor";
  else if (has(/\byom\b|\byear of manufacture\b|\bage\b/)) acsort = "yom";
  else if (has(/\bwi-?\s?fi\b/) && /\b(sort|order|rank|arrange)/i.test(message)) acsort = "wifi";
  else if (has(/\b(type|model)\b/) && /\b(sort|order|rank|arrange)/i.test(message)) acsort = "type";
  if (acsort) {
    query.acsort = acsort;
    understood.push(`aircraft sorted by ${AC_SORTS.find((s) => s.id === acsort)!.label.toLowerCase()}`);
  }

  if (/(?:按|依|根據|根据)\s*(?:地區|地区|區域|区域)\s*(?:排序|排列|整理)/.test(message) || /\b(sort|order|rank|arrange)\w*\s+(?:the\s+)?(?:operators?\s+)?by\s+region\b/i.test(message)) { query.sort = "region"; understood.push("operators sorted by region"); }
  else if (/\bmost aircraft\b|\blargest fleets?\b|\bbiggest fleets?\b|飛機最多|飞机最多|機隊最大|机队最大/i.test(message)) { query.sort = "aircraft"; understood.push("operators sorted by most aircraft"); }
  else if (/\b(sort|order)\w*\s+(?:the\s+)?(?:operators?\s+)?(?:by|alphabetically)\s*(?:name)?\b/i.test(message) && /\b(name|alphabet)/i.test(message)) { query.sort = "name"; understood.push("operators sorted by name"); }

  return { query, understood };
}

/** Does this sentence look like a request to filter or sort the list? (as opposed to asking about one operator) */
export function looksLikeFleetRequest(message: string, parsed: ParsedFleetQuery) {
  if (parsed.understood.length > 0) return true;
  // With nothing to filter on, only a plain "show all operators" counts, so "what aircraft does Zebra have?" never lists everything.
  return (
    /^(?:please\s+|can you\s+|could you\s+)?(?:show|list|give)\s+(?:me\s+)?(?:my\s+|the\s+)?(?:all\s+)?(?:operators?|aircraft|fleet|planes?)(?:\s+and\s+(?:operators?|aircraft|planes?))?\s*[?.!]*$/i.test(message.trim()) ||
    /^(?:請|请)?(?:幫我|帮我)?(?:顯示|显示|列出|睇|看|給我看|给我看)(?:所有|全部|我嘅|我的)?(?:營運商|运营商|運營商|飛機|飞机|機隊|机队)[。！？?!]*$/.test(message.trim())
  );
}
