import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { setup, key, makeImage } from "./helpers";
import { users, aircraftMedia, libraryContributions } from "../src/db/schema";
import type { Actor } from "../src/domain/action";
import type { Classification } from "../src/domain/constants";
import { createAircraft, createAircraftType, createOrganisation } from "../src/domain/directory";
import { approveMedia, getLineup, ingestUpload, setMediaAssociation, updateMediaMetadata } from "../src/domain/media";
import { getCatalogue } from "../src/domain/catalogue";
import { LIBRARY_TENANT_ID, acceptContributions, collectContributions, libraryMatchKey, rejectContributions, reviewGroups } from "../src/domain/library";

type T = Awaited<ReturnType<typeof setup>>;
let seed = 1;

/** A workspace with one aircraft and approved photos of the given kinds. */
async function workspace(t: T, actor: Actor, opts: { operator: string; tail: string | null; kinds: Classification[]; restricted?: number }) {
  const type = (await createAircraftType(t.db, actor, key(), { manufacturer: "Gulfstream", model: "G650ER", category: "ultra_long_range_jet" })).result.aircraftTypeId;
  const op = (await createOrganisation(t.db, actor, key(), { name: opts.operator, region: "Hong Kong" })).result.organisationId;
  const ac = (await createAircraft(t.db, actor, key(), { aircraftTypeId: type, operatorId: op, registration: opts.tail, info: { yom: 2017, capacity: 15 } })).result.aircraftId;
  const media: string[] = [];
  for (const [i, kind] of opts.kinds.entries()) {
    const up = (await ingestUpload(t.db, t.store, actor, { filename: `p${seed}.png`, bytes: await makeImage(400, 300, seed++) })).result;
    const v = async () => (await t.db.select({ v: aircraftMedia.version }).from(aircraftMedia).where(eq(aircraftMedia.id, up.mediaId)))[0].v;
    await updateMediaMetadata(t.db, actor, key(), { mediaId: up.mediaId, expectedVersion: await v(), classification: kind, ...(i === opts.restricted ? { rightsStatus: "restricted" as const } : {}) });
    await setMediaAssociation(t.db, actor, key(), { mediaId: up.mediaId, expectedVersion: await v(), status: "actual_aircraft", aircraftId: ac });
    await approveMedia(t.db, actor, { mediaId: up.mediaId, contentVersionId: up.contentVersionId, expectedVersion: await v() });
    media.push(up.mediaId);
  }
  return { ac, media };
}

async function secondUser(t: T): Promise<Actor> {
  const tenantId = randomUUID();
  const [u] = await t.db.insert(users).values({ tenantId, email: "broker2@example.test", displayName: "Broker 2", libraryOptIn: true }).returning({ id: users.id });
  return { id: u.id, tenantId };
}

