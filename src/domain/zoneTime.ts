/**
 * Local time at an airport <-> UTC, with summer time, using the browser's / server's own time-zone data (Intl).
 * Pure, so the Quote page and the server agree.
 */

/** The wall-clock date and time in `tz` at this instant. */
export function localParts(at: Date, tz: string): { date: string; time: string } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Minutes `tz` is ahead of UTC at this instant (Hong Kong: 480). */
export function offsetMinutes(at: Date, tz: string): number {
  const { date, time } = localParts(at, tz);
  const asUtc = Date.parse(`${date}T${time}:00Z`);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** The instant a local date and time in `tz` happen ("2026-12-12", "16:30", "Asia/Hong_Kong" -> 08:30 UTC). */
export function utcFromLocal(date: string, time: string, tz: string): Date {
  const guess = Date.parse(`${date}T${time}:00Z`);
  // Two passes settle summer-time changes.
  let t = guess - offsetMinutes(new Date(guess), tz) * 60000;
  t = guess - offsetMinutes(new Date(t), tz) * 60000;
  return new Date(t);
}

/** "UTC+8", "UTC-4:30", "UTC". */
export function offsetLabel(at: Date, tz: string): string {
  const m = offsetMinutes(at, tz);
  if (!m) return "UTC";
  const a = Math.abs(m);
  return `UTC${m > 0 ? "+" : "-"}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""}`;
}

/** Days between two "YYYY-MM-DD" dates (arrival the next day: 1). */
export const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
