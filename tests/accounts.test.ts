import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setup, key, makeImage } from "./helpers";
import { TRIAL_DAYS, accessFor, extendTrial, inviteUser, recordSignIn, setBlocked, withdrawInvite } from "../src/domain/accounts";
import { createAircraft, createAircraftType, createOrganisation, resolveOrganisations } from "../src/domain/directory";
import { approveMedia, findUploadSiblings, getLineup, getMediaDetail, ingestUpload, setMediaAssociation, updateMediaMetadata } from "../src/domain/media";
import { applyChatProposal } from "../src/domain/chat";
import { getCatalogue } from "../src/domain/catalogue";
import { users } from "../src/db/schema";
import type { Actor } from "../src/domain/action";

const DAY = 86_400_000;
let t: Awaited<ReturnType<typeof setup>>;
const ADMIN = "owner@example.test";

beforeEach(async () => {
  t = await setup();
});

describe("Trial access", () => {
  it("is writable during the 14 days and read-only after", () => {
    const now = new Date("2026-11-19T00:00:00Z");
    const ends = new Date(now.getTime() + TRIAL_DAYS * DAY);
    expect(accessFor({ plan: "trial", trialEndsAt: ends, status: "active" }, now)).toEqual({ readOnly: false, daysLeft: 14, expired: false });
    expect(accessFor({ plan: "trial", trialEndsAt: ends, status: "active" }, new Date(ends.getTime() + 1))).toEqual({ readOnly: true, daysLeft: 0, expired: true });
    expect(accessFor({ plan: "full", trialEndsAt: null, status: "active" }, now).readOnly).toBe(false);
    expect(accessFor({ plan: "full", trialEndsAt: null, status: "blocked" }, now).readOnly).toBe(true);
  });

  it("gives an invited person their own workspace and starts the clock at first sign-in", async () => {
    const u = await inviteUser(t.db, t.actor.id, { email: " Broker@Example.com ", plan: "trial" });
    expect(u.email).toBe("broker@example.com");
    expect(u.tenantId).not.toBe(t.actor.tenantId);
    expect(u.trialEndsAt).toBeNull();
    await expect(inviteUser(t.db, t.actor.id, { email: "broker@example.com", plan: "trial" })).rejects.toThrow(/already/);

    const now = new Date("2026-11-20T10:00:00Z");
    const signed = await recordSignIn(t.db, u, now);
    expect(signed.status).toBe("active");
    expect(signed.trialEndsAt?.getTime()).toBe(now.getTime() + TRIAL_DAYS * DAY);
    // A later sign-in does not restart the trial.
    const again = await recordSignIn(t.db, signed, new Date(now.getTime() + 3 * DAY));
    expect(again.trialEndsAt?.getTime()).toBe(signed.trialEndsAt?.getTime());
  });

  it("extends from today once a trial has ended, and keeps work when access is turned off", async () => {
    const u = await recordSignIn(t.db, await inviteUser(t.db, t.actor.id, { email: "b@x.com", plan: "trial" }), new Date(Date.now() - 20 * DAY));
    expect(accessFor(u).expired).toBe(true);
    await extendTrial(t.db, ADMIN, u.id, 7);
    const [after] = await t.db.select().from(users).where(eq(users.id, u.id));
    expect(accessFor(after)).toMatchObject({ readOnly: false, daysLeft: 7 });
    await setBlocked(t.db, ADMIN, u.id, true);
    expect((await t.db.select().from(users).where(eq(users.id, u.id)))[0].status).toBe("blocked");
    await expect(withdrawInvite(t.db, ADMIN, u.id)).rejects.toThrow(/already signed in/);
  });
});

