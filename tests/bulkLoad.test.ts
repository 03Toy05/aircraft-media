import { describe, expect, it } from "vitest";
import { setup, makeImage } from "./helpers";
import { getCatalogue } from "../src/domain/catalogue";
import { getAircraftCard, getAircraftCards } from "../src/domain/directory";
import { getLineup, getLineups } from "../src/domain/media";
import { LIBRARY_TENANT_ID, importLibraryPack, type LibraryPack } from "../src/domain/library";

describe("Loading many aircraft at once", () => {
  it("gives every aircraft the same details and photos as loading it alone", async () => {
    const t = await setup();
    const files = new Map<string, Uint8Array>();
    const names = ["a-ext", "a-c1", "a-fp", "b-ext", "b-c1", "b-c2", "plan"];
    for (const [i, n] of names.entries()) files.set(`${n}.png`, await makeImage(500, 300, 700 + i));
    const pack: LibraryPack = {
      operator: "Bulk Air", region: "Europe",
      aircraft: [
        { type: "Gulfstream G650ER", tail: "OE-AAA", base: ["Vienna", "Geneva"], yom: 2016, capacity: 14, wifi: "yes", pets: "no",
          photos: { exterior: ["a-ext.png"], cabin: ["a-c1.png"], floor_plan: ["a-fp.png"] } },
        { type: "Gulfstream G650ER", tail: "OE-BBB", floating: true, yom: 2019, photos: { exterior: ["b-ext.png"], cabin: ["b-c1.png", "b-c2.png"], floor_plan: ["plan.png"] } },
        { type: "Cessna Citation XLS", base: ["Vienna"], capacity: 8, photos: {} },
      ],
    };
    await importLibraryPack(t.db, t.store, t.actor, pack, files);
    const rows = await getCatalogue(t.db, LIBRARY_TENANT_ID);
    expect(rows).toHaveLength(3);

    const cards = await getAircraftCards(t.db, [...rows.map((r) => r.aircraftId), rows[0].aircraftId, "00000000-0000-0000-0000-000000000000"]);
    const lineups = await getLineups(t.db, rows.map((r) => ({ aircraftId: r.aircraftId, aircraftTypeId: r.aircraftTypeId })));
    for (const r of rows) {
      expect(cards.get(r.aircraftId)).toEqual(await getAircraftCard(t.db, r.aircraftId));
      expect(lineups.get(r.aircraftId)).toEqual(await getLineup(t.db, { aircraftId: r.aircraftId, aircraftTypeId: r.aircraftTypeId }));
    }
    expect(cards.size).toBe(3); // an unknown id is simply left out
    expect(lineups.get(rows.find((r) => r.tail === "OE-BBB")!.aircraftId)!.length).toBeGreaterThanOrEqual(4);
    expect(await getAircraftCards(t.db, [])).toEqual(new Map());
    expect(await getLineups(t.db, [])).toEqual(new Map());
  }, 60_000);
});
