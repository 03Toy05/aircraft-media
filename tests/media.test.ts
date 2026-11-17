import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setup, key, makeImage } from "./helpers";
import { createAircraft, createAircraftType, createOrganisation } from "../src/domain/directory";
import {
  approveMedia,
  extractCropAsMedia,
  getLineup,
  getMediaDetail,
  ingestUpload,
  readContentBytes,
  recropMedia,
  rejectMedia,
  reopenMedia,
  restoreMedia,
  retireMedia,
  setMediaAssociation,
  updateMediaMetadata,
  useContentVersion,
} from "../src/domain/media";
import { getCatalogue } from "../src/domain/catalogue";
import { aircraftMedia, mediaContentVersions, sourceEvidence } from "../src/db/schema";

let t: Awaited<ReturnType<typeof setup>>;
let acId: string;
let typeId: string;

beforeEach(async () => {
  t = await setup();
  const org = (await createOrganisation(t.db, t.actor, key(), { name: "Metrojet" })).result.organisationId;
  typeId = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G650ER" })).result.aircraftTypeId;
  acId = (
    await createAircraft(t.db, t.actor, key(), {
      aircraftTypeId: typeId,
      registration: "B-KXX",
      operatorId: org,
      base: { mode: "based", locations: ["Hong Kong"] },
    })
  ).result.aircraftId;
});

async function upload(seed: number, cardText?: string) {
  return (await ingestUpload(t.db, t.store, t.actor, { filename: `p${seed}.png`, bytes: await makeImage(400, 300, seed), cardText })).result;
}

/** classify + associate + approve using only deterministic actions (no AI anywhere). */
async function approveAs(mediaId: string, classification: Parameters<typeof updateMediaMetadata>[3]["classification"], status: "actual_aircraft" | "representative_type") {
  let v = (await getMediaDetail(t.db, mediaId))!.media.version;
  await updateMediaMetadata(t.db, t.actor, key(), { mediaId, expectedVersion: v, classification });
  v++;
  await setMediaAssociation(t.db, t.actor, key(), { mediaId, expectedVersion: v, status, aircraftId: status === "actual_aircraft" ? acId : null, aircraftTypeId: status === "representative_type" ? typeId : null });
  const d = (await getMediaDetail(t.db, mediaId))!;
  await approveMedia(t.db, t.actor, { mediaId, contentVersionId: d.media.currentContentVersionId!, expectedVersion: d.media.version });
}

describe("Upload and duplicate control (Test 4 for manual uploads)", () => {
  it("retains the original and leaves the photo unclassified, unresolved, needing review", async () => {
    const r = await upload(1);
    const d = (await getMediaDetail(t.db, r.mediaId))!;
    expect(d.media).toMatchObject({ reviewState: "needs_review", primaryClassification: "unclassified", associationStatus: "unresolved" });
    expect(d.evidence).toMatchObject({ sourceKind: "manual", originalFilename: "p1.png" });
    expect(d.versions).toHaveLength(1);
    expect(d.versions[0].isDerivative).toBe(false);
    expect((await readContentBytes(t.db, t.store, r.contentVersionId)).bytes.byteLength).toBeGreaterThan(0);
  });

  it("uploading identical bytes twice (even renamed) returns one record and one stored original", async () => {
    const bytes = await makeImage(400, 300, 5);
    const a = await ingestUpload(t.db, t.store, t.actor, { filename: "a.png", bytes });
    const b = await ingestUpload(t.db, t.store, t.actor, { filename: "renamed.png", bytes });
    expect(b.replayed).toBe(true);
    expect(b.result).toEqual(a.result);
    expect(await t.db.select().from(aircraftMedia)).toHaveLength(1);
    const uploadEvidence = (await t.db.select().from(sourceEvidence)).filter((e) => e.contentHash);
    expect(uploadEvidence).toHaveLength(1);
    expect(fs.readdirSync(t.dir)).toHaveLength(1);
  });

  it("rejects non-image and empty files", async () => {
    await expect(ingestUpload(t.db, t.store, t.actor, { filename: "x.pdf", bytes: new TextEncoder().encode("%PDF-1.4 not an image") })).rejects.toThrow(/not a readable image/);
    await expect(ingestUpload(t.db, t.store, t.actor, { filename: "empty", bytes: new Uint8Array() })).rejects.toThrow(/empty/);
  });

  it("stores a parsed card as a pending proposal, never as a fact", async () => {
    const r = await upload(2, "Operator: Metrojet\nTail number: B-KXX\nWIFI: Yes");
    const d = (await getMediaDetail(t.db, r.mediaId))!;
    expect(d.proposals).toHaveLength(1);
    expect(d.proposals[0]).toMatchObject({ provider: "deterministic-card-parser", state: "pending" });
    expect(d.media.associationStatus).toBe("unresolved");
  });
});

