import type { AircraftCategory } from "./constants";

/**
 * A first estimate of flight time: great-circle distance at a typical cruise speed for the aircraft's size, plus time
 * to taxi, climb and descend. No winds or routings: the broker overwrites it with the operator's figure.
 */

/** Typical cruise speed in knots, by aircraft size. */
export const CRUISE_KT: Record<AircraftCategory, number> = {
  very_light_jet: 340, light_jet: 400, midsize_jet: 430, super_midsize_jet: 450, heavy_jet: 460, ultra_long_range_jet: 480,
  executive_airliner: 450, turboprop: 270, helicopter: 130, other: 400,
};
/** Taxi, climb and descent. */
const ALLOWANCE_MIN = 20;

/** Great-circle distance in nautical miles. */
export function distanceNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated block time in minutes, rounded up to 5. */
export function estimateMinutes(a: { lat: number; lon: number }, b: { lat: number; lon: number }, category: AircraftCategory | null | undefined): number {
  const kt = CRUISE_KT[category ?? "other"] ?? CRUISE_KT.other;
  const min = (distanceNm(a, b) / kt) * 60 + ALLOWANCE_MIN;
  return Math.ceil(min / 5) * 5;
}

/** "12:45" / "12h45" / "765" -> 765 minutes; null when empty or unreadable. */
export function parseDuration(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  let m = t.match(/^(\d{1,2})\s*[:h.]\s*(\d{1,2})\s*m?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = t.match(/^(\d{1,2})\s*h$/);
  if (m) return Number(m[1]) * 60;
  m = t.match(/^(\d{1,4})\s*m?(in)?$/);
  if (m) return Number(m[1]);
  return null;
}

/** 765 -> "12:45". */
export const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
