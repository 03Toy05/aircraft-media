import { describe, expect, it } from "vitest";
import { setup } from "./helpers";
import { importLibraryPack } from "../src/domain/library";
import { fixLibraryAircraft } from "../src/domain/libraryFix";
import { findAircraftByTail, getAircraftCard } from "../src/domain/directory";
import { LIBRARY_TENANT_ID } from "../src/domain/library";

describe("Correcting library aircraft", () => {
  it("fixes a wrong type and serial so the real aircraft with that serial can come in, and fixes a tail", async () => {
    const t = await setup();
    await importLibraryPack(t.db, t.store, t.actor, { operator: "Clay Lacy Aviation, Inc.", aircraft: [{ type: "Cessna Citation Latitude", tail: "N680G", serial: "680A-0280", photos: {} }] }, new Map());
    await importLibraryPack(t.db, t.store, t.actor, { operator: "Carlisle Air Corporation", aircraft: [{ type: "Gulfstream GIV-SP", tail: "91JS", serial: "1485", photos: {} }] }, new Map());
    const before = await importLibraryPack(t.db, t.store, t.actor, { operator: "NetJets Aviation, Inc.", aircraft: [{ type: "Cessna Citation Latitude", tail: "N695QS", serial: "680A-0280", photos: {} }] }, new Map());
    expect(before.created).toBe(0); // refused: same type and serial

    await expect(fixLibraryAircraft(t.db, t.actor, { tail: "N680G", operator: "Someone Else", type: "Cessna Citation Sovereign" })).rejects.toThrow(/listed under/);
    expect(await fixLibraryAircraft(t.db, t.actor, { tail: "N680G", operator: "Clay Lacy Aviation, Inc.", type: "Cessna Citation Sovereign", serial: "680-0280" }))
      .toBe("N680G (Clay Lacy Aviation, Inc.): type → Cessna Citation Sovereign, serial 680A-0280 → 680-0280");
    const after = await importLibraryPack(t.db, t.store, t.actor, { operator: "NetJets Aviation, Inc.", aircraft: [{ type: "Cessna Citation Latitude", tail: "N695QS", serial: "680A-0280", photos: {} }] }, new Map());
    expect(after.created).toBe(1);

    expect(await fixLibraryAircraft(t.db, t.actor, { tail: "91JS", operator: "Carlisle Air Corporation", newTail: "N91JS" })).toContain("tail 91JS → N91JS");
    const [g] = await findAircraftByTail(t.db, LIBRARY_TENANT_ID, "N91JS");
    expect((await getAircraftCard(t.db, g.aircraftId))?.tailNumber).toBe("N91JS");
  });
});
