import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setup } from "./helpers";
import { airportsFor, findAirport, searchAirports } from "../src/domain/airports";
import { offsetLabel, utcFromLocal } from "../src/domain/zoneTime";
import { estimateMinutes, parseDuration } from "../src/domain/flightTime";
import { cleanLegs, legTimes, requestLabel, routeLabel, routingKey, routingLines, type Leg } from "../src/domain/routing";
import { QUOTE_WORDS } from "../src/domain/quote";
import { RoutingChanged, cleanSnapshot, getRequest, listRequests, listVersions, nextReference, saveQuoteVersion, setArchived } from "../src/domain/requests";

const legs: Leg[] = [
  { from: "HKG", to: "EGLF", date: "2026-12-12", time: "16:30", flight: 765, pax: 4 },
  { from: "FAB", to: "VHHH", date: "2026-12-18", time: "10:00", flight: 720, pax: 4 },
];
const snap = (price: string) => ({
  lang: "en", text: `Hello\n\nAircraft: G650\nPrice: ${price}`,
  options: [{ aircraftId: randomUUID(), type: "Gulfstream G650", operator: "Alpha", tail: "OE-AAA", base: "Vienna", yom: 2016, yor: null, capacity: 14, price, extra: "", photos: [{ id: randomUUID(), label: "EXT 1", classification: "exterior" }, { id: "../etc", label: "x", classification: "x" }] }],
  builder: { ids: ["x"], lang: "en" },
});

describe("Airports", () => {
  it("finds an airport by ICAO, IATA, label or city", () => {
    expect(findAirport("VHHH")?.iata).toBe("HKG");
    expect(findAirport("hkg")?.icao).toBe("VHHH");
    expect(findAirport("Farnborough (FAB)")?.icao).toBe("EGLF");
    expect(findAirport("ZZZZ")).toBeNull();
    expect(findAirport("")).toBeNull();
    expect(searchAirports("farnb").map((a) => a.icao)).toContain("EGLF");
    expect(searchAirports("EGLF")[0].icao).toBe("EGLF");
    expect(searchAirports("x")).toEqual([]);
  });
});

describe("Local and UTC times", () => {
  it("turns local times into UTC with summer time, and estimates flight time", () => {
    expect(utcFromLocal("2026-12-12", "16:30", "Asia/Hong_Kong").toISOString()).toBe("2026-12-12T08:30:00.000Z");
    expect(utcFromLocal("2026-07-01", "12:00", "Europe/London").toISOString()).toBe("2026-07-01T11:00:00.000Z"); // BST
    expect(utcFromLocal("2026-01-15", "12:00", "Europe/London").toISOString()).toBe("2026-01-15T12:00:00.000Z"); // GMT
    expect(offsetLabel(new Date("2026-12-12T08:30:00Z"), "Asia/Hong_Kong")).toBe("UTC+8");
    expect(offsetLabel(new Date("2026-12-12T08:30:00Z"), "Asia/Kolkata")).toBe("UTC+5:30");

    const hkg = findAirport("VHHH")!, fab = findAirport("EGLF")!;
    const heavy = estimateMinutes(hkg, fab, "heavy_jet");
    expect(heavy).toBeGreaterThan(650);
    expect(heavy).toBeLessThan(760);
    expect(heavy % 5).toBe(0);
    expect(estimateMinutes(hkg, fab, "light_jet")).toBeGreaterThan(heavy); // a slower aircraft takes longer

    expect(parseDuration("12:45")).toBe(765);
    expect(parseDuration("12h45")).toBe(765);
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("95")).toBe(95);
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
  });
});

