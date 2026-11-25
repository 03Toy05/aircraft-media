import data from "../data/airports.json";

/** One airport: ICAO and IATA codes, name, city, country, position and IANA time zone (data: mwgg/Airports, MIT). */
export interface Airport { icao: string; iata: string; name: string; city: string; cc: string; lat: number; lon: number; tz: string }

type Row = [string, string, string, string, string, number, number, string];
const ALL: Airport[] = (data as unknown as Row[]).map(([icao, iata, name, city, cc, lat, lon, tz]) => ({ icao, iata, name, city, cc, lat, lon, tz }));
const BY_ICAO = new Map(ALL.map((a) => [a.icao, a]));
const BY_IATA = new Map<string, Airport>();
for (const a of ALL) if (a.iata && !BY_IATA.has(a.iata)) BY_IATA.set(a.iata, a); // airports with a scheduled-service code come first

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** By ICAO ("VHHH") or IATA ("HKG"), or a label like "Hong Kong (HKG)". */
export function findAirport(code: string | null | undefined): Airport | null {
  const raw = (code ?? "").trim();
  const inParens = raw.match(/\(([A-Za-z0-9]{3,4})\)\s*$/)?.[1];
  const c = (inParens ?? raw).toUpperCase();
  if (/^[A-Z]{4}$/.test(c)) return BY_ICAO.get(c) ?? null;
  if (/^[A-Z]{3}$/.test(c)) return BY_IATA.get(c) ?? null;
  return null;
}

/** The airports these codes name, for pages and messages (unknown codes are left out). */
export function airportsFor(codes: (string | null | undefined)[]): Record<string, Airport> {
  const out: Record<string, Airport> = {};
  for (const c of codes) {
    const a = findAirport(c);
    if (a && c) out[c] = a;
  }
  return out;
}

/** Type a code, a city or a name: exact codes first, then cities, then names. */
export function searchAirports(q: string, limit = 10): Airport[] {
  const t = norm(q.trim());
  if (t.length < 2) return [];
  const up = q.trim().toUpperCase();
  const scored: { a: Airport; s: number; i: number }[] = [];
  ALL.forEach((a, i) => {
    let s = 0;
    if (a.icao === up || a.iata === up) s = 100;
    else if (up.length >= 2 && (a.iata.startsWith(up) || a.icao.startsWith(up))) s = 60;
    else if (norm(a.city).startsWith(t)) s = 50;
    else if (t.length >= 3 && (norm(a.name).includes(t) || norm(a.city).includes(t))) s = 30;
    if (s) scored.push({ a, s: s + (a.iata ? 5 : 0), i });
  });
  return scored.sort((x, y) => y.s - x.s || x.i - y.i).slice(0, limit).map((x) => x.a);
}