describe("Test 7 & 8 — classify, order, correct and approve manually (no AI involved)", () => {
  it("requires classification and association before approval", async () => {
    const r = await upload(3);
    const d = (await getMediaDetail(t.db, r.mediaId))!;
    await expect(approveMedia(t.db, t.actor, { mediaId: r.mediaId, contentVersionId: r.contentVersionId, expectedVersion: d.media.version })).rejects.toThrow(/classification/);
  });

  it("corrects a classification, re-requires approval after a change, and orders media", async () => {
    const a = await upload(10);
    const b = await upload(11);
    await approveAs(a.mediaId, "exterior", "actual_aircraft");
    await approveAs(b.mediaId, "exterior", "actual_aircraft");
    await updateMediaMetadata(t.db, t.actor, key(), { mediaId: b.mediaId, expectedVersion: (await getMediaDetail(t.db, b.mediaId))!.media.version, displayOrder: 0 });
    await updateMediaMetadata(t.db, t.actor, key(), { mediaId: a.mediaId, expectedVersion: (await getMediaDetail(t.db, a.mediaId))!.media.version, displayOrder: 5 });
    const lineup = await getLineup(t.db, { aircraftId: acId, aircraftTypeId: typeId });
    expect(lineup.map((l) => [l.mediaId, l.label])).toEqual([
      [b.mediaId, "EXT 1"],
      [a.mediaId, "EXT 2"],
    ]);

    // correcting the classification of approved media sends it back to review
    const detail = (await getMediaDetail(t.db, a.mediaId))!;
    await updateMediaMetadata(t.db, t.actor, key(), { mediaId: a.mediaId, expectedVersion: detail.media.version, classification: "cabin" });
    expect((await getMediaDetail(t.db, a.mediaId))!.media.reviewState).toBe("needs_review");
  });

  it("supports rejection with a reason and reopening", async () => {
    const r = await upload(12);
    const v = (await getMediaDetail(t.db, r.mediaId))!.media.version;
    await rejectMedia(t.db, t.actor, key(), { mediaId: r.mediaId, expectedVersion: v, reason: "blurry" });
    let d = (await getMediaDetail(t.db, r.mediaId))!;
    expect(d.media).toMatchObject({ reviewState: "rejected", rejectionReason: "blurry" });
    await reopenMedia(t.db, t.actor, key(), { mediaId: r.mediaId, expectedVersion: d.media.version });
    d = (await getMediaDetail(t.db, r.mediaId))!;
    expect(d.media.reviewState).toBe("needs_review");
  });

  it("rejects stale edits via the version precondition", async () => {
    const r = await upload(13);
    const err = await updateMediaMetadata(t.db, t.actor, key(), { mediaId: r.mediaId, expectedVersion: 99, classification: "cabin" }).catch((e) => e);
    expect(err.code).toBe("VERSION_MISMATCH");
  });

  it("approval is idempotent for the same exact content version and actor", async () => {
    const r = await upload(14);
    await updateMediaMetadata(t.db, t.actor, key(), { mediaId: r.mediaId, expectedVersion: 1, classification: "cabin" });
    await setMediaAssociation(t.db, t.actor, key(), { mediaId: r.mediaId, expectedVersion: 2, status: "actual_aircraft", aircraftId: acId });
    const input = { mediaId: r.mediaId, contentVersionId: r.contentVersionId, expectedVersion: 3 };
    const first = await approveMedia(t.db, t.actor, input);
    const second = await approveMedia(t.db, t.actor, input);
    expect(second.replayed).toBe(true);
    expect(second.result).toEqual(first.result);
  });
});