describe("Routing", () => {
  it("checks legs, stores ICAO codes, and works out arrival times", () => {
    const clean = cleanLegs([...legs, { from: "", to: "" }], findAirport);
    expect(clean.map((l) => `${l.from}-${l.to}`)).toEqual(["VHHH-EGLF", "EGLF-VHHH"]); // an empty row is dropped
    expect(() => cleanLegs([], findAirport)).toThrow("at least one leg");
    expect(() => cleanLegs([{ from: "HKG", to: "" }], findAirport)).toThrow("Leg 1");
    expect(() => cleanLegs([{ from: "HKG", to: "QQQQ" }], findAirport)).toThrow("QQQQ");
    expect(() => cleanLegs([{ from: "HKG", to: "VHHH" }], findAirport)).toThrow("same airport");
    expect(() => cleanLegs([{ from: "HKG", to: "FAB", time: "25:00" }], findAirport)).toThrow("time");
    expect(() => cleanLegs([{ from: "HKG", to: "FAB", flight: 2 }], findAirport)).toThrow("flight time");

    const ap = airportsFor(clean.flatMap((l) => [l.from, l.to]));
    const t = legTimes(clean[0], ap);
    expect(t.depUtc).toEqual({ date: "2026-12-12", time: "08:30" });
    expect(t.arrUtc).toEqual({ date: "2026-12-12", time: "21:15" });
    expect(t.arrLocal).toEqual({ date: "2026-12-12", time: "21:15" }); // London is on UTC in December
    expect(t.arrDays).toBe(0);
    const late = legTimes({ ...clean[0], time: "23:00" }, ap);
    expect(late.arrLocal).toEqual({ date: "2026-12-13", time: "03:45" });
    expect(late.arrDays).toBe(1);

    expect(routeLabel(clean, ap)).toBe("HKG → FAB → HKG");
    expect(requestLabel(clean, ap)).toBe("HKG → FAB → HKG · 12 Dec – 18 Dec · 4 pax");
    const text = routingLines(clean, ap, QUOTE_WORDS.en, "en-GB");
    expect(text).toContain("Routing:\nHong Kong (HKG) → Farnborough (FAB)\n12 Dec 2026 · Dep 16:30 LT (08:30 UTC) · Arr 21:15 LT (21:15 UTC) · 12h 45m · 4 pax");
    expect(routingLines(clean, ap, QUOTE_WORDS.en, "en-GB", { utc: false })).not.toContain("UTC");
    expect(routingLines([clean[0]], ap, QUOTE_WORDS["zh-Hant"], "zh-HK")).toContain("出發 16:30 當地時間 (08:30 UTC)");
    expect(routingKey(clean)).toBe(routingKey(clean.map((l) => ({ ...l, time: "09:00", pax: 6, flight: 700 })))); // times and pax may change
    expect(routingKey(clean)).not.toBe(routingKey([{ ...clean[0], date: "2026-12-13" }, clean[1]]));
  });
});

describe("Requests and saved quotes", () => {
  it("makes the request on the first save, then keeps versions under the same airports and dates", async () => {
    const t = await setup();
    expect(await nextReference(t.db, t.actor.tenantId, new Date("2026-12-01T00:00:00Z"))).toBe("AM-2612-001");

    const first = await saveQuoteVersion(t.db, t.actor, null, legs, cleanSnapshot(snap("USD 95,000")));
    expect(first.version).toBe(1);
    expect(first.reference).toMatch(/^AM-\d{4}-001$/);
    // Later departure and two more passengers: the next version of the same request.
    const moved = legs.map((l) => ({ ...l, time: "18:00", pax: 6 }));
    const second = await saveQuoteVersion(t.db, t.actor, first.requestId, moved, cleanSnapshot(snap("USD 89,000")));
    expect(second).toMatchObject({ requestId: first.requestId, version: 2 });
    expect((await getRequest(t.db, t.actor.tenantId, first.requestId))?.legs[0]).toMatchObject({ from: "VHHH", time: "18:00", pax: 6 });

    // Another date is another request.
    await expect(saveQuoteVersion(t.db, t.actor, first.requestId, [{ ...legs[0], date: "2026-12-13" }, legs[1]], cleanSnapshot(snap("x")))).rejects.toBeInstanceOf(RoutingChanged);

    const vs = await listVersions(t.db, t.actor.tenantId, first.requestId);
    expect(vs.map((v) => v.version)).toEqual([2, 1]);
    expect(vs[0].content.options[0].price).toBe("USD 89,000");
    expect(vs[0].content.legs[0]).toMatchObject({ time: "18:00", pax: 6 }); // each version keeps its own times
    expect(vs[1].content.legs[0]).toMatchObject({ time: "16:30", pax: 4 });
    expect(vs[0].content.options[0].photos).toHaveLength(1); // a bad photo id is dropped

    const list = await listRequests(t.db, t.actor.tenantId);
    expect(list[0]).toMatchObject({ versions: 2, label: "HKG → FAB → HKG · 12 Dec – 18 Dec · 6 pax" });
    expect((await listRequests(t.db, t.actor.tenantId, { q: "fab" })).length).toBe(1);
    await setArchived(t.db, t.actor, first.requestId, true);
    expect(await listRequests(t.db, t.actor.tenantId)).toEqual([]);

    // Someone else's workspace can't see it or save into it.
    const other = { id: randomUUID(), tenantId: randomUUID() };
    expect(await getRequest(t.db, other.tenantId, first.requestId)).toBeNull();
    await expect(saveQuoteVersion(t.db, other, first.requestId, legs, cleanSnapshot(snap("x")))).rejects.toThrow("no longer here");
  });

  it("refuses an empty or oversized quote", () => {
    expect(() => cleanSnapshot({ text: "", options: [] })).toThrow("empty");
    expect(() => cleanSnapshot({ text: "x", options: [] })).toThrow("at least one aircraft");
    expect(() => cleanSnapshot({ ...snap("x"), builder: { big: "x".repeat(400_000) } })).toThrow("too large");
  });
});