describe("Platform library", () => {
  it("matches aircraft by tail, or by operator and type", () => {
    expect(libraryMatchKey({ tail: "T7-LXX", operator: "Tag", aircraft: "Gulfstream G650ER" })).toBe("tail:T7LXX");
    expect(libraryMatchKey({ tail: null, operator: "TAG Aviation", aircraft: "Gulfstream G650ER" })).toBe("op:tagaviation|type:gulfstreamg650er");
    expect(libraryMatchKey({ tail: null, operator: null, aircraft: "Gulfstream G650ER" })).toBeNull();
  });

  it("offers 1 EXT, 2 CABIN and 1 FLOOR PLAN per aircraft, first set wins, never restricted photos", async () => {
    const t = await setup();
    await workspace(t, t.actor, { operator: "Tag Aviation", tail: "T7-LXX", kinds: ["exterior", "cabin", "cabin", "cabin", "floor_plan"], restricted: 1 });
    expect(await collectContributions(t.db, t.actor.tenantId, t.actor.id)).toBe(4); // restricted cabin skipped, third cabin fills in
    expect(await collectContributions(t.db, t.actor.tenantId, t.actor.id)).toBe(0); // offered once

    // Someone else has the same aircraft: nothing more is needed while the first set waits for review.
    const b = await secondUser(t);
    await workspace(t, b, { operator: "TAG Aviation", tail: "T7LXX", kinds: ["exterior", "cabin"] });
    expect(await collectContributions(t.db, b.tenantId, b.id)).toBe(0);

    const [g] = await reviewGroups(t.db);
    expect(g.photos.map((p) => p.classification).sort()).toEqual(["cabin", "cabin", "exterior", "floor_plan"]);
    expect(g.libraryOperator).toBeNull();
    expect(g.contributor).toBe("owner@example.test");
  });

  it("copies accepted photos into the library under one operator, with a combined photo, and reopens turned-down places", async () => {
    const t = await setup();
    await workspace(t, t.actor, { operator: "Tag Aviation", tail: "T7-LXX", kinds: ["exterior", "cabin", "cabin", "floor_plan"] });
    await collectContributions(t.db, t.actor.tenantId, t.actor.id);
    const [g] = await reviewGroups(t.db);
    const ext = g.photos.find((p) => p.classification === "exterior")!;
    const keep = g.photos.filter((p) => p.id !== ext.id).map((p) => p.id);

    // Turn the exterior down, accept the rest.
    expect(await rejectContributions(t.db, t.actor, [ext.id])).toBe(1);
    const r = await acceptContributions(t.db, t.store, t.actor, { matchKey: g.matchKey, contributionIds: keep, operator: { kind: "new", name: "Tag Aviation" } });
    expect(r.accepted).toBe(3);

    const lib = await getCatalogue(t.db, LIBRARY_TENANT_ID);
    expect(lib.map((x) => [x.operator, x.aircraft, x.tail])).toEqual([["Tag Aviation", "Gulfstream G650ER", "T7-LXX"]]);
    let photos = await getLineup(t.db, { aircraftId: lib[0].aircraftId, aircraftTypeId: lib[0].aircraftTypeId });
    expect(photos.map((p) => p.classification).sort()).toEqual(["cabin", "cabin", "floor_plan"]);

    // The exterior's place is open again: another user's exterior is offered, and matched to the same library operator.
    const b = await secondUser(t);
    await workspace(t, b, { operator: "TAG AVIATION", tail: "T7LXX", kinds: ["exterior", "cabin"] });
    expect(await collectContributions(t.db, b.tenantId, b.id)).toBe(1);
    const [g2] = await reviewGroups(t.db);
    expect(g2.libraryAircraft?.id).toBe(lib[0].aircraftId);
    expect(g2.libraryOperator?.name).toBe("Tag Aviation");
    await acceptContributions(t.db, t.store, t.actor, { matchKey: g2.matchKey, contributionIds: g2.photos.map((p) => p.id), operator: { kind: "existing", id: g2.libraryOperator!.id } });

    photos = await getLineup(t.db, { aircraftId: lib[0].aircraftId, aircraftTypeId: lib[0].aircraftTypeId });
    expect(photos.map((p) => p.classification).sort()).toEqual(["cabin", "cabin", "combined", "exterior", "floor_plan"]);
    expect(await getCatalogue(t.db, LIBRARY_TENANT_ID)).toHaveLength(1); // still one aircraft
    // The contributors' own workspaces are untouched and cannot see the library.
    expect((await getCatalogue(t.db, b.tenantId)).map((x) => x.operator)).toEqual(["TAG AVIATION"]);
    const statuses = (await t.db.select().from(libraryContributions)).map((c) => c.status).sort();
    expect(statuses).toEqual(["accepted", "accepted", "accepted", "accepted", "rejected"]);
  });
});

import { addInformationVersion, getAircraftCard } from "../src/domain/directory";
import { addToWorkspace, acceptUpdates, copyStatus, offerUpdate, offerablePhotos, updateCopy } from "../src/domain/library";
import { converse, emptyDraft } from "../src/domain/chocks";

/** A library with Tag's T7-LXX (full set), made from the first user's photos. */
async function libraryWithTag(t: T) {
  await workspace(t, t.actor, { operator: "Tag Aviation", tail: "T7-LXX", kinds: ["exterior", "cabin", "cabin", "floor_plan"] });
  await collectContributions(t.db, t.actor.tenantId, t.actor.id);
  const [g] = await reviewGroups(t.db);
  const r = await acceptContributions(t.db, t.store, t.actor, { matchKey: g.matchKey, contributionIds: g.photos.map((p) => p.id), operator: { kind: "new", name: "Tag Aviation" } });
  return r.libraryAircraftId;
}

