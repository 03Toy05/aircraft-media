import { randomUUID } from "node:crypto";
import sharp, { type OverlayOptions } from "sharp";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { aircraft, aircraftMedia, mediaAssociations, mediaContentVersions, sourceEvidence } from "../db/schema";
import type { FileStore } from "../storage";
import type { Actor } from "./action";
import { approveMedia, ingestUpload, readContentBytes, retireMedia, setMediaAssociation, updateMediaMetadata } from "./media";

/**
 * The combined photo: one picture of an aircraft made from four approved photos, with no AI (it only places them):
 *
 *   ┌──────────────────┬─────────┐
 *   │                  │  EXT 1  │
 *   │     CABIN 1      ├─────────┤
 *   │                  │ CABIN 2 │
 *   ├──────────────────┴─────────┤
 *   │         FLOOR PLAN         │   (whole drawing shown, on white)
 *   └────────────────────────────┘
 *
 * It is made only when there is at least 1 exterior, 2 cabin and 1 floor plan photo, and saved as an approved
 * "Combined" photo in the gallery, so it is ready before any quote.
 */
export const COMBINED_WIDTH = 1600;
const GAP = 8;
const TOP_HEIGHT = 720;
const PLAN_MAX_HEIGHT = 520;
const BG = { r: 255, g: 255, b: 255, alpha: 1 };
export { COMBINED_NEEDS } from "./constants";
import { COMBINED_NEEDS } from "./constants";

export interface CombinedParts {
  exterior: Uint8Array;
  cabins: [Uint8Array, Uint8Array];
  floorPlan: Uint8Array;
}

const cover = (b: Uint8Array, width: number, height: number) =>
  sharp(b).rotate().resize(width, height, { fit: "cover", position: "attention" }).toBuffer();

