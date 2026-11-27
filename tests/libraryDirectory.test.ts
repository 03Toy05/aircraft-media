import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setup } from "./helpers";
import { LIBRARY_TENANT_ID, addToWorkspace, directoryLibraryAircraft, importLibraryPack, readyLibraryAircraft, readyLibraryOperators } from "../src/domain/library";
import { aircraft } from "../src/db/schema";
import { createAircraftType } from "../src/domain/directory";

describe("The library's directory (aircraft known by their details only)", () => {
  it("imports aircraft without photos, with their serial numbers, and keeps them apart from the ready library", async () => {
    const t = await setup();
    const r = await importLibraryPack(t.db, t.store, t.actor, {
      operator: "Jet Linx Aviation, LLC", region: "North America",
      aircraft: [
        { type: "Cessna Citation Latitude", tail: "N311VU", serial: "680A-0022", photos: {} },
        { type: "Pilatus PC-12 NGX", tail: "N212XX", serial: "1418", photos: {} },
      ],
    }, new Map());
    expect(r.created).toBe(2);
    expect(r.skipped).toEqual([]);
    const lib = await t.db.select().from(aircraft).where(eq(aircraft.tenantId, LIBRARY_TENANT_ID));
    expect(lib.map((a) => a.serialNumber).sort()).toEqual(["1418", "680A-0022"]);

    const dir = await directoryLibraryAircraft(t.db);
    expect(dir.size).toBe(2);
    expect((await readyLibraryAircraft(t.db)).size).toBe(0);
    expect((await readyLibraryOperators(t.db)).size).toBe(0); // no photos: not among the operators to choose between

    // Added to a broker's workspace: the details and the serial come along.
    const latitude = lib.find((a) => a.serialNumber === "680A-0022")!;
    await createAircraftType(t.db, t.actor, "k-type", { manufacturer: "Cessna", model: "Citation Latitude", category: "midsize_jet" });
    const added = await addToWorkspace(t.db, t.store, t.actor, latitude.id);
    const [copy] = await t.db.select().from(aircraft).where(eq(aircraft.id, added.aircraftId));
    expect(copy.tenantId).toBe(t.actor.tenantId);
    expect(copy.serialNumber).toBe("680A-0022");
    expect(added.photos).toBe(0);
  });
});
