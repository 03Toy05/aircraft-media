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
