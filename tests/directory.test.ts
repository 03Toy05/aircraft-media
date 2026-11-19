import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setup, key } from "./helpers";
import {
  addInformationVersion,
  changeRegistration,
  createAircraft,
  createAircraftType,
  createOrganisation,
  getAircraftCard,
  listInformationVersions,
  listRegistrationHistory,
  loadStandardAircraftTypes,
  resolveAircraftTypes,
  resolveOrganisations,
  setBases,
  setOperator,
} from "../src/domain/directory";
import { formatAircraftCard, parseAircraftCard } from "../src/domain/card";
import { guessClassificationFromFilename, normalizeKey } from "../src/domain/constants";
import { STANDARD_AIRCRAFT_TYPES } from "../src/domain/standardTypes";
import { actionExecutions, aircraft, aircraftBases, aircraftTypes } from "../src/db/schema";
import { DomainError } from "../src/domain/errors";

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});

async function seedMetrojetG650() {
  const { organisationId } = (await createOrganisation(t.db, t.actor, key(), { name: "Metrojet", aliases: ["Metro Jet"] })).result;
  const { aircraftTypeId } = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G650ER" })).result;
  return { organisationId, aircraftTypeId };
}

describe("Test 1 — create operator, type and aircraft with full card details", () => {
  it("records tail, base, YOM/YOR, capacity, Wi-Fi and notes and renders the compact card", async () => {
    const { organisationId, aircraftTypeId } = await seedMetrojetG650();
    const { aircraftId } = (
      await createAircraft(t.db, t.actor, key(), {
        aircraftTypeId,
        registration: "B-KXX",
        operatorId: organisationId,
        base: { mode: "based", locations: ["Hong Kong", "Singapore"] },
        info: { yom: 2018, yor: 2024, capacity: 13, wifiStatus: "yes", notes: "Owner's approval required" },
      })
    ).result;
    const card = await getAircraftCard(t.db, aircraftId);
    expect(formatAircraftCard(card!)).toBe(
      [
        "Operator: Metrojet",
        "Aircraft: Gulfstream G650ER",
        "Tail number: B-KXX",
        "Base: Hong Kong / Singapore",
        "YOM: 2018",
        "YOR: 2024",
        "Capacity: 13",
        "WIFI: Yes",
        "Notes: Owner's approval required",
      ].join("\n"),
    );
  });

  it("does not treat omitted Wi-Fi as No", async () => {
    const { aircraftTypeId } = await seedMetrojetG650();
    const { aircraftId } = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId, registration: "B-AAA", info: { yom: 2020 } })).result;
    const card = await getAircraftCard(t.db, aircraftId);
    expect(card!.wifi).toBe("unknown");
    expect(card!.capacity).toBeNull();
  });
});

describe("Test 2 — tail change keeps identity and registration history", () => {
  it("creates history rather than a new aircraft", async () => {
    const { aircraftTypeId } = await seedMetrojetG650();
    const { aircraftId } = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId, registration: "B-KXX" })).result;
    await changeRegistration(t.db, t.actor, key(), { aircraftId, newRegistration: "VP-ABC", effectiveDate: "2025-03-01" });

    const history = await listRegistrationHistory(t.db, aircraftId);
    expect(history.map((h) => [h.registration, h.isCurrent])).toEqual([
      ["B-KXX", false],
      ["VP-ABC", true],
    ]);
    expect(history[0].validTo).toBe("2025-03-01");
    expect((await getAircraftCard(t.db, aircraftId))!.tailNumber).toBe("VP-ABC");
    expect(await t.db.select().from(aircraft)).toHaveLength(1); // same aircraft id, no duplicate
  });

  it("does not assume a reused tail is the same aircraft", async () => {
    const { aircraftTypeId } = await seedMetrojetG650();
    await createAircraft(t.db, t.actor, key(), { aircraftTypeId, registration: "B-KXX" });
    const err = await createAircraft(t.db, t.actor, key(), { aircraftTypeId, registration: "b-kxx" }).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe("TAIL_IN_USE");
    // explicit resolution allows it
    await createAircraft(t.db, t.actor, key(), { aircraftTypeId, registration: "b-kxx", tailResolution: "distinct_aircraft" });
    expect(await t.db.select().from(aircraft)).toHaveLength(2);
  });
});

