// Builds src/data/places.json from OurAirports (public domain): cities with large/medium airports, plus their IATA/ICAO codes.
// Usage: node build-places.mjs <airports.csv> <countries.csv> <out.json>
import fs from "node:fs";

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const [, , airportsPath, countriesPath, outPath] = process.argv;
const countries = new Map(parseCsv(fs.readFileSync(countriesPath, "utf8")).map((c) => [c.code, c.name]));
const airports = parseCsv(fs.readFileSync(airportsPath, "utf8"));

// Airports whose OurAirports town is not the city brokers say (by IATA code).
const CITY_FIX = { MFM: "Macau", STN: "London", LTN: "London", SEN: "London", FAB: "Farnborough", DWC: "Dubai", PKX: "Beijing", NAY: "Beijing", PVG: "Shanghai", SHA: "Shanghai", HND: "Tokyo", NRT: "Tokyo", KIX: "Osaka", ITM: "Osaka", ICN: "Seoul", GMP: "Seoul", BKK: "Bangkok", DMK: "Bangkok", CGK: "Jakarta", HLP: "Jakarta", SZB: "Kuala Lumpur", KUL: "Kuala Lumpur", XSP: "Singapore", TSA: "Taipei", TPE: "Taipei" };

const byCity = new Map();
for (const a of airports) {
  if (a.type !== "large_airport" && a.type !== "medium_airport") continue;
  const city = (CITY_FIX[a.iata_code] ?? a.municipality).trim();
  const icao = (a.icao_code || (/^[A-Z]{4}$/.test(a.gps_code) ? a.gps_code : "")).trim();
  const iata = a.iata_code.trim();
  if (!city || (!icao && !iata)) continue;
  const key = `${city}|${a.iso_country}`;
  if (!byCity.has(key)) byCity.set(key, { city, cc: a.iso_country, country: countries.get(a.iso_country) ?? a.iso_country, large: 0, airports: [] });
  const c = byCity.get(key);
  if (a.type === "large_airport") c.large++;
  // Keywords sometimes hold other names (local script, old names): kept for searching only.
  const kw = a.keywords.split(",").map((s) => s.trim()).filter((s) => s && s.length <= 40);
  c.airports.push({ name: a.name, iata, icao, large: a.type === "large_airport", kw });
}

const out = [...byCity.values()]
  .sort((x, y) => y.large - x.large || y.airports.length - x.airports.length || x.city.localeCompare(y.city))
  .map((c) => ({
    c: c.city,
    k: c.cc,
    n: c.country,
    a: c.airports.sort((x, y) => Number(y.large) - Number(x.large)).map((a) => [a.iata, a.icao, a.name]),
    w: [...new Set(c.airports.flatMap((a) => a.kw))].slice(0, 6),
  }));
fs.writeFileSync(outPath, JSON.stringify({ source: "OurAirports (public domain), https://ourairports.com/data/", built: new Date().toISOString().slice(0, 10), places: out }));
console.log(`${out.length} cities, ${out.reduce((s, c) => s + c.a.length, 0)} airports, ${(fs.statSync(outPath).size / 1024).toFixed(0)} KB`);
console.log(JSON.stringify(out.filter((c) => /Hong Kong|Macau|Singapore|London|Teterboro|New York/.test(c.c)).slice(0, 6)));
