import { describe, expect, it } from "vitest";
import { setup, key } from "./helpers";
import { createOrganisation, tidyExistingPlaces } from "../src/domain/directory";
import { organisations } from "../src/db/schema";

describe("Saving and tidying places", () => {
  it("saves HK as Hong Kong, and tidies values saved earlier", async () => {
    const t = await setup();
    const id = (await createOrganisation(t.db, t.actor, key(), { name: "Tag Aviation", region: "HK", base: "HKG, sin" })).result.organisationId;
    const [o] = await t.db.select().from(organisations);
    expect([o.id, o.region, o.base]).toEqual([id, "Hong Kong", "Hong Kong, Singapore"]);
    await t.db.update(organisations).set({ region: "hk", base: "VHHH" });
    expect(await tidyExistingPlaces(t.db, t.actor.tenantId)).toBe(1);
    const [again] = await t.db.select().from(organisations);
    expect([again.region, again.base]).toEqual(["Hong Kong", "Hong Kong"]);
    expect(await tidyExistingPlaces(t.db, t.actor.tenantId)).toBe(0);
  });
});
import { findPlace, normalizeBase, normalizeRegion, searchBases, searchRegions } from "../src/domain/places";

describe("Cities and airports (OurAirports)", () => {
  it("turns the ways people type a base into one city", () => {
    for (const typed of ["HK", "hk", "HKG", "VHHH", "Hong Kong", "hong kong", "香港"]) expect(normalizeBase(typed)).toBe("Hong Kong");
    expect(normalizeBase("SIN")).toBe("Singapore");
    expect(normalizeBase("EGKB")).toBe("London"); // Biggin Hill
    expect(normalizeBase("澳門")).toBe(findPlace("MFM")!.label);
    expect(normalizeBase("Floating")).toBe("Floating");
    expect(normalizeBase("Some private strip")).toBe("Some private strip"); // unknown: kept as typed
  });

  it("turns regions into a world region, country or city", () => {
    expect(normalizeRegion("HK")).toBe("Hong Kong");
    expect(normalizeRegion("Hong Kong")).toBe("Hong Kong");
    expect(normalizeRegion("香港")).toBe("Hong Kong");
    expect(normalizeRegion("asia")).toBe("Asia");
    expect(normalizeRegion("Middle-East")).toBe("Middle East");
    expect(normalizeRegion("Singapore")).toBe("Singapore");
    expect(normalizeRegion("Shanghai")).toBe("Shanghai");
  });

  it("suggests cities with their IATA and ICAO codes", () => {
    const hk = searchBases("hk")[0];
    expect(hk.value).toBe("Hong Kong");
    expect(hk.detail).toContain("HKG / VHHH");
    expect(searchBases("lond")[0].value).toBe("London");
    expect(searchRegions("mid")[0].value).toBe("Middle East");
    expect(searchRegions("hk")[0]).toEqual({ value: "Hong Kong", detail: "Country or territory" });
  });
});
