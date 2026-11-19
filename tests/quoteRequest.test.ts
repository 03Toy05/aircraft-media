import { describe, expect, it } from "vitest";
import { parseQuoteRequest } from "../src/domain/chocksShare";
import { setup, key } from "./helpers";
import { createAircraft, createAircraftType, createOrganisation } from "../src/domain/directory";
import { converse, emptyDraft } from "../src/domain/chocks";

describe("Chocks drafts the quote from a short request", () => {
  it("fills in each price and opens the Quote page the same way", async () => {
    const t = await setup();
    const g280 = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G280", category: "super_midsize_jet" })).result.aircraftTypeId;
    const g650 = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G650ER", category: "ultra_long_range_jet" })).result.aircraftTypeId;
    const adv = (await createOrganisation(t.db, t.actor, key(), { name: "Advance Aviation" })).result.organisationId;
    const tag = (await createOrganisation(t.db, t.actor, key(), { name: "Tag Aviation" })).result.organisationId;
    const a1 = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g280, operatorId: adv, info: { yom: 2015 } })).result.aircraftId;
    const a2 = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g650, operatorId: tag })).result.aircraftId;

    const one = await converse(t.db, t.actor.tenantId, emptyDraft("q1"), "Give me Advance aviation G280 quote\nPrice at USD 90,000", []);
    expect(one.reply.copy).toContain("Price: USD 90,000");
    expect(one.draft.operatorText).toBe(""); // not mistaken for a new operator

    const two = await converse(t.db, t.actor.tenantId, emptyDraft("q2"), "Can you prepare 2 quotes?\nAdvance aviation G280 USD 90,000\nTag aviation G650ER USD 150,000\nEXT and cabin photos", []);
    expect(two.reply.options?.map((o) => o.title)).toEqual(["Gulfstream G280", "Gulfstream G650ER"]);
    expect(two.reply.copy).toContain("Price: USD 90,000");
    expect(two.reply.copy).toContain("Price: USD 150,000");
    expect(two.reply.kinds).toEqual(["exterior", "cabin"]);
    const link = new URL(two.reply.link!.href, "http://x");
    expect(link.searchParams.get("ids")).toBe(`${a1},${a2}`);
    expect(JSON.parse(link.searchParams.get("prices")!)).toEqual({ [a1]: "USD 90,000", [a2]: "USD 150,000" });
    expect(link.searchParams.get("photos")).toBe("exterior,cabin");
  });
});

describe("Quote requests over several lines, with prices and photo kinds", () => {
  it("reads a price on the next line as the aircraft's price", () => {
    expect(parseQuoteRequest("Give me Advance aviation G280 quote\nPrice at USD 90,000")).toEqual({ what: ["Advance aviation G280"], prices: ["USD 90,000"] });
  });

  it("reads one aircraft per line after a request line", () => {
    expect(parseQuoteRequest("Can you prepare 2 quotes?\nAdvance aviation G280\nTag aviation G650ER")).toEqual({ what: ["Advance aviation G280", "Tag aviation G650ER"] });
  });

  it("reads prices on the aircraft lines and under them", () => {
    expect(parseQuoteRequest("Prepare 2 quotes\nAdvance aviation G280 USD 90,000\nTag aviation G650ER\nPrice: HKD 1.2m per hour")).toEqual({
      what: ["Advance aviation G280", "Tag aviation G650ER"], prices: ["USD 90,000", "HKD 1.2m per hour"],
    });
    expect(parseQuoteRequest("Quote for the G280 at USD 90,000")).toEqual({ what: ["G280"], prices: ["USD 90,000"] });
    expect(parseQuoteRequest("G280 quote, price 85,000")).toEqual({ what: ["G280"], prices: ["85,000"] });
    expect(parseQuoteRequest("Quote\n1. G280 $90k\n2. G650ER $150k")).toEqual({ what: ["G280", "G650ER"], prices: ["$90k", "$150k"] });
  });

  it("reads which photos to send", () => {
    expect(parseQuoteRequest("Give me G280 and G550 quote with EXT and cabin photos")).toEqual({ what: ["G280", "G550"], kinds: ["exterior", "cabin"] });
    expect(parseQuoteRequest("Quote for Tag G650ER\nUSD 150,000\ncombined photo only")).toEqual({ what: ["Tag G650ER"], prices: ["USD 150,000"], kinds: ["combined"] });
    expect(parseQuoteRequest("G280 quote, floor plan and exterior")).toEqual({ what: ["G280"], kinds: ["exterior", "floor_plan"] });
    expect(parseQuoteRequest("G280 quote, no photos")).toEqual({ what: ["G280"], kinds: [] });
  });

  it("reads Chinese requests with a price", () => {
    expect(parseQuoteRequest("幫我整 CapaJet G550 嘅報價\n價錢 USD 90,000\n要外觀同客艙相片")).toEqual({ what: ["CapaJet G550"], prices: ["USD 90,000"], kinds: ["exterior", "cabin"] });
  });

  it("leaves other messages alone", () => {
    expect(parseQuoteRequest("Tag aviation\nG650ER\nYOM 2017")).toBeNull();
    expect(parseQuoteRequest("send the G550 template to Mr Chan")).toBeNull();
  });
});
