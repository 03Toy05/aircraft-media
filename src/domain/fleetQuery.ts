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

export interface FleetQuery {
  q?: string;
  region?: string; // "__none" = no region set
  category?: string;
  base?: string; // "__none" = not recorded; "Floating"
  wifi?: "yes" | "no" | "tbc" | "unknown";
  sort?: OperatorSort;
  acsort?: AcSort;
}

export interface FleetData {
  orgs: { id: string; canonicalName: string; region: string | null; base?: string | null }[];
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
  const matchesQ = (o: FleetData["orgs"][number]) =>
    !q || o.canonicalName.toLowerCase().includes(q) || (o.region ?? "").toLowerCase().includes(q) ||
    rows.some((r) => r.operatorId === o.id && [r.tail, r.aircraft].some((x) => (x ?? "").toLowerCase().includes(q)));
  const aircraftFiltering = !!(catFilter || baseFilter || wifiFilter);

  const shown = orgs
    .filter((o) => !aircraftFiltering || acRows(rows.filter((r) => r.operatorId === o.id)).length > 0)
    .filter((o) => (!regionFilter || (regionFilter === "__none" ? !o.region : o.region === regionFilter)) && matchesQ(o))
    .sort((a, b) =>
      sort === "region" ? (a.region ?? "~").localeCompare(b.region ?? "~") || a.canonicalName.localeCompare(b.canonicalName)
      : sort === "aircraft" ? countOf(b.id) - countOf(a.id) || a.canonicalName.localeCompare(b.canonicalName)
      : a.canonicalName.localeCompare(b.canonicalName));

  const filtering = !!(regionFilter || q || aircraftFiltering);
  return {
    regions, baseOptions, sort, acSort, q, regionFilter, catFilter, baseFilter, wifiFilter, filtering,
    groups: shown.map((o) => ({ org: o, aircraft: acRows(rows.filter((r) => r.operatorId === o.id)) })),
    unassigned: filtering ? [] : acRows(rows.filter((r) => !r.operatorId)),
  };
}

/** The same query as a link to the page: "/fleet?region=Asia&acsort=yom". */
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
    .find((r) => w.includes(` ${words(r).trim()} `) || normalizeKey(w).includes(normalizeKey(r)) && normalizeKey(r).length >= 4);
  if (region) { query.region = region; understood.push(`region: ${region}`); }
  else if (/\b(no region|without (?:a )?region|region not set)\b/i.test(message)) { query.region = "__none"; understood.push("no region set"); }

  // "very light jet" also contains "light jet", so when several categories match textually the most specific (longest) wins.
  const formsOf = (c: AircraftCategory) => [...CATEGORY_WORDS[c], words(AIRCRAFT_CATEGORY_LABEL[c].replace(/\s*\(.*\)/, "")).trim()].filter(Boolean);
  const hits = AIRCRAFT_CATEGORIES.filter((c) => formsOf(c).some((f) => new RegExp(`(?<![a-z-])${f}s?(?![a-z])`, "i").test(w.trim())));
  if (hits.length) {
    const best = [...hits].sort((x, y) => Math.max(...formsOf(y).map((f) => f.length)) - Math.max(...formsOf(x).map((f) => f.length)))[0];
    query.category = best;
    understood.push(`category: ${AIRCRAFT_CATEGORY_LABEL[best]}`);
  }

  if (/\b(floating|no fixed base)\b/i.test(message)) { query.base = "Floating"; understood.push("base: Floating"); }
  else if (/\b(base not recorded|no base|without (?:a )?base)\b/i.test(message)) { query.base = "__none"; understood.push("base not recorded"); }
  else {
    const bases = [...new Set(data.rows.flatMap(basesOf))].filter((b) => b !== "Floating").sort((a, b) => b.length - a.length);
    const base = bases.find((b) => w.includes(` ${words(b).trim()} `));
    if (base && base !== query.region) { query.base = base; understood.push(`base: ${base}`); }
  }

  if (/\b(without|no|lacking|doesn'?t have|don'?t have)\s+wi-?\s?fi\b|\bwi-?\s?fi\s*(?:is\s*)?(?:no|not available)\b/i.test(message)) { query.wifi = "no"; understood.push("WIFI: No"); }
  else if (/\b(?:with|has|have|having|that have|wifi\s*(?:is\s*)?yes)\b[^.?!]*\bwi-?\s?fi\b|\bwi-?\s?fi\s*(?:is\s*)?(?:yes|available|equipped)\b|\bwi-?\s?fi (?:aircraft|jets?|planes?)\b/i.test(message)) { query.wifi = "yes"; understood.push("WIFI: Yes"); }
  else if (/\bwi-?\s?fi\s*(?:is\s*)?tbc\b/i.test(message)) { query.wifi = "tbc"; understood.push("WIFI: TBC"); }

  // Sorting. "newest" / "oldest" mean YOM unless the sentence says refurbishment.
  const refurb = /\b(yor|refurb\w*|refit\w*)\b/i.test(message);
  const sortWord = message.match(/\b(?:sort(?:ed)?|order(?:ed)?|rank(?:ed)?|arrange(?:d)?)\s+(?:them\s+)?(?:by|on)\s+([^,.?!]+)/i)?.[1] ?? message;
  const sw = words(sortWord);
  const has = (re: RegExp) => re.test(sw);
  let acsort: AcSort = "";
  if (has(/\b(oldest|earliest)\b/) ) acsort = refurb ? "yor_old" : "yom_old";
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

  if (/\b(sort|order|rank|arrange)\w*\s+(?:the\s+)?(?:operators?\s+)?by\s+region\b/i.test(message)) { query.sort = "region"; understood.push("operators sorted by region"); }
  else if (/\bmost aircraft\b|\blargest fleets?\b|\bbiggest fleets?\b/i.test(message)) { query.sort = "aircraft"; understood.push("operators sorted by most aircraft"); }
  else if (/\b(sort|order)\w*\s+(?:the\s+)?(?:operators?\s+)?(?:by|alphabetically)\s*(?:name)?\b/i.test(message) && /\b(name|alphabet)/i.test(message)) { query.sort = "name"; understood.push("operators sorted by name"); }

  return { query, understood };
}

/** Does this sentence look like a request to filter or sort the list? (as opposed to asking about one operator) */
export function looksLikeFleetRequest(message: string, parsed: ParsedFleetQuery) {
  if (parsed.understood.length > 0) return true;
  // With nothing to filter on, only a plain "show all operators" counts, so "what aircraft does Zebra have?" never lists everything.
  return /^(?:please\s+|can you\s+|could you\s+)?(?:show|list|give)\s+(?:me\s+)?(?:my\s+|the\s+)?(?:all\s+)?(?:operators?|aircraft|fleet|planes?)(?:\s+and\s+(?:operators?|aircraft|planes?))?\s*[?.!]*$/i.test(message.trim());
}