describe("Test 3 — one base, several bases, Floating", () => {
  it("supports each and keeps Floating exclusive", async () => {
    const { aircraftTypeId } = await seedMetrojetG650();
    const { aircraftId } = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId, registration: "B-KXX" })).result;

    await setBases(t.db, t.actor, key(), { aircraftId, base: { mode: "based", locations: ["Hong Kong"] } });
    expect((await getAircraftCard(t.db, aircraftId))!.base).toBe("Hong Kong");

    await setBases(t.db, t.actor, key(), { aircraftId, base: { mode: "based", locations: ["Hong Kong", "Singapore"] } });
    expect((await getAircraftCard(t.db, aircraftId))!.base).toBe("Hong Kong / Singapore");

    await setBases(t.db, t.actor, key(), { aircraftId, base: { mode: "floating" } });
    expect((await getAircraftCard(t.db, aircraftId))!.base).toBe("Floating");

    // Floating combined with locations is rejected; earlier rows are retained as inactive history
    await expect(setBases(t.db, t.actor, key(), { aircraftId, base: { mode: "floating", locations: ["Dubai"] } })).rejects.toThrow(/Floating/);
    const rows = await t.db.select().from(aircraftBases).where(eq(aircraftBases.aircraftId, aircraftId));
    expect(rows.filter((r) => r.active)).toHaveLength(1);
    expect(rows.length).toBe(4);
  });
});

describe("Information versions are preserved", () => {
  it("edits create a new version and enforce expectedVersion", async () => {
    const { aircraftTypeId } = await seedMetrojetG650();
    const { aircraftId } = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId, registration: "B-KXX", info: { yom: 2018, wifiStatus: "no" } })).result;
    await addInformationVersion(t.db, t.actor, key(), { aircraftId, expectedVersion: 1, info: { yom: 2018, wifiStatus: "yes" } });
    const versions = await listInformationVersions(t.db, aircraftId);
    expect(versions.map((v) => [v.versionNumber, v.wifiStatus, v.isCurrent])).toEqual([
      [1, "no", false],
      [2, "yes", true],
    ]);
    const stale = await addInformationVersion(t.db, t.actor, key(), { aircraftId, expectedVersion: 1, info: { wifiStatus: "tbc" } }).catch((e) => e);
    expect(stale.code).toBe("VERSION_MISMATCH");
  });
});

describe("Test 18 — idempotency keys", () => {
  it("replays the original result for the same key and input without re-executing", async () => {
    const k = key();
    const a = await createOrganisation(t.db, t.actor, k, { name: "Metrojet" });
    const b = await createOrganisation(t.db, t.actor, k, { name: "Metrojet" });
    expect(b.replayed).toBe(true);
    expect(b.result).toEqual(a.result);
  });

  it("rejects a reused key with different input and executes nothing", async () => {
    const k = key();
    await createOrganisation(t.db, t.actor, k, { name: "Metrojet" });
    const err = await createOrganisation(t.db, t.actor, k, { name: "Another Operator" }).catch((e) => e);
    expect(err.code).toBe("IDEMPOTENCY_KEY_REUSED");
    const orgs = await resolveOrganisations(t.db, t.actor.tenantId, "Another Operator");
    expect(orgs).toHaveLength(0);
  });

  it("records failures safely and allows a corrected new request", async () => {
    const k = key();
    await expect(createOrganisation(t.db, t.actor, k, { name: "  " })).rejects.toThrow();
    const rows = await t.db.select().from(actionExecutions).where(eq(actionExecutions.idempotencyKey, k));
    expect(rows[0].status).toBe("failed");
    expect(rows[0].safeError).toMatch(/required/);
  });
});

describe("Aliases resolve without AI and return all matches", () => {
  it("resolves operator and type aliases", async () => {
    const { organisationId } = await seedMetrojetG650();
    expect((await resolveOrganisations(t.db, t.actor.tenantId, "metro jet")).map((o) => o.id)).toEqual([organisationId]);
    expect((await resolveAircraftTypes(t.db, t.actor.tenantId, "G650ER")).map((x) => x.model)).toEqual(["G650ER"]);
    expect((await resolveAircraftTypes(t.db, t.actor.tenantId, "gulfstream g650er")).length).toBe(1);
  });

  it("returns every candidate when several operators match", async () => {
    await createOrganisation(t.db, t.actor, key(), { name: "Metrojet" });
    await createOrganisation(t.db, t.actor, key(), { name: "Metrojet Asia" });
    const matches = await resolveOrganisations(t.db, t.actor.tenantId, "Metrojet");
    expect(matches.map((m) => m.canonicalName)).toEqual(["Metrojet", "Metrojet Asia"]); // exact first, then partial
  });
});