describe("Workspaces are kept apart", () => {
  it("never shows or links another user's operators, types or photos", async () => {
    const other: Actor = { id: t.actor.id, tenantId: randomUUID() };
    // Same names in both workspaces.
    await createOrganisation(t.db, t.actor, key(), { name: "Metrojet", aliases: ["MJ"] });
    await createOrganisation(t.db, other, key(), { name: "Metrojet", aliases: ["MJ"] });
    const myType = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G280" })).result.aircraftTypeId;
    const theirType = (await createAircraftType(t.db, other, key(), { manufacturer: "Gulfstream", model: "G280" })).result.aircraftTypeId;
    const myAc = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: myType, registration: "B-AAA" })).result.aircraftId;
    expect(await resolveOrganisations(t.db, t.actor.tenantId, "MJ")).toHaveLength(1);

    // Their approved photo of their G280 must not appear on my G280.
    const p = (await ingestUpload(t.db, t.store, other, { filename: "x.png", bytes: await makeImage(400, 300, 70) })).result;
    let v = (await getMediaDetail(t.db, other.tenantId, p.mediaId))!.media.version;
    await updateMediaMetadata(t.db, other, key(), { mediaId: p.mediaId, expectedVersion: v, classification: "exterior" });
    await setMediaAssociation(t.db, other, key(), { mediaId: p.mediaId, expectedVersion: v + 1, status: "representative_type", aircraftTypeId: theirType });
    const d = (await getMediaDetail(t.db, other.tenantId, p.mediaId))!;
    await approveMedia(t.db, other, { mediaId: p.mediaId, contentVersionId: d.media.currentContentVersionId!, expectedVersion: d.media.version });
    expect(await getLineup(t.db, { aircraftId: myAc, aircraftTypeId: myType })).toHaveLength(0);
    expect(await getLineup(t.db, { aircraftId: "", aircraftTypeId: theirType })).toHaveLength(1);
    expect(await getMediaDetail(t.db, t.actor.tenantId, p.mediaId)).toBeNull();

    // They cannot attach a photo to my type, or assign it to my aircraft.
    const q = (await ingestUpload(t.db, t.store, other, { filename: "y.png", bytes: await makeImage(400, 300, 71) })).result;
    const qv = (await getMediaDetail(t.db, other.tenantId, q.mediaId))!.media.version;
    await expect(setMediaAssociation(t.db, other, key(), { mediaId: q.mediaId, expectedVersion: qv, status: "representative_type", aircraftTypeId: myType })).rejects.toThrow(/not found/i);
    const r = await applyChatProposal(t.db, other, key(), { mediaIds: [q.mediaId], classifications: { [q.mediaId]: "interior" }, operatorId: null, aircraftTypeId: null, aircraft: { mode: "existing", aircraftId: myAc }, info: { yom: 2030, yor: null, capacity: null, wifiStatus: "unknown", notes: null } });
    expect(r.aircraftId).toBeNull();
    expect((await getCatalogue(t.db, t.actor.tenantId)).find((x) => x.aircraftId === myAc)?.tail).toBe("B-AAA");
  });
});

describe("One upload, one source evidence", () => {
  it("lets the details given once be applied to every photo sent together", async () => {
    const batchId = randomUUID();
    const card = "Operator: Metrojet\nAircraft: G280\nTail number: B-NEW";
    const ids: string[] = [];
    for (const seed of [80, 81, 82]) ids.push((await ingestUpload(t.db, t.store, t.actor, { filename: `p${seed}.png`, bytes: await makeImage(400, 300, seed), cardText: card, batchId })).result.mediaId);
    const other = (await ingestUpload(t.db, t.store, t.actor, { filename: "other.png", bytes: await makeImage(400, 300, 83), batchId: randomUUID() })).result.mediaId;

    // Every photo keeps the same card text as its evidence.
    for (const id of ids) expect((await getMediaDetail(t.db, t.actor.tenantId, id))!.evidence?.originalText).toBe(card);
    const sibs = (await findUploadSiblings(t.db, t.actor.tenantId, ids[0])).map((s) => s.mediaId);
    expect(sibs.sort()).toEqual([ids[1], ids[2]].sort());
    expect(sibs).not.toContain(other);

    const type = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G280" })).result.aircraftTypeId;
    const r = await applyChatProposal(t.db, t.actor, key(), {
      mediaIds: ids,
      classifications: { [ids[0]]: "exterior", [ids[1]]: "interior", [ids[2]]: "interior" },
      operatorId: null,
      newOperatorName: "Metrojet",
      aircraftTypeId: type,
      aircraft: { mode: "new", registration: "B-NEW" },
      info: { yom: null, yor: null, capacity: null, wifiStatus: "unknown", notes: null },
    });
    expect(r.photos.map((p) => p.outcome)).toEqual(["approved", "approved", "approved"]);
    expect(await getLineup(t.db, { aircraftId: r.aircraftId!, aircraftTypeId: type })).toHaveLength(3);
    expect(await findUploadSiblings(t.db, t.actor.tenantId, other)).toHaveLength(0);
  });
});
