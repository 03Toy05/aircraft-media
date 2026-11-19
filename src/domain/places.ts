import data from "../data/places.json";

/**
 * Cities and their airports (IATA/ICAO codes) from OurAirports (public domain, https://ourairports.com/data/), plus
 * world regions and countries, so a base or region is chosen from one list instead of typed in different ways
 * ("HK", "HKG", "VHHH", "香港" and "Hong Kong" all become "Hong Kong"). Only large and medium airports are included.
 * Rebuild the list with scripts/build-places.mjs.
 */

interface Raw { c: string; k: string; n: string; a: [string, string, string][]; w: string[] }
export interface Place {
  /** What is saved and shown: the city, with the country only when another city has the same name. */
  label: string;
  city: string;
  countryCode: string;
  country: string;
  airports: { iata: string; icao: string; name: string }[];
  keywords: string[];
}

const raw = (data as unknown as { places: Raw[] }).places;
const seenCity = new Set<string>();
export const PLACES: Place[] = raw.map((p) => {
  const key = p.c.toLowerCase();
  const label = seenCity.has(key) ? `${p.c}, ${p.n}` : p.c;
  seenCity.add(key);
  return { label, city: p.c, countryCode: p.k, country: p.n, airports: p.a.map(([iata, icao, name]) => ({ iata, icao, name })), keywords: p.w };
});

/** Broad regions brokers use. */
export const WORLD_REGIONS = [
  "Asia", "East Asia", "Southeast Asia", "South Asia", "Central Asia", "Greater China", "Middle East", "Europe",
  "Western Europe", "Eastern Europe", "Africa", "North America", "Central America", "Caribbean", "South America", "Oceania",
];
const REGION_ALIASES: Record<string, string> = {
  apac: "Asia", "asia pacific": "Asia", "asia-pacific": "Asia", sea: "Southeast Asia", "se asia": "Southeast Asia",
  "south east asia": "Southeast Asia", mideast: "Middle East", "middle-east": "Middle East", me: "Middle East",
  europe: "Europe", eu: "Europe", na: "North America", latam: "South America", "latin america": "South America",
  亞洲: "Asia", 亚洲: "Asia", 東南亞: "Southeast Asia", 东南亚: "Southeast Asia", 中東: "Middle East", 中东: "Middle East",
  歐洲: "Europe", 欧洲: "Europe", 大中華: "Greater China", 大中华: "Greater China", 北美: "North America", 非洲: "Africa",
};

/** Countries and territories that have airports in the list (Hong Kong and Macau are their own). */
export const COUNTRIES: { code: string; name: string }[] = [...new Map(PLACES.map((p) => [p.countryCode, p.country])).entries()]
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Chinese names for places brokers in Hong Kong use most (OurAirports is in English). */
const ZH: Record<string, { city?: string; country?: string }> = {
  香港: { city: "Hong Kong", country: "HK" }, 澳門: { city: "Macau", country: "MO" }, 澳门: { city: "Macau", country: "MO" },
  新加坡: { city: "Singapore", country: "SG" }, 台北: { city: "Taipei" }, 臺北: { city: "Taipei" }, 台灣: { country: "TW" }, 台湾: { country: "TW" },
  北京: { city: "Beijing" }, 上海: { city: "Shanghai" }, 廣州: { city: "Guangzhou" }, 广州: { city: "Guangzhou" },
  深圳: { city: "Shenzhen" }, 成都: { city: "Chengdu" }, 杭州: { city: "Hangzhou" }, 三亞: { city: "Sanya" }, 三亚: { city: "Sanya" },
  海口: { city: "Haikou" }, 中國: { country: "CN" }, 中国: { country: "CN" }, 東京: { city: "Tokyo" }, 东京: { city: "Tokyo" },
  大阪: { city: "Osaka" }, 日本: { country: "JP" }, 首爾: { city: "Seoul" }, 首尔: { city: "Seoul" }, 韓國: { country: "KR" }, 韩国: { country: "KR" },
  曼谷: { city: "Bangkok" }, 泰國: { country: "TH" }, 泰国: { country: "TH" }, 吉隆坡: { city: "Kuala Lumpur" }, 馬來西亞: { country: "MY" }, 马来西亚: { country: "MY" },
  雅加達: { city: "Jakarta" }, 雅加达: { city: "Jakarta" }, 峇里: { city: "Denpasar" }, 巴厘: { city: "Denpasar" }, 馬尼拉: { city: "Manila" }, 马尼拉: { city: "Manila" },
  胡志明市: { city: "Ho Chi Minh City" }, 河內: { city: "Hanoi" }, 河内: { city: "Hanoi" }, 越南: { country: "VN" },
  杜拜: { city: "Dubai" }, 迪拜: { city: "Dubai" }, 阿聯酋: { country: "AE" }, 阿联酋: { country: "AE" },
  倫敦: { city: "London" }, 伦敦: { city: "London" }, 巴黎: { city: "Paris" }, 英國: { country: "GB" }, 英国: { country: "GB" },
  紐約: { city: "New York" }, 纽约: { city: "New York" }, 洛杉磯: { city: "Los Angeles" }, 洛杉矶: { city: "Los Angeles" }, 美國: { country: "US" }, 美国: { country: "US" },
  悉尼: { city: "Sydney" }, 雪梨: { city: "Sydney" }, 墨爾本: { city: "Melbourne" }, 墨尔本: { city: "Melbourne" }, 澳洲: { country: "AU" }, 澳大利亚: { country: "AU" },
};

