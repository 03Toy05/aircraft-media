import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { setup, key, makeImage } from "./helpers";
import { createAircraft, createAircraftType, createOrganisation } from "../src/domain/directory";
import { approveMedia, getLineup, getMediaDetail, ingestUpload, setMediaAssociation, updateMediaMetadata } from "../src/domain/media";
import { COMBINED_WIDTH, buildCombinedPhoto, ensureCombinedPhotos, existingCombined, makeCombinedPhoto, type CombinedScope } from "../src/domain/combinedPhoto";
import { listExportRows } from "../src/domain/cbosExport";
import { parseClassification, type Classification } from "../src/domain/constants";

/** A plain colour picture, so we can tell where each photo landed. */
const solid = (r: number, g: number, b: number, w = 400, h = 300) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer().then((x) => new Uint8Array(x));

async function pixel(jpg: Buffer, x: number, y: number) {
  const { data, info } = await sharp(jpg).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}
const near = (got: number[], want: number[]) => got.every((v, i) => Math.abs(v - want[i]) < 30);

describe("combined photo layout (no AI: the photos are only placed)", () => {
  it("puts CABIN 1 large on the left, EXT 1 top right, CABIN 2 bottom right and the whole floor plan underneath", async () => {
    const jpg = await buildCombinedPhoto({
      exterior: await solid(255, 0, 0),
      cabins: [await solid(0, 255, 0), await solid(0, 0, 255)],
      floorPlan: await solid(0, 0, 0, 1200, 300),
    });
    const meta = await sharp(jpg).metadata();
    expect(meta.width).toBe(COMBINED_WIDTH);
    expect(meta.height).toBe(720 + 8 + 400); // floor plan fitted to the full width: 1200x300 -> 1600x400
    expect(near(await pixel(jpg, 300, 300), [0, 255, 0])).toBe(true); // cabin 1, large, left
    expect(near(await pixel(jpg, 1400, 150), [255, 0, 0])).toBe(true); // exterior, top right
    expect(near(await pixel(jpg, 1400, 600), [0, 0, 255])).toBe(true); // cabin 2, bottom right
    expect(near(await pixel(jpg, 800, 900), [0, 0, 0])).toBe(true); // floor plan
  });

  it("knows the word for a combined photo", () => {
    expect(parseClassification("Combined")).toBe("combined");
    expect(parseClassification("collage")).toBe("combined");
    expect(parseClassification("組合圖")).toBe("combined");
  });
});

