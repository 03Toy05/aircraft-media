import type { PdfQuote } from "./quotePdf";

/** A made-up quote (two aircraft, a return trip) to show a broker their own layout filled in. */
export function sampleLayoutQuote(email: string, now = new Date()): PdfQuote {
  const day = (d: number) => new Date(now.getTime() + d * 86400000).toISOString().slice(0, 10);
  const opt = (type: string, price: string, capacity: number, yom: number, yor: number | null) => ({
    aircraftId: type, type, operator: null, tail: null, base: null, yom, yor, capacity, price, extra: "", wifi: "yes", smoking: "no", pets: "yes", notes: null, photos: [],
  });
  return {
    reference: "SAMPLE", version: 1, savedAt: now, broker: { name: "", email },
    quote: {
      lang: "en", text: "", builder: { inc: {} }, greeting: "Dear Mr Chan,", closing: "Please let me know if you would like more details.",
      legs: [{ from: "VHHH", to: "RJTT", date: day(14), time: "10:00", flight: 240, pax: 6 }, { from: "RJTT", to: "VHHH", date: day(18), time: "15:30", flight: 270, pax: 6 }],
      options: [opt("Gulfstream G650ER", "USD 128,000", 13, 2019, 2023), opt("Bombardier Global 6000", "USD 104,000", 14, 2015, null)],
    },
  };
}