const lower = (s: string) => s.normalize("NFKC").trim().toLowerCase();
const byCity = (city: string) => PLACES.find((p) => lower(p.city) === lower(city));
/** The country's main city, when it is clear (Hong Kong, Singapore, Macau): its only city with a large airport, or the city named like the country. */
function mainCityOf(code: string): Place | undefined {
  const inCountry = PLACES.filter((p) => p.countryCode === code);
  const sameName = inCountry.find((p) => lower(p.city) === lower(p.country));
  if (sameName) return sameName;
  return inCountry.length === 1 ? inCountry[0] : undefined;
}

/** The place a typed base means, when it is clear: an IATA/ICAO code, a city name, a Chinese name, or a code like HK. */
export function findPlace(text: string, opts: { codes?: boolean } = {}): Place | undefined {
  const t = text.normalize("NFKC").trim();
  if (!t) return undefined;
  const up = t.toUpperCase();
  const codes = opts.codes ?? true;
  if (codes && /^[A-Z]{3}$/.test(up)) { const p = PLACES.find((x) => x.airports.some((a) => a.iata === up)); if (p) return p; }
  if (codes && /^[A-Z0-9]{4}$/.test(up) && /\d|^[A-Z]{4}$/.test(up)) { const p = PLACES.find((x) => x.airports.some((a) => a.icao === up)); if (p) return p; }
  const label = PLACES.find((p) => lower(p.label) === lower(t));
  if (label) return label;
  const city = byCity(t);
  if (city) return city;
  const zh = ZH[t];
  if (zh?.city) return byCity(zh.city);
  if (zh?.country) return mainCityOf(zh.country);
  if (/^[A-Z]{2}$/.test(up)) return mainCityOf(up);
  const country = COUNTRIES.find((c) => lower(c.name) === lower(t));
  return country ? mainCityOf(country.code) : undefined;
}

/** A base as it should be saved: the matching city's label, or the text as typed when nothing matches clearly. */
export function normalizeBase(text: string): string {
  const t = text.trim();
  if (/^floating$/i.test(t)) return t;
  return findPlace(t)?.label ?? t;
}

/** A region as it should be saved: a world region, a country or territory, or a city; else the text as typed. */
export function normalizeRegion(text: string): string {
  const t = text.normalize("NFKC").trim();
  if (!t) return t;
  const l = lower(t);
  const world = WORLD_REGIONS.find((r) => lower(r) === l) ?? REGION_ALIASES[l] ?? REGION_ALIASES[t];
  if (world) return world;
  const up = t.toUpperCase();
  const byCode = /^[A-Z]{2}$/.test(up) ? COUNTRIES.find((c) => c.code === up) : undefined;
  if (byCode) return byCode.name;
  const country = COUNTRIES.find((c) => lower(c.name) === l);
  if (country) return country.name;
  const zh = ZH[t];
  if (zh?.country) return COUNTRIES.find((c) => c.code === zh.country)?.name ?? t;
  // A city that is also a country (Singapore) is the country; any other known city stays a city. Airport codes count
  // only when typed in capitals ("MID" is Mérida, "mid" is probably the start of "Middle East").
  const place = findPlace(t, { codes: t === up });
  if (place) return COUNTRIES.find((c) => lower(c.name) === lower(place.city))?.name ?? place.label;
  return t;
}

export interface PlaceSuggestion { value: string; detail: string }

/** Suggestions for the base picker: city first, with its airports' codes. */
export function searchBases(q: string, limit = 8): PlaceSuggestion[] {
  const t = lower(q);
  if (!t) return [];
  const up = q.trim().toUpperCase();
  const exact = findPlace(q);
  const scored: { p: Place; s: number; i: number }[] = [];
  PLACES.forEach((p, i) => {
    let s = 0;
    if (p === exact) s = 100;
    else if (p.airports.some((a) => a.iata === up || a.icao === up)) s = 95;
    else if (lower(p.city).startsWith(t)) s = 70;
    else if (p.airports.some((a) => a.iata.startsWith(up) && up.length >= 2 || a.icao.startsWith(up) && up.length >= 3)) s = 55;
    else if (lower(p.country).startsWith(t) && t.length >= 3) s = 35;
    else if (t.length >= 3 && (lower(p.city).includes(t) || p.airports.some((a) => lower(a.name).includes(t)) || p.keywords.some((k) => lower(k).includes(t)))) s = 25;
    if (s) scored.push({ p, s, i });
  });
  return scored
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map(({ p }) => ({
      value: p.label,
      detail: [p.airports.slice(0, 3).map((a) => [a.iata, a.icao].filter(Boolean).join(" / ")).join(" · "), p.label.includes(",") ? "" : p.country].filter(Boolean).join(" — "),
    }));
}

/** Suggestions for the region picker: world regions, then countries and territories, then cities. */
export function searchRegions(q: string, limit = 8): PlaceSuggestion[] {
  const t = lower(q);
  if (!t) return WORLD_REGIONS.slice(0, limit).map((r) => ({ value: r, detail: "Region" }));
  const norm = normalizeRegion(q);
  const out: PlaceSuggestion[] = [];
  const add = (value: string, detail: string) => { if (!out.some((o) => o.value === value)) out.push({ value, detail }); };
  // An exact match (HK -> Hong Kong, ME -> Middle East) first, then regions, countries and cities that start with it.
  if (WORLD_REGIONS.includes(norm)) add(norm, "Region");
  else if (COUNTRIES.some((c) => c.name === norm)) add(norm, "Country or territory");
  for (const r of WORLD_REGIONS) if (lower(r).startsWith(t) || (t.length >= 3 && lower(r).includes(t))) add(r, "Region");
  for (const c of COUNTRIES) if (lower(c.name).startsWith(t) || c.code === q.trim().toUpperCase()) add(c.name, "Country or territory");
  for (const s of searchBases(q, limit)) add(s.value, `City — ${s.detail}`);
  return out.slice(0, limit);
}
