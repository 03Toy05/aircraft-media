import { describe, expect, it } from "vitest";
import { matchesWords, searchWords } from "../src/domain/searchMatch";
import { runFleetQuery } from "../src/domain/fleetQuery";
import type { CatalogueRow } from "../src/domain/catalogue";

const m = (hay: string, q: string) => matchesWords(hay, searchWords(q));

describe("Fleet search matching", () => {
  it("finds part of a name, a tail with or without the dash, and one typo in a longer word", () => {
    expect(m("Luxaviation", "lux")).toBe(true);
    expect(m("Bombardier Challenger 650 B-SHA", "bsha")).toBe(true);
    expect(m("Bombardier Challenger 650 B-SHA", "B-SHA")).toBe(true);
    expect(m("Phenix Jet", "phenix")).toBe(true);
    expect(m("Phenix Jet", "phoenix")).toBe(true);
    expect(m("Luxaviation Bombardier Global 6000", "luxaviaton global")).toBe(true);
    expect(m("Luxaviation Bombardier Global 6000", "lux g650")).toBe(false);
    expect(m("Jet Aviation", "zebra")).toBe(false);
  });
});

const row = (id: string, aircraft: string, tail: string | null, operatorId: string | null) =>
  ({ aircraftId: id, aircraftTypeId: "t", operatorId, operator: null, aircraft, tail, base: null, floating: false }) as unknown as CatalogueRow;

describe("Fleet search results", () => {
  const data = {
    orgs: [
      { id: "qe", canonicalName: "Qatar Executive", region: null },
      { id: "vj", canonicalName: "Vista Jet", region: null, aliases: ["VJ"] },
    ],
    rows: [row("a", "Gulfstream G650ER", null, "qe"), row("b", "Gulfstream G700", null, "qe"), row("c", "Bombardier Challenger 605", "9H-VCA", "vj"), row("d", "Gulfstream G650", "N1", null)],
    types: [],
    cards: new Map(),
  };
  const ids = (r: ReturnType<typeof runFleetQuery>) => [...r.groups.flatMap((g) => g.aircraft), ...r.unassigned].map((x) => x.aircraftId);

  it("shows only the aircraft that match, not the operator's whole fleet", () => {
    const r = runFleetQuery(data, { q: "g650" });
    expect(r.groups.map((g) => g.org.id)).toEqual(["qe"]);
    expect(ids(r)).toEqual(["a", "d"]);
  });

  it("an operator found by name (or other name) shows its whole fleet", () => {
    expect(ids(runFleetQuery(data, { q: "qatar" }))).toEqual(["a", "b"]);
    expect(ids(runFleetQuery(data, { q: "vj" }))).toEqual(["c"]);
  });

  it("Aircraft or Operator narrows what is searched", () => {
    expect(ids(runFleetQuery(data, { q: "qatar", in: "aircraft" }))).toEqual(["a", "b"]); // "Qatar G650" style: operator words still narrow aircraft
    expect(ids(runFleetQuery(data, { q: "qatar g700", in: "aircraft" }))).toEqual(["b"]);
    expect(runFleetQuery(data, { q: "g650", in: "operator" }).groups).toEqual([]);
  });
});
