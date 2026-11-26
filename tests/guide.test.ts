import { describe, expect, it } from "vitest";
import { setup, key } from "./helpers";
import { createAircraft, createAircraftType, createOrganisation } from "../src/domain/directory";
import { converse, emptyDraft } from "../src/domain/toy";
import { isNewToQuotes, sampleAircraft, sampleQuoteText } from "../src/domain/guide";
import { recordQuoteShare } from "../src/domain/quoteShares";

describe("Getting started", () => {
  it("makes the sample quote from a real aircraft, and it gives a quote", async () => {
    const t = await setup();
    expect(await sampleAircraft(t.db, t.actor.tenantId, null)).toBeNull();
    expect(sampleQuoteText(null, new Date("2026-11-26T00:00:00Z"))).toBe("G650 quote HKG-NRT 10 Dec 4 pax USD 120k");

    const f7x = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Dassault", model: "Falcon 7X", category: "heavy_jet" })).result.aircraftTypeId;
    const lux = (await createOrganisation(t.db, t.actor, key(), { name: "Luxaviation" })).result.organisationId;
    for (const reg of ["OO-FSX", "OO-AIE"]) await createAircraft(t.db, t.actor, key(), { aircraftTypeId: f7x, registration: reg, operatorId: lux });

    const a = await sampleAircraft(t.db, t.actor.tenantId, null);
    expect(a?.words).toMatch(/^Luxaviation Falcon 7X OO-(FSX|AIE)$/);
    const text = sampleQuoteText(a, new Date("2026-11-26T00:00:00Z"));
    const r = await converse(t.db, t.actor.tenantId, emptyDraft("g1"), text, []);
    expect(r.reply.copy).toContain("Price: USD 120k"); // one aircraft, no "which one?" question
    expect(r.draft.quote?.legs?.[0]).toMatchObject({ from: "VHHH", to: "RJAA", pax: 4 });
  });

  it("knows who hasn't made a quote yet", async () => {
    const t = await setup();
    expect(await isNewToQuotes(t.db, t.actor.tenantId)).toBe(true);
    await recordQuoteShare(t.db, t.actor, { quoteKey: "q1", how: "copy", options: 1 });
    expect(await isNewToQuotes(t.db, t.actor.tenantId)).toBe(false);
  });
});