describe("Using the library", () => {
  it("adds a library aircraft to a user's workspace, never offers those photos back, and quotes from the library in Toy", async () => {
    const t = await setup();
    const libAc = await libraryWithTag(t);
    const b = await secondUser(t);
    const r = await addToWorkspace(t.db, t.store, b, libAc);
    expect([r.existed, r.photos]).toEqual([false, 5]); // 4 photos + the combined photo
    const mine = await getCatalogue(t.db, b.tenantId);
    expect(mine.map((x) => [x.operator, x.aircraft, x.tail])).toEqual([["Tag Aviation", "Gulfstream G650ER", "T7-LXX"]]);
    expect((await getAircraftCard(t.db, r.aircraftId))?.yom).toBe(2017);
    expect(await collectContributions(t.db, b.tenantId, b.id)).toBe(0); // copied photos are the library's own
    expect(await offerablePhotos(t.db, b.tenantId, r.aircraftId)).toEqual([]);
    expect((await copyStatus(t.db, b.tenantId, r.aircraftId))?.newer).toBe(0);

    // Toy: a user with an empty workspace quotes the library's aircraft.
    const c = await secondUser2(t);
    const turn = await converse(t.db, c.tenantId, emptyDraft("q"), "Give me Tag G650ER quote at USD 150,000", [], { library: true });
    expect(turn.reply.copy).toContain("Price: USD 150,000");
    expect(turn.reply.link?.href).toContain(libAc);
    const without = await converse(t.db, c.tenantId, emptyDraft("q"), "Give me Tag G650ER quote", [], { library: false });
    expect(without.reply.copy).toBeUndefined();
  });

  it("takes newer photos for the same tail side by side, keeps the old ones in history, and updates copies", async () => {
    const t = await setup();
    const libAc = await libraryWithTag(t);
    const b = await secondUser(t);
    const copy = await addToWorkspace(t.db, t.store, b, libAc);

    // A third broker refurbished photos of the same tail and offers them.
    const c = await secondUser2(t);
    const theirs = await workspace(t, c, { operator: "TAG", tail: "T7-LXX", kinds: ["exterior", "cabin"] });
    expect(await offerUpdate(t.db, c, theirs.ac, theirs.media)).toBe(2);
    const [g] = (await reviewGroups(t.db)).filter((x) => x.kind === "update");
    expect(g.current.map((x) => x.label)).toEqual(["EXT 1", "CABIN 1", "CABIN 2", "FLOOR PLAN 1"]);
    const extId = g.current[0].mediaId;
    const cabin1 = g.current[1].mediaId;
    const r = await acceptUpdates(t.db, t.store, t.actor, { matchKey: g.matchKey, choices: [
      { contributionId: g.photos.find((p) => p.classification === "exterior")!.id, replace: extId },
      { contributionId: g.photos.find((p) => p.classification === "cabin")!.id, replace: cabin1 },
    ] });
    expect(r).toEqual({ replaced: 2, added: 0 });
    const lineup = await getLineup(t.db, { aircraftId: libAc, aircraftTypeId: (await getCatalogue(t.db, LIBRARY_TENANT_ID))[0].aircraftTypeId });
    expect(lineup.map((l) => l.classification).sort()).toEqual(["cabin", "cabin", "combined", "exterior", "floor_plan"]);
    expect(lineup.some((l) => l.mediaId === extId)).toBe(false);
    const [old] = await t.db.select().from(aircraftMedia).where(eq(aircraftMedia.id, extId));
    expect(old.lifecycleState).toBe("retired"); // kept in history

    // The copy is offered the newer photos; updating swaps only the library's photos.
    const st = await copyStatus(t.db, b.tenantId, copy.aircraftId);
    expect(st!.newer).toBe(3); // new EXT, new CABIN, new combined
    const u = await updateCopy(t.db, t.store, b, copy.aircraftId);
    expect(u).toEqual({ added: 3, retired: 3 });
    expect((await copyStatus(t.db, b.tenantId, copy.aircraftId))!.newer).toBe(0);
  });

  it("offers photos of a refurbished aircraft as newer ones by itself", async () => {
    const t = await setup();
    await libraryWithTag(t);
    const c = await secondUser2(t);
    const theirs = await workspace(t, c, { operator: "Tag Aviation", tail: "T7-LXX", kinds: ["cabin"] });
    expect(await collectContributions(t.db, c.tenantId, c.id)).toBe(0); // same YOR: nothing to offer
    const card = (await getAircraftCard(t.db, theirs.ac))!;
    await addInformationVersion(t.db, c, key(), { aircraftId: theirs.ac, expectedVersion: card.informationVersion, info: { yom: 2017, yor: 2024, capacity: 15 } });
    expect(await collectContributions(t.db, c.tenantId, c.id)).toBe(1);
    const [g] = (await reviewGroups(t.db)).filter((x) => x.kind === "update");
    expect(g.note).toMatch(/Refurbished 2024/);
  });
});

async function secondUser2(t: T): Promise<Actor> {
  const tenantId = randomUUID();
  const [u] = await t.db.insert(users).values({ tenantId, email: `broker3-${tenantId.slice(0, 6)}@example.test`, displayName: "Broker 3", libraryOptIn: true }).returning({ id: users.id });
  return { id: u.id, tenantId };
}
