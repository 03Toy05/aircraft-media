import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { setup, makeImage } from "./helpers";
import { getCatalogue } from "../src/domain/catalogue";
import { getAircraftCard } from "../src/domain/directory";
import { getLineup, ingestUpload, retireMedia } from "../src/domain/media";
import { randomUUID } from "node:crypto";
import { users } from "../src/db/schema";
import { LIBRARY_TENANT_ID, addingNow, copiedLibraryAircraft, importLibraryPack, isMaskedTail, queueAdds, type LibraryPack } from "../src/domain/library";

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

  it("adds library aircraft in the background, once each, one after another", async () => {
    const t = await setup();
    const files = new Map<string, Uint8Array>();
    for (const [i, n] of ["e", "c1", "c2", "f"].entries()) files.set(`${n}.png`, await makeImage(400, 300, 950 + i));
    const pack: LibraryPack = { operator: "VistaJet", aircraft: [
      { type: "Bombardier Challenger 350", photos: { exterior: ["e.png"], cabin: ["c1.png", "c2.png"], floor_plan: ["f.png"] } },
      { type: "Bombardier Challenger 300", photos: { cabin: ["c1.png"] } },
    ] };
    await importLibraryPack(t.db, t.store, t.actor, pack, files);
    const ids = (await getCatalogue(t.db, LIBRARY_TENANT_ID)).map((r) => r.aircraftId);
    const tenantId = randomUUID();
    const [u] = await t.db.insert(users).values({ tenantId, email: "broker3@example.test", displayName: "Broker 3" }).returning({ id: users.id });
    const broker = { id: u.id, tenantId };

    const first = queueAdds(t.db, t.store, broker, ids);
    const again = queueAdds(t.db, t.store, broker, ids); // pressed twice
    expect(first.queued).toHaveLength(2);
    expect(again.queued).toHaveLength(0);
    expect(addingNow(tenantId).size).toBe(2);
    await Promise.all([first.done, again.done]);
    expect(addingNow(tenantId).size).toBe(0);
    expect((await copiedLibraryAircraft(t.db, tenantId)).size).toBe(2);
    const mine = await getCatalogue(t.db, tenantId);
    expect(mine).toHaveLength(2);
    expect(new Set(mine.map((r) => r.operatorId)).size).toBe(1); // one VistaJet, not two
  }, 60_000);

  it("adds two aircraft that share a hidden tail as two, each with its own photos", async () => {
    const t = await setup();
    const files = new Map<string, Uint8Array>();
    for (const [i, n] of ["sg-e", "sg-c1", "sg-f", "hk-c1", "hk-c2", "hk-f"].entries()) files.set(`${n}.png`, await makeImage(400, 300, 970 + i));
    await importLibraryPack(t.db, t.store, t.actor, { operator: "TAG Aviation", aircraft: [
      { type: "Gulfstream G650ER", tail: "VP-CXX", base: ["Hong Kong", "China"], yom: 2018, photos: { cabin: ["hk-c1.png", "hk-c2.png"], floor_plan: ["hk-f.png"] } },
      { type: "Gulfstream G650ER", tail: "VP-CXX", base: ["Singapore"], yom: 2019, photos: { exterior: ["sg-e.png"], cabin: ["sg-c1.png"], floor_plan: ["sg-f.png"] } },
    ] }, files);
    const lib = await getCatalogue(t.db, LIBRARY_TENANT_ID);
    const tenantId = randomUUID();
    const [u] = await t.db.insert(users).values({ tenantId, email: "broker4@example.test", displayName: "Broker 4" }).returning({ id: users.id });
    const broker = { id: u.id, tenantId };
    await queueAdds(t.db, t.store, broker, lib.map((r) => r.aircraftId)).done;

    const mine = await getCatalogue(t.db, tenantId);
    expect(mine).toHaveLength(2);
    expect((await copiedLibraryAircraft(t.db, tenantId)).size).toBe(2);
    for (const r of mine) {
      const card = await getAircraftCard(t.db, r.aircraftId);
      const kinds = (await getLineup(t.db, { aircraftId: r.aircraftId, aircraftTypeId: r.aircraftTypeId })).map((p) => p.classification).sort();
      if (card?.yom === 2018) expect(kinds).toEqual(["cabin", "cabin", "floor_plan"]);
      else expect(kinds).toEqual(["cabin", "exterior", "floor_plan"]);
    }
  }, 60_000);

  it("puts a real tail on the aircraft the library knew by a hidden one, instead of adding another", async () => {
    const t = await setup();
    const files = new Map<string, Uint8Array>([["c.png", await makeImage(400, 300, 990)]]);
    const g650 = (tail: string, base: string, yom: number) => ({ type: "Gulfstream G650ER", tail, base: [base], yom, photos: { cabin: ["c.png"] } });
    await importLibraryPack(t.db, t.store, t.actor, { operator: "TAG Aviation", aircraft: [g650("VP-CXX", "Hong Kong", 2018), g650("VP-CXX", "Singapore", 2019)] }, files);
    const r = await importLibraryPack(t.db, t.store, t.actor, { operator: "TAG Aviation", aircraft: [g650("VP-CXX", "Hong Kong", 2018), g650("VP-CTL", "Singapore", 2019)] }, files);
    expect(r).toMatchObject({ created: 0, matched: 2 });
    expect(r.retailed).toEqual(["Gulfstream G650ER (Singapore): VP-CXX is now VP-CTL"]);
    const tails = (await getCatalogue(t.db, LIBRARY_TENANT_ID)).map((x) => `${x.tail} ${x.base}`).sort();
    expect(tails).toEqual(["VP-CTL Singapore", "VP-CXX Hong Kong"]);
  }, 60_000);

  it("replaces a kind of photo when the pack says so, and remakes the combined photo", async () => {
    const t = await setup();
    const files = new Map<string, Uint8Array>();
    for (const [i, n] of ["e", "old", "f", "new1", "new2"].entries()) files.set(`${n}.png`, await makeImage(400, 300, 1000 + i));
    await importLibraryPack(t.db, t.store, t.actor, { operator: "TAG Aviation", aircraft: [
      { type: "Gulfstream G650ER", tail: "VP-CXX", base: ["Singapore"], yom: 2019, photos: { exterior: ["e.png"], cabin: ["old.png"], floor_plan: ["f.png"] } },
    ] }, files);
    const r = await importLibraryPack(t.db, t.store, t.actor, { operator: "TAG Aviation", aircraft: [
      { type: "Gulfstream G650ER", tail: "VP-CTL", base: ["Singapore"], yom: 2019, replace: ["cabin"], photos: { cabin: ["new1.png", "new2.png"] } },
    ] }, files);
    expect(r).toMatchObject({ created: 0, matched: 1, photos: 2, skipped: [] });
    const [ac] = await getCatalogue(t.db, LIBRARY_TENANT_ID);
    expect(ac.tail).toBe("VP-CTL");
    const kinds = (await getLineup(t.db, { aircraftId: ac.aircraftId, aircraftTypeId: ac.aircraftTypeId })).map((p) => p.classification).sort();
    expect(kinds).toEqual(["cabin", "cabin", "combined", "exterior", "floor_plan"]);
  }, 60_000);

  it("adds a library aircraft whose photo the workspace has retired elsewhere", async () => {
    const t = await setup();
    const files = new Map<string, Uint8Array>();
    for (const [i, n] of ["e", "c1", "c2", "f"].entries()) files.set(`${n}.png`, await makeImage(400, 300, 1100 + i));
    await importLibraryPack(t.db, t.store, t.actor, { operator: "TAG Aviation", aircraft: [
      { type: "Gulfstream G650ER", tail: "VP-CTL", base: ["Singapore"], yom: 2019, photos: { exterior: ["e.png"], cabin: ["c1.png", "c2.png"], floor_plan: ["f.png"] } },
    ] }, files);
    const [libAc] = await getCatalogue(t.db, LIBRARY_TENANT_ID);
    const tenantId = randomUUID();
    const [u] = await t.db.insert(users).values({ tenantId, email: "broker5@example.test", displayName: "Broker 5" }).returning({ id: users.id });
    const broker = { id: u.id, tenantId };
    // The same exterior was on another aircraft in this workspace and was retired there.
    const up = (await ingestUpload(t.db, t.store, broker, { filename: "old.png", bytes: files.get("e.png")! })).result;
    await retireMedia(t.db, broker, randomUUID(), { mediaId: up.mediaId });

    await queueAdds(t.db, t.store, broker, [libAc.aircraftId]).done;
    const [mine] = await getCatalogue(t.db, tenantId);
    const kinds = (await getLineup(t.db, { aircraftId: mine.aircraftId, aircraftTypeId: mine.aircraftTypeId })).map((p) => p.classification).sort();
    expect(kinds).toEqual(["cabin", "cabin", "combined", "exterior", "floor_plan"]);
    expect((await copiedLibraryAircraft(t.db, tenantId)).has(libAc.aircraftId)).toBe(true);
  }, 60_000);

  it("updates the details of aircraft already in the library, and leaves unchanged ones alone", async () => {
    const t = await setup();
    const files = new Map<string, Uint8Array>([["c.png", await makeImage(400, 300, 1300)]]);
    const jet = (wifi: "yes" | "no") => ({ type: "Bombardier Challenger 850", tail: "9H-DOM", floating: true, yom: 2008, yor: 2015, capacity: 13, wifi, smoking: "yes" as const, pets: "yes" as const, photos: { cabin: ["c.png"] } });
    await importLibraryPack(t.db, t.store, t.actor, { operator: "AirX", aircraft: [jet("yes")] }, files);
    const [row] = await getCatalogue(t.db, LIBRARY_TENANT_ID);
    expect(row.base).toBe("Floating");

    const same = await importLibraryPack(t.db, t.store, t.actor, { operator: "AirX", aircraft: [jet("yes")] }, files);
    expect(same.retailed).toEqual([]);
    expect((await getAircraftCard(t.db, row.aircraftId))?.informationVersion).toBe(1);

    const r = await importLibraryPack(t.db, t.store, t.actor, { operator: "AirX", aircraft: [jet("no")] }, files);
    expect(r.retailed).toEqual(["Bombardier Challenger 850 9H-DOM: WIFI updated"]);
    const card = await getAircraftCard(t.db, row.aircraftId);
    expect(card).toMatchObject({ wifi: "no", yom: 2008, yor: 2015, capacity: 13, smoking: "yes", pets: "yes", informationVersion: 2 });
  }, 60_000);

  it("keeps two aircraft of one type without tails apart by their seats", async () => {
    const t = await setup();
    const files = new Map<string, Uint8Array>([["c.png", await makeImage(400, 300, 1400)], ["d.png", await makeImage(400, 300, 1401)]]);
    const pack = { operator: "Phenix Jet", aircraft: [
      { type: "Gulfstream G650ER", capacity: 13, photos: { cabin: ["c.png"] } },
      { type: "Gulfstream G650ER", capacity: 14, photos: { cabin: ["d.png"] } },
    ] };
    expect(await importLibraryPack(t.db, t.store, t.actor, pack, files)).toMatchObject({ created: 2, matched: 0 });
    expect(await importLibraryPack(t.db, t.store, t.actor, pack, files)).toMatchObject({ created: 0, matched: 2 });
  }, 60_000);

  it("carries a pack's notes onto the library aircraft and into a broker's copy", async () => {
    const t = await setup();
    const files = new Map<string, Uint8Array>([["c.png", await makeImage(400, 300, 1500)]]);
    await importLibraryPack(t.db, t.store, t.actor, { operator: "Phenix Jet", aircraft: [
      { type: "Gulfstream G650", tail: "N871FR", base: ["Tokyo"], capacity: 16, smoking: "no", pets: "unknown", notes: "Owner's approval required. Pets TBC.", photos: { cabin: ["c.png"] } },
    ] }, files);
    const [libAc] = await getCatalogue(t.db, LIBRARY_TENANT_ID);
    expect((await getAircraftCard(t.db, libAc.aircraftId))?.notes).toBe("Owner's approval required. Pets TBC.");
    const tenantId = randomUUID();
    const [u] = await t.db.insert(users).values({ tenantId, email: "broker6@example.test", displayName: "Broker 6" }).returning({ id: users.id });
    await queueAdds(t.db, t.store, { id: u.id, tenantId }, [libAc.aircraftId]).done;
    const [mine] = await getCatalogue(t.db, tenantId);
    expect(await getAircraftCard(t.db, mine.aircraftId)).toMatchObject({ notes: "Owner's approval required. Pets TBC.", smoking: "no", base: expect.stringContaining("Tokyo") });
  }, 60_000);
});