export async function buildCombinedPhoto(parts: CombinedParts): Promise<Buffer> {
  const bigW = Math.round((COMBINED_WIDTH - GAP) * 2 / 3);
  const sideW = COMBINED_WIDTH - GAP - bigW;
  const sideH = Math.floor((TOP_HEIGHT - GAP) / 2);
  const layers: OverlayOptions[] = [
    { input: await cover(parts.cabins[0], bigW, TOP_HEIGHT), left: 0, top: 0 },
    { input: await cover(parts.exterior, sideW, sideH), left: bigW + GAP, top: 0 },
    { input: await cover(parts.cabins[1], sideW, TOP_HEIGHT - sideH - GAP), left: bigW + GAP, top: sideH + GAP },
  ];
  // The whole drawing, never cropped: fit inside the width and a height limit, centred on white.
  const { data, info } = await sharp(parts.floorPlan).rotate()
    .flatten({ background: BG })
    .resize(COMBINED_WIDTH, PLAN_MAX_HEIGHT, { fit: "inside" })
    .toBuffer({ resolveWithObject: true });
  layers.push({ input: data, left: Math.round((COMBINED_WIDTH - info.width) / 2), top: TOP_HEIGHT + GAP });
  return sharp({ create: { width: COMBINED_WIDTH, height: TOP_HEIGHT + GAP + info.height, channels: 3, background: BG } })
    .composite(layers)
    // A note inside the file saying when it was made, so a remade picture is always a new photo, never mistaken for an old one.
    .withExif({ IFD0: { ImageDescription: `Aircraft Media combined photo ${new Date().toISOString()}`, Software: "Aircraft Media" } })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

/** Whose combined photo: one particular aircraft (from its own photos), or an aircraft type (from photos representing it). */
export type CombinedScope = { kind: "aircraft"; aircraftId: string; aircraftTypeId: string } | { kind: "type"; aircraftTypeId: string };

/** Approved, usable photos in the scope, in gallery order. */
async function scopePhotos(db: Db, tenantId: string, scope: CombinedScope) {
  const rows = await db
    .select({ m: aircraftMedia, a: mediaAssociations, cv: mediaContentVersions, ev: sourceEvidence })
    .from(aircraftMedia)
    .innerJoin(mediaAssociations, and(eq(mediaAssociations.aircraftMediaId, aircraftMedia.id), eq(mediaAssociations.active, true)))
    .innerJoin(mediaContentVersions, eq(mediaContentVersions.id, aircraftMedia.currentContentVersionId))
    .leftJoin(sourceEvidence, eq(sourceEvidence.id, aircraftMedia.createdSourceEvidenceId))
    .where(and(
      eq(aircraftMedia.tenantId, tenantId),
      eq(aircraftMedia.reviewState, "approved"),
      eq(aircraftMedia.lifecycleState, "active"),
      scope.kind === "aircraft"
        ? and(eq(mediaAssociations.associationStatus, "actual_aircraft"), eq(mediaAssociations.aircraftId, scope.aircraftId))
        : and(eq(mediaAssociations.associationStatus, "representative_type"), eq(mediaAssociations.aircraftTypeId, scope.aircraftTypeId)),
    ))
    .orderBy(asc(aircraftMedia.displayOrder), asc(aircraftMedia.createdAt));
  return rows.filter((r) => r.m.rightsStatus !== "restricted" && !r.cv.unavailableAt);
}

const isGenerated = (ev: { metadata: unknown } | null) => (ev?.metadata as { uploadedVia?: string } | null)?.uploadedVia === "generated";

/**
 * The four photos the combined photo is made from (first exterior, first two cabin, first floor plan in gallery order),
 * or null when there are not enough.
 */
export async function combinedSources(db: Db, tenantId: string, scope: CombinedScope) {
  const own = await scopePhotos(db, tenantId, scope);
  // An aircraft uses its own photos first and fills a gap from its type's photos (often the floor plan is the
  // type's). It needs at least one photo of its own: otherwise the type's combined photo already covers it.
  const typeRows = scope.kind === "aircraft" ? await scopePhotos(db, tenantId, { kind: "type", aircraftTypeId: scope.aircraftTypeId }) : [];
  const ownIds = new Set(own.map((r) => r.cv.id));
  const of = (c: string) => [...own, ...typeRows].filter((r) => r.m.primaryClassification === c).map((r) => r.cv.id);
  const [ext] = of("exterior");
  const cabins = of("cabin").slice(0, 2);
  const [plan] = of("floor_plan");
  if (!ext || cabins.length < 2 || !plan) return null;
  if (scope.kind === "aircraft" && ![ext, ...cabins, plan].some((id) => ownIds.has(id))) return null;
  return { exterior: ext, cabins: cabins as [string, string], floorPlan: plan };
}

/** The scope's combined photos now in the gallery (made here or uploaded), newest first. */
export async function existingCombined(db: Db, tenantId: string, scope: CombinedScope) {
  const rows = await scopePhotos(db, tenantId, scope);
  return rows.filter((r) => r.m.primaryClassification === "combined").map((r) => ({ mediaId: r.m.id, generated: isGenerated(r.ev) })).reverse();
}

export type MakeCombinedResult = { made: true; mediaId: string; replaced: number } | { made: false; reason: string };

/**
 * Make the combined photo and save it as an approved Combined photo of the aircraft (or type).
 * With replace, combined photos this app made earlier for it are retired (ones the broker uploaded are kept).
 */
export async function makeCombinedPhoto(db: Db, store: FileStore, actor: Actor, scope: CombinedScope, opts: { replace?: boolean } = {}): Promise<MakeCombinedResult> {
  const src = await combinedSources(db, actor.tenantId, scope);
  if (!src) return { made: false, reason: `It needs ${COMBINED_NEEDS}, all approved.` };
  // Google Drive sometimes refuses a read for a moment: try once more before giving up.
  const read = async (id: string) => {
    try { return (await readContentBytes(db, store, id)).bytes; }
    catch { await new Promise((r) => setTimeout(r, 400)); return (await readContentBytes(db, store, id)).bytes; }
  };
  const jpg = await buildCombinedPhoto({
    exterior: await read(src.exterior),
    cabins: [await read(src.cabins[0]), await read(src.cabins[1])],
    floorPlan: await read(src.floorPlan),
  });
  const old = opts.replace ? (await existingCombined(db, actor.tenantId, scope)).filter((c) => c.generated) : [];

  const name = scope.kind === "aircraft" ? `Combined ${scope.aircraftId.slice(0, 8)}.jpg` : `Combined type ${scope.aircraftTypeId.slice(0, 8)}.jpg`;
  const up = (await ingestUpload(db, store, actor, {
    filename: name,
    bytes: new Uint8Array(jpg),
    batchLabel: "Combined photo made by Aircraft Media",
    generated: { kind: "combined", fromContentVersionIds: [src.exterior, ...src.cabins, src.floorPlan] },
  })).result;
  const version = async () => (await db.select({ v: aircraftMedia.version }).from(aircraftMedia).where(eq(aircraftMedia.id, up.mediaId)))[0].v;
  await updateMediaMetadata(db, actor, randomUUID(), { mediaId: up.mediaId, expectedVersion: await version(), classification: "combined" });
  await setMediaAssociation(db, actor, randomUUID(), scope.kind === "aircraft"
    ? { mediaId: up.mediaId, expectedVersion: await version(), status: "actual_aircraft", aircraftId: scope.aircraftId }
    : { mediaId: up.mediaId, expectedVersion: await version(), status: "representative_type", aircraftTypeId: scope.aircraftTypeId });
  await approveMedia(db, actor, { mediaId: up.mediaId, contentVersionId: up.contentVersionId, expectedVersion: await version() });
  for (const o of old) if (o.mediaId !== up.mediaId) await retireMedia(db, actor, randomUUID(), { mediaId: o.mediaId });
  return { made: true, mediaId: up.mediaId, replaced: old.length };
}

/**
 * Make the combined photo for every aircraft and type in the workspace that has enough photos and no combined photo yet.
 * Runs after photos are approved or changed. Returns how many were made; one failure does not stop the others.
 */
export async function ensureCombinedPhotos(db: Db, store: FileStore, actor: Actor): Promise<{ made: number; failed: string[] }> {
  const acs = await db.select({ id: aircraft.id, typeId: aircraft.aircraftTypeId }).from(aircraft).where(eq(aircraft.tenantId, actor.tenantId));
  const typeRows = await db
    .selectDistinct({ typeId: mediaAssociations.aircraftTypeId })
    .from(mediaAssociations)
    .innerJoin(aircraftMedia, eq(aircraftMedia.id, mediaAssociations.aircraftMediaId))
    .where(and(eq(aircraftMedia.tenantId, actor.tenantId), eq(mediaAssociations.active, true), eq(mediaAssociations.associationStatus, "representative_type")));
  const scopes: CombinedScope[] = [
    ...acs.map((a) => ({ kind: "aircraft" as const, aircraftId: a.id, aircraftTypeId: a.typeId })),
    ...typeRows.filter((t) => t.typeId).map((t) => ({ kind: "type" as const, aircraftTypeId: t.typeId! })),
  ];
  let made = 0;
  const failed: string[] = [];
  for (const s of scopes) {
    if ((await existingCombined(db, actor.tenantId, s)).length) continue;
    if (!(await combinedSources(db, actor.tenantId, s))) continue;
    try {
      if ((await makeCombinedPhoto(db, store, actor, s)).made) made++;
    } catch (e) {
      failed.push(`${s.kind === "aircraft" ? s.aircraftId : s.aircraftTypeId}: ${(e as Error).message}`);
    }
  }
  return { made, failed };
}