describe("Crop and separation keep the original (manual, no AI)", () => {
  it("recrop adds a derivative content version and preserves the earlier one", async () => {
    const r = await upload(20);
    const out = await recropMedia(t.db, t.store, t.actor, { mediaId: r.mediaId, sourceContentVersionId: r.contentVersionId, rect: { x: 10, y: 10, width: 100, height: 80 } });
    const d = (await getMediaDetail(t.db, r.mediaId))!;
    expect(d.versions.map((v) => [v.versionNumber, v.isDerivative, v.width, v.height])).toEqual([
      [1, false, 400, 300],
      [2, true, 100, 80],
    ]);
    expect(d.media.currentContentVersionId).toBe(out.result.contentVersionId);
    expect((await readContentBytes(t.db, t.store, r.contentVersionId)).bytes.byteLength).toBeGreaterThan(0); // original intact
    const ev = await t.db.select().from(sourceEvidence).where(eq(sourceEvidence.sourceKind, "extracted_image"));
    expect(ev[0].cropRef).toMatchObject({ x: 10, y: 10, width: 100, height: 80, extractionVersion: "manual-crop-1" });
  });

  it("undo returns to the original version, keeps the crop in history, and the same crop can be applied again", async () => {
    const r = await upload(23);
    const rect = { x: 10, y: 10, width: 100, height: 80 };
    const c1 = await recropMedia(t.db, t.store, t.actor, { mediaId: r.mediaId, sourceContentVersionId: r.contentVersionId, rect, key: key() });
    let m = (await getMediaDetail(t.db, r.mediaId))!.media;
    const undo = await useContentVersion(t.db, t.actor, key(), { mediaId: r.mediaId, contentVersionId: r.contentVersionId, expectedVersion: m.version });
    m = (await getMediaDetail(t.db, r.mediaId))!.media;
    expect(m.currentContentVersionId).toBe(r.contentVersionId);
    expect(undo.result.contentVersionId).toBe(r.contentVersionId);
    expect((await readContentBytes(t.db, t.store, c1.result.contentVersionId)).bytes.byteLength).toBeGreaterThan(0); // crop kept
    const c2 = await recropMedia(t.db, t.store, t.actor, { mediaId: r.mediaId, sourceContentVersionId: r.contentVersionId, rect, key: key() });
    expect(c2.replayed).toBe(false);
    expect((await getMediaDetail(t.db, r.mediaId))!.versions).toHaveLength(3);
  });

  it("separates several photos from a collage as independent reviewable media; repeat is a no-op", async () => {
    const r = await upload(21);
    const left = { mediaId: r.mediaId, sourceContentVersionId: r.contentVersionId, rect: { x: 0, y: 0, width: 200, height: 300 } };
    const right = { ...left, rect: { x: 200, y: 0, width: 200, height: 300 } };
    const a = await extractCropAsMedia(t.db, t.store, t.actor, left);
    const b = await extractCropAsMedia(t.db, t.store, t.actor, right);
    const again = await extractCropAsMedia(t.db, t.store, t.actor, left);
    expect(again.replayed).toBe(true);
    expect(a.result.mediaId).not.toBe(b.result.mediaId);
    expect(await t.db.select().from(aircraftMedia)).toHaveLength(3); // collage + 2 separated
    const states = (await t.db.select().from(aircraftMedia)).map((m) => m.reviewState);
    expect(states.every((s) => s === "needs_review")).toBe(true);
  });

  it("refuses crops outside the image", async () => {
    const r = await upload(22);
    await expect(recropMedia(t.db, t.store, t.actor, { mediaId: r.mediaId, sourceContentVersionId: r.contentVersionId, rect: { x: 350, y: 0, width: 100, height: 100 } })).rejects.toThrow(/inside/);
  });
});