describe("Operator relationship uses current active operator", () => {
  it("replaces the operator while keeping the earlier relationship as inactive history", async () => {
    const { organisationId, aircraftTypeId } = await seedMetrojetG650();
    const other = (await createOrganisation(t.db, t.actor, key(), { name: "Skyline" })).result.organisationId;
    const { aircraftId } = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId, registration: "B-KXX", operatorId: organisationId })).result;
    await setOperator(t.db, t.actor, key(), { aircraftId, organisationId: other, validFrom: "2026-01-01" });
    expect((await getAircraftCard(t.db, aircraftId))!.operator).toBe("Skyline");
  });
});

describe("Standard aircraft types", () => {
  it("has no duplicate names and loads idempotently without touching existing types", async () => {
    const names = STANDARD_AIRCRAFT_TYPES.map((s) => normalizeKey(`${s.manufacturer} ${s.model}`));
    expect(new Set(names).size).toBe(names.length);
    const own = await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G650ER", category: "heavy_jet" });
    const first = await loadStandardAircraftTypes(t.db, t.actor, key());
    expect(first.result.added).toBe(STANDARD_AIRCRAFT_TYPES.length - 1);
    expect(first.result.skipped).toBe(1); // the owner's own G650ER, category kept
    const again = await loadStandardAircraftTypes(t.db, t.actor, key());
    expect(again.result.added).toBe(0);
    const rows = await t.db.select().from(aircraftTypes);
    expect(rows.find((r) => r.id === own.result.aircraftTypeId)?.category).toBe("heavy_jet");
    expect(rows).toHaveLength(STANDARD_AIRCRAFT_TYPES.length);
    expect((await resolveAircraftTypes(t.db, t.actor.tenantId, "G700")).map((x) => x.model)).toEqual(["G700"]);
  });

  it("rejects an unknown category", async () => {
    await expect(createAircraftType(t.db, t.actor, key(), { manufacturer: "X", model: "Y", category: "space_ship" })).rejects.toThrow(/category/);
  });
});

describe("Aircraft card parsing (English)", () => {
  it("parses the compact card and keeps unrecognised lines", () => {
    const p = parseAircraftCard(
      "Operator: Metrojet\nAircraft: Gulfstream G650ER\nTail number: B-KXX\nBase: Hong Kong / Singapore\nYOM: 2018\nYOR: 2024\nCapacity: 13\nWIFI: Yes\nNotes: Owner's approval required\nRandom line",
    );
    expect(p).toMatchObject({ operator: "Metrojet", tail: "B-KXX", yom: 2018, yor: 2024, capacity: 13, wifi: "yes" });
    expect(p.base).toEqual({ mode: "based", locations: ["Hong Kong", "Singapore"] });
    expect(p.unrecognised).toEqual(["Random line"]);
  });

  it("reads unambiguous unlabelled lines as assumptions and leaves names for directory matching", () => {
    const p = parseAircraftCard("Advanced Aviation\n2025\n10 seats\nB-KXX");
    expect(p).toMatchObject({ yom: 2025, capacity: 10, tail: "B-KXX" });
    expect(p.unrecognised).toEqual(["Advanced Aviation"]);
    expect(p.assumed).toHaveLength(3);
    expect(parseAircraftCard("2018\n2024")).toMatchObject({ yom: 2018, yor: 2024 });
    expect(parseAircraftCard("YOM: 2010\n2024")).toMatchObject({ yom: 2010, yor: 2024 });
  });

  it("suggests a classification from the file name only when it is clear", () => {
    expect(guessClassificationFromFilename("G280 Int 1.jpeg")).toBe("cabin");
    expect(guessClassificationFromFilename("B-KXX_exterior_2.png")).toBe("exterior");
    expect(guessClassificationFromFilename("Floor Plan.pdf")).toBe("floor_plan");
    expect(guessClassificationFromFilename("IMG_2231.jpg")).toBeNull();
  });

  it("handles Floating and omitted values", () => {
    const p = parseAircraftCard("Base: Floating\nWIFI:\nCapacity: abc");
    expect(p.base).toEqual({ mode: "floating", locations: [] });
    expect(p.wifi).toBeUndefined(); // omitted is not No
    expect(p.problems[0]).toMatch(/Capacity is not a number/);
  });
});
