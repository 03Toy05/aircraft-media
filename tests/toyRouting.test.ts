import { describe, expect, it } from "vitest";
import { parseRoutingLine } from "../src/domain/toyRouting";
import { parseQuoteRequest } from "../src/domain/toyShare";

const today = new Date(2026, 10, 25); // 25 Nov 2026
const legs = (line: string) => parseRoutingLine(line, today)?.legs;

describe("Toy reads a routing", () => {
  it("reads IATA or ICAO codes, date, time and passengers", () => {
    expect(legs("HKG-LHR 12 Dec 1630 8 pax")).toEqual([{ from: "VHHH", to: "EGLL", date: "2026-12-12", time: "16:30", pax: 8 }]);
    expect(legs("12/12 VHHH > EGLF 4:30pm, 8 passengers")).toEqual([{ from: "VHHH", to: "EGLF", date: "2026-12-12", time: "16:30", pax: 8 }]);
    expect(legs("Dec 3 hkg to sin dep 09:00")).toEqual([{ from: "VHHH", to: "WSSS", date: "2026-12-03", time: "09:00", pax: null }]);
    expect(legs("2027-01-05 FAB → NCE pax 4")).toEqual([{ from: "EGLF", to: "LFMN", date: "2027-01-05", time: null, pax: 4 }]);
    expect(legs("12月12日 HKG-LHR 8人")).toEqual([{ from: "VHHH", to: "EGLL", date: "2026-12-12", time: null, pax: 8 }]);
  });
  it("splits a chain into legs, the date on the first", () => {
    expect(legs("HKG-LHR-HKG 12 Dec 8 pax")).toEqual([
      { from: "VHHH", to: "EGLL", date: "2026-12-12", time: null, pax: 8 },
      { from: "EGLL", to: "VHHH", date: null, time: null, pax: 8 },
    ]);
  });
  it("takes the next such date when the year is left out, and tomorrow", () => {
    expect(legs("HKG-TPE 3 Jan")?.[0].date).toBe("2027-01-03");
    expect(legs("HKG-TPE 25/11")?.[0].date).toBe("2026-11-25");
    expect(legs("tomorrow HKG-TPE")?.[0].date).toBe("2026-11-26");
  });
  it("accepts capital codes split by a space only with a date or passengers", () => {
    expect(legs("HKG LHR 12 Dec")).toEqual([{ from: "VHHH", to: "EGLL", date: "2026-12-12", time: null, pax: null }]);
    expect(parseRoutingLine("TAG G650", today)).toBeNull();
  });
  it("reports codes it doesn't know, never guesses", () => {
    const r = parseRoutingLine("HKG-XQZQ 12 Dec", today);
    expect(r?.unknown).toEqual(["XQZQ"]);
  });
  it("leaves aircraft and words alone", () => {
    expect(parseRoutingLine("Advance aviation G280", today)).toBeNull();
    expect(parseRoutingLine("Tag aviation G650ER, EXT and cabin photos", today)).toBeNull();
  });
});

describe("A quote request with a routing", () => {
  it("keeps the routing apart from the aircraft and prices", () => {
    const q = parseQuoteRequest("Draft me a quote\nHKG-LHR 12 Dec 1630 8 pax\nG650 USD 90,000", today);
    expect(q?.what).toEqual(["G650"]);
    expect(q?.prices).toEqual(["USD 90,000"]);
    expect(q?.legs).toEqual([{ from: "VHHH", to: "EGLL", date: "2026-12-12", time: "16:30", pax: 8 }]);
  });
  it("reads the routing on the request line too", () => {
    const q = parseQuoteRequest("Quote for the G650 HKG-LHR 12 Dec 8 pax", today);
    expect(q?.what).toEqual(["G650"]);
    expect(q?.legs?.[0]).toMatchObject({ from: "VHHH", to: "EGLL", date: "2026-12-12", pax: 8 });
  });
  it("understands a plain request in English and Chinese", () => {
    expect(parseQuoteRequest("Draft me a quote", today)).toEqual({ what: [] });
    expect(parseQuoteRequest("幫我草擬報價", today)).toEqual({ what: [] });
    expect(parseQuoteRequest("帮我草拟报价", today)).toEqual({ what: [] });
  });
});
