import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { setup, makeImage } from "./helpers";
import { getCatalogue } from "../src/domain/catalogue";
import { getAircraftCard } from "../src/domain/directory";
import { getLineup } from "../src/domain/media";
import { LIBRARY_TENANT_ID, importLibraryPack, isMaskedTail, type LibraryPack } from "../src/domain/library";

describe("Library import", () => {
  it("treats brochure tails like VP-CXX as hidden", () => {
    expect(isMaskedTail("VP-CXX")).toBe(true);
    expect(isMaskedTail("T7-GXXX*")).toBe(true);
    expect(isMaskedTail("T7-2XX")).toBe(true);
    expect(isMaskedTail("9H-MAS")).toBe(false);
    expect(isMaskedTail("B-LXX")).toBe(true);
    expect(isMaskedTail(null)).toBe(false);
  });

  it("loads a fleet, keeps same-type aircraft apart by base, and does not duplicate on a second run", async () => {
    const t = await setup();
    const files = new Map<string, Uint8Array>();
    const names = ["a-ext", "a-c1", "a-c2", "a-fp", "b-ext", "b-c1", "b-c2", "b-fp", "c-c1"];
    for (const [i, n] of names.entries()) files.set(`${n}.png`, await makeImage(500, 300, 900 + i));
    const pack: LibraryPack = {
      operator: "TAG Aviation", region: "Asia",
      aircraft: [
        { type: "Gulfstream G650ER", tail: "VP-CXX", base: ["Singapore"], yom: 2019, capacity: 16, wifi: "yes", smoking: "no", pets: "no",
          photos: { exterior: ["a-ext.png"], cabin: ["a-c1.png", "a-c2.png"], floor_plan: ["a-fp.png"] } },
        { type: "Gulfstream G650ER", tail: "VP-CXX", base: ["Hong Kong", "China"], yom: 2018, capacity: 16,
          photos: { exterior: ["b-ext.png"], cabin: ["b-c1.png", "b-c2.png"], floor_plan: ["b-fp.png"] } },
        { type: "Gulfstream G280", base: ["Hong Kong"], photos: { cabin: ["c-c1.png", "missing.png"] } },
      ],
    };
    const r = await importLibraryPack(t.db, t.store, t.actor, pack, files);
    expect(r).toMatchObject({ created: 3, matched: 0, photos: 9 });
    expect(r.skipped.join()).toContain("missing.png");
    const rows = await getCatalogue(t.db, LIBRARY_TENANT_ID);
    expect(rows).toHaveLength(3);
    expect(rows.map((x) => x.tail ?? "-").sort()).toEqual(["-", "VP-CXX", "VP-CXX"]);
    const sg = rows.find((x) => x.base?.includes("Singapore"))!;
    const card = await getAircraftCard(t.db, sg.aircraftId);
    expect(card).toMatchObject({ yom: 2019, capacity: 16, wifi: "yes", smoking: "no", pets: "no" });
    const lineup = await getLineup(t.db, { aircraftId: sg.aircraftId, aircraftTypeId: sg.aircraftTypeId });
    expect(lineup.map((p) => p.classification).sort()).toEqual(["cabin", "cabin", "combined", "exterior", "floor_plan"]);

    const again = await importLibraryPack(t.db, t.store, t.actor, pack, files);
    expect(again).toMatchObject({ created: 0, matched: 3, photos: 0 });
    expect(await getCatalogue(t.db, LIBRARY_TENANT_ID)).toHaveLength(3);
  }, 60_000);

  it("loads every pack in library-packs as it is on disk", async () => {
    let packs: string[];
    try { packs = readdirSync("library-packs"); } catch { return; } // the packs are local only
    for (const name of packs) {
      const dir = `library-packs/${name}`;
      const t = await setup();
      const pack = JSON.parse(readFileSync(`${dir}/pack.json`, "utf8")) as LibraryPack;
      const files = new Map(readdirSync(dir).filter((n) => n.endsWith(".jpg")).map((n) => [n, new Uint8Array(readFileSync(`${dir}/${n}`))]));
      const r = await importLibraryPack(t.db, t.store, t.actor, pack, files);
      expect(r.skipped, name).toEqual([]);
      expect(r.created, name).toBe(pack.aircraft.length);
      expect(r.photos, name).toBe(files.size);
    }
  }, 120_000);
});
