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

describe("Several aircraft with operators and prices", () => {
  const two = { what: ["Phenix Jet Global 7500", "Tag Aviation G650ER"], prices: ["USD 248,000", "USD 230,000"] };
  it("one per line, numbered or not", () => {
    expect(parseQuoteRequest("Quote please\n1. Phenix Jet Global 7500 - USD 248,000\n2. Tag Aviation G650ER - USD 230,000", today)).toEqual(two);
  });
  it("labelled, on one line or several", () => {
    expect(parseQuoteRequest("Can you prepare 2 quotes?\nOperator: Phenix Jet, Aircraft: Global 7500, Price: USD 248,000\nOperator: Tag Aviation, Aircraft: G650ER, Price: USD 230,000", today)).toEqual(two);
    expect(parseQuoteRequest("Quote\nOperator: Phenix Jet\nAircraft: Global 7500\nPrice: USD 248,000\nOperator: Tag Aviation\nAircraft: G650ER\nPrice: USD 230,000", today)).toEqual(two);
  });
  it("several on one line", () => {
    expect(parseQuoteRequest("Quote: Phenix Jet Global 7500 USD 248,000, Tag Aviation G650ER USD 230,000", today)).toEqual(two);
  });
  it("the chat's quote template, blank lines skipped (English and Chinese)", () => {
    const en = "Quote\nLeg 1 – Date: 12 Dec | From: HKG | To: LHR | Time: 1630 | Pax: 8\nLeg 2 – Date:  | From:  | To:  | Time:  | Pax: \nOption 1 – Operator: Phenix Jet | Aircraft: Global 7500 | Price: USD 248,000\nOption 2 – Operator: Tag Aviation | Aircraft: G650ER | Price: USD 230,000";
    expect(parseQuoteRequest(en, today)).toEqual({ ...two, legs: [{ from: "VHHH", to: "EGLL", date: "2026-12-12", time: "16:30", pax: 8 }] });
    const zh = "報價\n航段1 – 日期：12月12日｜出發：HKG｜到達：LHR｜時間：1630｜乘客：8\n選項1 – 營運商：Phenix Jet｜飛機：Global 7500｜價格：USD 248,000\n選項2 – 營運商： ｜飛機： ｜價格： ";
    expect(parseQuoteRequest(zh, today)).toEqual({ what: ["Phenix Jet Global 7500"], prices: ["USD 248,000"], legs: [{ from: "VHHH", to: "EGLL", date: "2026-12-12", time: "16:30", pax: 8 }] });
  });
});

describe("The routing before the request (a broker's real message)", () => {
  it("reads the legs, the pax line for every leg, then the aircraft and prices", () => {
    const msg = "21/Dec HKG-PEK ETD 1200L\n23/Dec PEK-CTS ETD 1200L\n27/Dec CTS-HKG ETD 1900L\n8 pax\n\nDraft me quote for\nVistaJet CL605 USD 115k\nQatar Executive G650ER USD 250k";
    expect(parseQuoteRequest(msg, today)).toEqual({
      what: ["VistaJet CL605", "Qatar Executive G650ER"],
      prices: ["USD 115k", "USD 250k"],
      legs: [
        { from: "VHHH", to: "ZBAA", date: "2026-12-21", time: "12:00", pax: 8 },
        { from: "ZBAA", to: "RJCC", date: "2026-12-23", time: "12:00", pax: 8 },
        { from: "RJCC", to: "VHHH", date: "2026-12-27", time: "19:00", pax: 8 },
      ],
    });
  });
  it("is not a quote without a request, and the add-aircraft template stays an aircraft", () => {
    expect(parseQuoteRequest("HKG-LHR 12 Dec\n8 pax", today)).toBeNull();
    expect(parseQuoteRequest("Operator: Tag Aviation\nAircraft type: G650", today)).toBeNull();
  });
});