describe("combined photo in the gallery", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let acId: string;
  let typeId: string;
  let scope: CombinedScope;

  beforeEach(async () => {
    t = await setup();
    const org = (await createOrganisation(t.db, t.actor, key(), { name: "Metrojet" })).result.organisationId;
    typeId = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Bombardier", model: "Challenger 650" })).result.aircraftTypeId;
    acId = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: typeId, registration: "B-KXX", operatorId: org, info: { yom: 2018, yor: null, capacity: 12, wifiStatus: "yes", notes: null } })).result.aircraftId;
    scope = { kind: "aircraft", aircraftId: acId, aircraftTypeId: typeId };
  });

  async function approved(seed: number, cls: Classification) {
    const r = (await ingestUpload(t.db, t.store, t.actor, { filename: `IMG_${seed}.png`, bytes: await makeImage(400, 300, seed) })).result;
    let v = (await getMediaDetail(t.db, t.actor.tenantId, r.mediaId))!.media.version;
    await updateMediaMetadata(t.db, t.actor, key(), { mediaId: r.mediaId, expectedVersion: v, classification: cls });
    v++;
    await setMediaAssociation(t.db, t.actor, key(), { mediaId: r.mediaId, expectedVersion: v, status: "actual_aircraft", aircraftId: acId });
    const d = (await getMediaDetail(t.db, t.actor.tenantId, r.mediaId))!;
    await approveMedia(t.db, t.actor, { mediaId: r.mediaId, contentVersionId: d.media.currentContentVersionId!, expectedVersion: d.media.version });
    return r.mediaId;
  }

  it("is made only once there is 1 exterior, 2 cabin and 1 floor plan, and saved as an approved Combined photo", async () => {
    await approved(1, "exterior");
    await approved(2, "cabin");
    await approved(3, "floor_plan");
    expect(await makeCombinedPhoto(t.db, t.store, t.actor, scope)).toMatchObject({ made: false });
    expect(await ensureCombinedPhotos(t.db, t.store, t.actor)).toEqual({ made: 0, failed: [] });

    await approved(4, "cabin");
    expect(await ensureCombinedPhotos(t.db, t.store, t.actor)).toEqual({ made: 1, failed: [] });
    expect(await ensureCombinedPhotos(t.db, t.store, t.actor)).toEqual({ made: 0, failed: [] }); // already there

    const lineup = await getLineup(t.db, { aircraftId: acId, aircraftTypeId: typeId });
    const combined = lineup.filter((l) => l.classification === "combined");
    expect(combined).toHaveLength(1);
    expect(combined[0]).toMatchObject({ label: "COMBINED 1", associationStatus: "actual_aircraft", mimeType: "image/jpeg" });
    const d = (await getMediaDetail(t.db, t.actor.tenantId, combined[0].mediaId))!;
    expect(d.media.reviewState).toBe("approved");
    expect((d.evidence?.metadata as { generated?: { fromContentVersionIds: string[] } }).generated?.fromContentVersionIds).toHaveLength(4);

    // Not a CBOS view, so it never goes into the CBOS folders.
    const rows = await listExportRows(t.db, t.actor.tenantId);
    expect(rows.find((r) => r.mediaId === combined[0].mediaId)?.fileName).toBeNull();
  });

  it("fills a gap from the type's photos (here the floor plan), but needs some photos of the aircraft itself", async () => {
    const typePlan = (await ingestUpload(t.db, t.store, t.actor, { filename: "plan.png", bytes: await makeImage(400, 300, 9) })).result;
    let v = (await getMediaDetail(t.db, t.actor.tenantId, typePlan.mediaId))!.media.version;
    await updateMediaMetadata(t.db, t.actor, key(), { mediaId: typePlan.mediaId, expectedVersion: v, classification: "floor_plan" });
    await setMediaAssociation(t.db, t.actor, key(), { mediaId: typePlan.mediaId, expectedVersion: ++v, status: "representative_type", aircraftTypeId: typeId });
    const d = (await getMediaDetail(t.db, t.actor.tenantId, typePlan.mediaId))!;
    await approveMedia(t.db, t.actor, { mediaId: typePlan.mediaId, contentVersionId: d.media.currentContentVersionId!, expectedVersion: d.media.version });
    expect(await makeCombinedPhoto(t.db, t.store, t.actor, scope)).toMatchObject({ made: false }); // nothing of its own yet

    await approved(1, "exterior"); await approved(2, "cabin"); await approved(3, "cabin");
    expect(await ensureCombinedPhotos(t.db, t.store, t.actor)).toEqual({ made: 1, failed: [] });
    expect((await existingCombined(t.db, t.actor.tenantId, scope))).toHaveLength(1);
  });

  it("offers one combined photo per aircraft, with its separate photos, even when it has two", async () => {
    await approved(1, "exterior"); await approved(2, "cabin"); await approved(3, "cabin"); await approved(4, "floor_plan");
    await approved(5, "combined"); // the broker's own upload
    const made = await makeCombinedPhoto(t.db, t.store, t.actor, scope); // and one made here, without replacing
    const lineup = await getLineup(t.db, { aircraftId: acId, aircraftTypeId: typeId });
    expect(lineup.map((l) => l.classification).sort()).toEqual(["cabin", "cabin", "combined", "exterior", "floor_plan"]);
    expect(lineup.find((l) => l.classification === "combined")?.mediaId).toBe((made as { mediaId: string }).mediaId); // the newest
  });

  it("remaking replaces the old one", async () => {
    await approved(1, "exterior"); await approved(2, "cabin"); await approved(3, "cabin"); await approved(4, "floor_plan");
    const first = await makeCombinedPhoto(t.db, t.store, t.actor, scope);
    const again = await makeCombinedPhoto(t.db, t.store, t.actor, scope, { replace: true });
    expect(again).toMatchObject({ made: true, replaced: 1 });
    const now = await existingCombined(t.db, t.actor.tenantId, scope);
    expect(now.map((c) => c.mediaId)).toEqual([(again as { mediaId: string }).mediaId]);
    expect(now[0].mediaId).not.toBe((first as { mediaId: string }).mediaId);
  });
});