describe("Test 10 — catalogue states", () => {
  const find = async () => (await getCatalogue(t.db, t.actor.tenantId)).find((r) => r.aircraftId === acId)!;

  it("shows missing, needs_review, partial, actual_available and representative_available", async () => {
    expect((await find()).status).toBe("missing");

    // pending review attributed to the aircraft
    const p = await upload(30);
    await updateMediaMetadata(t.db, t.actor, key(), { mediaId: p.mediaId, expectedVersion: 1, classification: "exterior" });
    await setMediaAssociation(t.db, t.actor, key(), { mediaId: p.mediaId, expectedVersion: 2, status: "actual_aircraft", aircraftId: acId });
    expect((await find()).status).toBe("needs_review");

    // approve exterior only -> partial
    const d = (await getMediaDetail(t.db, p.mediaId))!;
    await approveMedia(t.db, t.actor, { mediaId: p.mediaId, contentVersionId: p.contentVersionId, expectedVersion: d.media.version });
    let row = await find();
    expect(row.status).toBe("partial");
    expect(row.cells.exterior.status).toBe("actual_available");
    expect(row.cells.cabin.status).toBe("missing");

    // add cabin + floor plan -> actual_available
    await approveAs((await upload(31)).mediaId, "cabin", "actual_aircraft");
    await approveAs((await upload(32)).mediaId, "floor_plan", "actual_aircraft");
    expect((await find()).status).toBe("actual_available");
  });

  it("shows representative_available when only type-level media exist, kept distinct from actual", async () => {
    await approveAs((await upload(40)).mediaId, "exterior", "representative_type");
    await approveAs((await upload(41)).mediaId, "cabin", "representative_type");
    await approveAs((await upload(42)).mediaId, "floor_plan", "representative_type");
    const row = (await getCatalogue(t.db, t.actor.tenantId)).find((r) => r.aircraftId === acId)!;
    expect(row.status).toBe("representative_available");
    expect(row.cells.exterior).toMatchObject({ actual: 0, representative: 1 });
  });

  it("filters: missing floor plan, floating, and by tail", async () => {
    await approveAs((await upload(50)).mediaId, "exterior", "actual_aircraft");
    const all = await getCatalogue(t.db, t.actor.tenantId, { missingClass: "floor_plan" });
    expect(all.map((r) => r.aircraftId)).toEqual([acId]);
    expect(await getCatalogue(t.db, t.actor.tenantId, { missingClass: "exterior" })).toHaveLength(0);
    expect(await getCatalogue(t.db, t.actor.tenantId, { floatingOnly: true })).toHaveLength(0);
    expect(await getCatalogue(t.db, t.actor.tenantId, { tail: "b kxx" })).toHaveLength(1);
  });
});

describe("Test 11 (reduced) — unreadable bytes are not shown as available", () => {
  it("flags the content unavailable when the file cannot be read and drops it from availability", async () => {
    const r = await upload(60);
    await approveAs(r.mediaId, "exterior", "actual_aircraft");
    let row = (await getCatalogue(t.db, t.actor.tenantId)).find((x) => x.aircraftId === acId)!;
    expect(row.cells.exterior.status).toBe("actual_available");

    const [cv] = await t.db.select().from(mediaContentVersions).where(eq(mediaContentVersions.id, r.contentVersionId));
    fs.unlinkSync(path.join(t.dir, cv.storageRef)); // simulate stale/missing bytes
    await expect(readContentBytes(t.db, t.store, r.contentVersionId)).rejects.toThrow(/could not be retrieved/);

    row = (await getCatalogue(t.db, t.actor.tenantId)).find((x) => x.aircraftId === acId)!;
    expect(row.cells.exterior.status).toBe("unavailable");
    expect(row.status).toBe("unavailable");
    expect(await getLineup(t.db, { aircraftId: acId, aircraftTypeId: typeId })).toHaveLength(0);
  });
});

describe("Test 16 — retire and restore without changing history", () => {
  it("retired media leaves the lineup and catalogue; restore brings the same record back", async () => {
    const r = await upload(70);
    await approveAs(r.mediaId, "exterior", "actual_aircraft");
    const before = (await getMediaDetail(t.db, r.mediaId))!;
    expect(await getLineup(t.db, { aircraftId: acId, aircraftTypeId: typeId })).toHaveLength(1);

    await retireMedia(t.db, t.actor, key(), { mediaId: r.mediaId });
    expect(await getLineup(t.db, { aircraftId: acId, aircraftTypeId: typeId })).toHaveLength(0);
    expect((await getCatalogue(t.db, t.actor.tenantId))[0].cells.exterior.status).toBe("missing");
    // approval and content version are untouched by retirement
    const mid = (await getMediaDetail(t.db, r.mediaId))!;
    expect(mid.media.reviewState).toBe("approved");
    expect(mid.versions).toEqual(before.versions);
    await expect(approveMedia(t.db, t.actor, { mediaId: r.mediaId, contentVersionId: r.contentVersionId, expectedVersion: mid.media.version })).rejects.toThrow(/Retired/);

    await restoreMedia(t.db, t.actor, key(), { mediaId: r.mediaId });
    const lineup = await getLineup(t.db, { aircraftId: acId, aircraftTypeId: typeId });
    expect(lineup.map((l) => [l.mediaId, l.contentVersionId])).toEqual([[r.mediaId, r.contentVersionId]]);
  });
});
