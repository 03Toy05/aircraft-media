import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import sharp from "sharp";
import {
  aircraft,
  aircraftMedia,
  aircraftTypes,
  organisations,
  mediaAssociations,
  mediaContentVersions,
  processingProposals,
  sourceEvidence,
} from "../db/schema";
import type { Db } from "../db/client";
import { runAction, type Actor, type Tx } from "./action";
import { parseAircraftCard } from "./card";
import {
  ALLOWED_IMAGE_MIME,
  CLASSIFICATIONS,
  MAX_UPLOAD_BYTES,
  RIGHTS_STATUSES,
  type AssociationStatus,
  type Classification,
  type RightsStatus,
  displayLabel,
} from "./constants";
import { DomainError, conflict, invalid, notFound } from "./errors";
import { sha256 } from "../lib/hash";
import { scanView } from "./autoView";
import type { FileStore, StorageKind } from "../storage";

type Q = Db | Tx;

const FORMAT_TO_MIME: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
export const CROP_EXTRACTION_VERSION = "manual-crop-1";

// ---------------------------------------------------------------- upload

/** A photo that already lives in Google Drive: we reference it in place and never move or copy the original. */
export interface DriveSource {
  fileId: string;
  /** Drive revision id when known, else the md5 checksum. Part of the duplicate identity. */
  revision: string;
}

export interface UploadInput {
  filename: string;
  bytes: Uint8Array;
  cardText?: string | null;
  drive?: DriveSource;
  /** Files sent together share one batch id, so the details given once can be applied to all of them. */
  batchId?: string | null;
  /** How the set is named in Review, e.g. "Drive: Aircraft Media / Metrojet / B-KXX". */
  batchLabel?: string | null;
}

export const ensureImageBytes = async (bytes: Uint8Array) => {
  if (bytes.byteLength === 0) throw invalid("The file is empty");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw invalid(`File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    throw invalid("This file is not a readable image. Upload JPEG, PNG or WebP (or a PDF).");
  }
  const mime = meta.format ? FORMAT_TO_MIME[meta.format] : undefined;
  if (!mime || !(ALLOWED_IMAGE_MIME as readonly string[]).includes(mime)) throw invalid("Only JPEG, PNG or WebP images are supported");
  return { meta, mime };
};

/**
 * Image intake. Retains the original and registers it idempotently:
 *  - manual upload: duplicate identity is the content hash (same bytes, even renamed, return the first result)
 *  - Drive file:    duplicate identity is Drive file ID + revision (the original stays where it is in Drive)
 * The photo starts unclassified/unresolved in needs_review. Upload success does not imply
 * classification, association or approval.
 */
export async function ingestUpload(db: Db, store: FileStore, actor: Actor, input: UploadInput) {
  const { meta, mime } = await ensureImageBytes(input.bytes);
  const hash = sha256(input.bytes);
  const drive = input.drive;
  const view = await scanView(input.bytes, input.filename); // first pass, confirmed by the broker in Review
  return runAction({
    db,
    actor,
    name: drive ? "media.importDrive" : "media.upload",
    idempotencyKey: drive ? `drive:${drive.fileId}:${drive.revision}` : `sha256:${hash}`,
    input: drive ? { fileId: drive.fileId, revision: drive.revision } : { hash },
    fingerprintOf: drive ? { fileId: drive.fileId, revision: drive.revision } : { hash }, // renamed re-upload is a retry, not key reuse
    handler: async (tx) => {
      const storageKind = drive ? "drive" : store.kind;
      const ref = drive ? drive.fileId : await store.put(input.bytes, input.filename, "Sources", mime);
      const [ev] = await tx
        .insert(sourceEvidence)
        .values({
          tenantId: actor.tenantId,
          sourceKind: drive ? "drive" : "manual",
          providerSourceId: drive?.fileId ?? null,
          originalDriveFileId: drive?.fileId ?? null,
          originalDriveVersion: drive?.revision ?? null,
          originalFilename: input.filename,
          senderId: actor.id,
          originalText: input.cardText?.trim() || null,
          contentHash: hash,
          metadata: { mime, uploadedVia: drive ? "drive-import" : "web", ...(input.batchId ? { batchId: input.batchId } : {}), ...(input.batchLabel ? { batchLabel: input.batchLabel } : {}), ...(view.reason ? { autoView: view.classification, autoViewReason: view.reason } : {}) },
        })
        .returning({ id: sourceEvidence.id });
      const [media] = await tx
        .insert(aircraftMedia)
        .values({ tenantId: actor.tenantId, reviewState: "needs_review", primaryClassification: view.classification, createdSourceEvidenceId: ev.id })
        .returning({ id: aircraftMedia.id });
      const [cv] = await tx
        .insert(mediaContentVersions)
        .values({
          aircraftMediaId: media.id,
          versionNumber: 1,
          storageKind,
          storageRef: ref,
          driveRevision: drive?.revision ?? null,
          contentHash: hash,
          mimeType: mime,
          sizeBytes: input.bytes.byteLength,
          width: meta.width ?? null,
          height: meta.height ?? null,
          isDerivative: false,
          sourceEvidenceId: ev.id,
          createdBy: actor.id,
        })
        .returning({ id: mediaContentVersions.id });
      await tx.update(aircraftMedia).set({ currentContentVersionId: cv.id }).where(eq(aircraftMedia.id, media.id));

      let proposalId: string | null = null;
      if (input.cardText?.trim()) {
        const parsed = parseAircraftCard(input.cardText);
        const [p] = await tx
          .insert(processingProposals)
          .values({
            tenantId: actor.tenantId,
            sourceEvidenceId: ev.id,
            aircraftMediaId: media.id,
            proposalType: "details",
            provider: "deterministic-card-parser",
            model: "card-v1",
            proposal: parsed as unknown as Record<string, unknown>,
          })
          .returning({ id: processingProposals.id });
        proposalId = p.id;
      }
      return { mediaId: media.id, evidenceId: ev.id, contentVersionId: cv.id, proposalId };
    },
  });
}

// ---------------------------------------------------------------- metadata, association, review

async function loadMedia(tx: Q, actor: Actor, mediaId: string) {
  const [m] = await tx.select().from(aircraftMedia).where(and(eq(aircraftMedia.id, mediaId), eq(aircraftMedia.tenantId, actor.tenantId)));
  if (!m) throw notFound("Media");
  return m;
}

function checkVersion(m: { version: number }, expected: number) {
  if (m.version !== expected) throw conflict("VERSION_MISMATCH", `This media changed (now version ${m.version}). Reload and retry.`, { currentVersion: m.version });
}

/** Any change to classification, association or content invalidates a previous approval. */
function reviewAfterChange(state: string) {
  return state === "approved" ? ("needs_review" as const) : undefined;
}

export interface MetadataInput {
  mediaId: string;
  expectedVersion: number;
  classification?: Classification;
  displayOrder?: number;
  rightsStatus?: RightsStatus;
}

export function updateMediaMetadata(db: Db, actor: Actor, key: string, input: MetadataInput) {
  return runAction({
    db,
    actor,
    name: "media.updateMetadata",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const m = await loadMedia(tx, actor, input.mediaId);
      checkVersion(m, input.expectedVersion);
      if (input.classification && !CLASSIFICATIONS.includes(input.classification)) throw invalid("Unknown classification");
      if (input.rightsStatus && !RIGHTS_STATUSES.includes(input.rightsStatus)) throw invalid("Unknown rights status");
      if (input.displayOrder != null && (!Number.isInteger(input.displayOrder) || input.displayOrder < 0)) throw invalid("Order must be a whole number, 0 or more");
      const changesMeaning = input.classification && input.classification !== m.primaryClassification;
      await tx
        .update(aircraftMedia)
        .set({
          primaryClassification: input.classification ?? m.primaryClassification,
          displayOrder: input.displayOrder ?? m.displayOrder,
          rightsStatus: input.rightsStatus ?? m.rightsStatus,
          reviewState: changesMeaning ? (reviewAfterChange(m.reviewState) ?? m.reviewState) : m.reviewState,
          version: m.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(aircraftMedia.id, m.id));
      return { mediaId: m.id, version: m.version + 1 };
    },
  });
}

export interface AssociationInput {
  mediaId: string;
  expectedVersion: number;
  status: AssociationStatus;
  aircraftId?: string | null;
  aircraftTypeId?: string | null;
  organisationId?: string | null;
}

/** Classification is not identity: association is a separate, explicitly reviewed fact. */
export function setMediaAssociation(db: Db, actor: Actor, key: string, input: AssociationInput) {
  return runAction({
    db,
    actor,
    name: "media.setAssociation",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const m = await loadMedia(tx, actor, input.mediaId);
      checkVersion(m, input.expectedVersion);
      let aircraftId: string | null = null;
      let aircraftTypeId: string | null = null;
      if (input.status === "actual_aircraft") {
        if (!input.aircraftId) throw invalid("Choose the exact aircraft this photo shows");
        const [ac] = await tx.select().from(aircraft).where(and(eq(aircraft.id, input.aircraftId), eq(aircraft.tenantId, actor.tenantId)));
        if (!ac) throw notFound("Aircraft");
        aircraftId = ac.id;
        aircraftTypeId = ac.aircraftTypeId;
      } else if (input.status === "representative_type") {
        if (!input.aircraftTypeId) throw invalid("Choose the aircraft type this photo represents");
        const [t] = await tx.select().from(aircraftTypes).where(and(eq(aircraftTypes.id, input.aircraftTypeId), eq(aircraftTypes.tenantId, actor.tenantId)));
        if (!t) throw notFound("Aircraft type");
        aircraftTypeId = t.id;
      }
      let organisationId: string | null = null;
      if (input.organisationId) {
        const [o] = await tx.select().from(organisations).where(and(eq(organisations.id, input.organisationId), eq(organisations.tenantId, actor.tenantId)));
        if (!o) throw notFound("Organisation");
        organisationId = o.id;
      }
      await tx
        .update(mediaAssociations)
        .set({ active: false })
        .where(and(eq(mediaAssociations.aircraftMediaId, m.id), eq(mediaAssociations.active, true)));
      await tx.insert(mediaAssociations).values({
        aircraftMediaId: m.id,
        aircraftId,
        aircraftTypeId,
        organisationId,
        associationStatus: input.status,
        sourceEvidenceId: m.createdSourceEvidenceId,
        reviewedBy: actor.id,
        reviewedAt: new Date(),
      });
      await tx
        .update(aircraftMedia)
        .set({
          associationStatus: input.status,
          reviewState: reviewAfterChange(m.reviewState) ?? m.reviewState,
          version: m.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(aircraftMedia.id, m.id));
      return { mediaId: m.id, version: m.version + 1 };
    },
  });
}

/** Approve one exact content version. Idempotent per (content version, media version, actor). */
export function approveMedia(db: Db, actor: Actor, input: { mediaId: string; contentVersionId: string; expectedVersion: number }) {
  return runAction({
    db,
    actor,
    name: "media.approve",
    idempotencyKey: `${input.contentVersionId}:v${input.expectedVersion}:${actor.id}`,
    input,
    handler: async (tx) => {
      const m = await loadMedia(tx, actor, input.mediaId);
      checkVersion(m, input.expectedVersion);
      if (m.lifecycleState !== "active") throw conflict("MEDIA_RETIRED", "Retired media cannot be approved. Restore it first.");
      if (m.currentContentVersionId !== input.contentVersionId) throw conflict("CONTENT_CHANGED", "The photo content changed since you reviewed it.");
      if (m.reviewState !== "needs_review") throw conflict("NOT_IN_REVIEW", `Media is ${m.reviewState}, not awaiting review.`);
      if (m.primaryClassification === "unclassified") throw invalid("Choose a classification before approving");
      if (m.associationStatus === "unresolved") throw invalid("Resolve the association (actual aircraft or representative type) before approving");
      await tx
        .update(aircraftMedia)
        .set({ reviewState: "approved", rejectionReason: null, version: m.version + 1, updatedAt: new Date() })
        .where(eq(aircraftMedia.id, m.id));
      return { mediaId: m.id, version: m.version + 1 };
    },
  });
}

export function rejectMedia(db: Db, actor: Actor, key: string, input: { mediaId: string; expectedVersion: number; reason?: string }) {
  return runAction({
    db,
    actor,
    name: "media.reject",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const m = await loadMedia(tx, actor, input.mediaId);
      checkVersion(m, input.expectedVersion);
      if (m.reviewState !== "needs_review") throw conflict("NOT_IN_REVIEW", `Media is ${m.reviewState}, not awaiting review.`);
      await tx
        .update(aircraftMedia)
        .set({ reviewState: "rejected", rejectionReason: input.reason?.trim() || null, version: m.version + 1, updatedAt: new Date() })
        .where(eq(aircraftMedia.id, m.id));
      return { mediaId: m.id, version: m.version + 1 };
    },
  });
}

export function reopenMedia(db: Db, actor: Actor, key: string, input: { mediaId: string; expectedVersion: number }) {
  return runAction({
    db,
    actor,
    name: "media.reopen",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const m = await loadMedia(tx, actor, input.mediaId);
      checkVersion(m, input.expectedVersion);
      if (m.reviewState !== "rejected") throw conflict("NOT_REJECTED", "Only rejected media can be reopened.");
      await tx.update(aircraftMedia).set({ reviewState: "needs_review", version: m.version + 1, updatedAt: new Date() }).where(eq(aircraftMedia.id, m.id));
      return { mediaId: m.id, version: m.version + 1 };
    },
  });
}

// ---------------------------------------------------------------- lifecycle (logical retire, never physical delete)

export function retireMedia(db: Db, actor: Actor, key: string, input: { mediaId: string }) {
  return runAction({
    db,
    actor,
    name: "media.retire",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const m = await loadMedia(tx, actor, input.mediaId);
      if (m.lifecycleState === "retired") return { mediaId: m.id, version: m.version };
      await tx.update(aircraftMedia).set({ lifecycleState: "retired", version: m.version + 1, updatedAt: new Date() }).where(eq(aircraftMedia.id, m.id));
      return { mediaId: m.id, version: m.version + 1 };
    },
  });
}

export function restoreMedia(db: Db, actor: Actor, key: string, input: { mediaId: string }) {
  return runAction({
    db,
    actor,
    name: "media.restore",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const m = await loadMedia(tx, actor, input.mediaId);
      if (m.lifecycleState === "active") return { mediaId: m.id, version: m.version };
      await tx.update(aircraftMedia).set({ lifecycleState: "active", version: m.version + 1, updatedAt: new Date() }).where(eq(aircraftMedia.id, m.id));
      return { mediaId: m.id, version: m.version + 1 };
    },
  });
}

// ---------------------------------------------------------------- crop / separation (manual, no AI)

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function cropBytes(store: FileStore, storageRef: string, storageKind: string, rect: CropRect) {
  const bytes = await store.get(storageRef, storageKind as StorageKind);
  const meta = await sharp(bytes).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const ints = [rect.x, rect.y, rect.width, rect.height].every(Number.isInteger);
  if (!ints || rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || rect.x + rect.width > W || rect.y + rect.height > H) {
    throw invalid(`Crop must be whole pixels inside the ${W}x${H} image`);
  }
  const out = await sharp(bytes).extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height }).toBuffer();
  const outMeta = await sharp(out).metadata();
  return { out, mime: FORMAT_TO_MIME[outMeta.format ?? ""] ?? "image/jpeg", width: rect.width, height: rect.height };
}

async function loadCurrentVersion(tx: Q, mediaId: string, contentVersionId: string) {
  const [cv] = await tx.select().from(mediaContentVersions).where(eq(mediaContentVersions.id, contentVersionId));
  if (!cv || cv.aircraftMediaId !== mediaId) throw notFound("Content version");
  return cv;
}

/**
 * Correct a crop: adds a NEW derivative content version to the same media; the earlier
 * version stays intact (it may be referenced by deliveries or exports). Re-approval needed.
 */
export function recropMedia(db: Db, store: FileStore, actor: Actor, input: { mediaId: string; sourceContentVersionId: string; rect: CropRect; key?: string }) {
  const { x, y, width, height } = input.rect;
  return runAction({
    db,
    actor,
    name: "media.recrop",
    // A per-submission key lets the same crop be applied again after an undo; without one, the same crop is a replay.
    idempotencyKey: input.key ?? `${input.sourceContentVersionId}:${x},${y},${width},${height}:${CROP_EXTRACTION_VERSION}`,
    input: { mediaId: input.mediaId, sourceContentVersionId: input.sourceContentVersionId, rect: input.rect },
    handler: async (tx) => {
      const m = await loadMedia(tx, actor, input.mediaId);
      if (m.lifecycleState !== "active") throw conflict("MEDIA_RETIRED", "Retired media cannot be changed.");
      const src = await loadCurrentVersion(tx, m.id, input.sourceContentVersionId);
      if (m.currentContentVersionId !== src.id) throw conflict("CONTENT_CHANGED", "The photo content changed since you opened it.");
      const crop = await cropBytes(store, src.storageRef, src.storageKind, input.rect);
      const ref = await store.put(crop.out, "crop", "Processing", crop.mime);
      const [ev] = await tx
        .insert(sourceEvidence)
        .values({
          tenantId: actor.tenantId,
          sourceKind: "extracted_image",
          parentEvidenceId: src.sourceEvidenceId,
          cropRef: { ...input.rect, extractionVersion: CROP_EXTRACTION_VERSION },
          senderId: actor.id,
          contentHash: sha256(crop.out),
          metadata: { parentContentVersionId: src.id, mode: "recrop" },
        })
        .returning({ id: sourceEvidence.id });
      const [latest] = await tx
        .select({ n: mediaContentVersions.versionNumber })
        .from(mediaContentVersions)
        .where(eq(mediaContentVersions.aircraftMediaId, m.id))
        .orderBy(desc(mediaContentVersions.versionNumber))
        .limit(1);
      const [cv] = await tx
        .insert(mediaContentVersions)
        .values({
          aircraftMediaId: m.id,
          versionNumber: (latest?.n ?? 0) + 1,
          storageKind: store.kind,
          storageRef: ref,
          contentHash: sha256(crop.out),
          mimeType: crop.mime,
          sizeBytes: crop.out.byteLength,
          width: crop.width,
          height: crop.height,
          isDerivative: true,
          parentContentVersionId: src.id,
          sourceEvidenceId: ev.id,
          createdBy: actor.id,
        })
        .returning({ id: mediaContentVersions.id });
      await tx
        .update(aircraftMedia)
        .set({
          currentContentVersionId: cv.id,
          reviewState: reviewAfterChange(m.reviewState) ?? m.reviewState,
          version: m.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(aircraftMedia.id, m.id));
      return { mediaId: m.id, contentVersionId: cv.id };
    },
  });
}

/**
 * Undo a crop (or go to any earlier version): points the media back at an existing content version.
 * No bytes are changed or deleted; the version being left stays in history. Re-approval is needed.
 */
export function useContentVersion(db: Db, actor: Actor, key: string, input: { mediaId: string; contentVersionId: string; expectedVersion: number }) {
  return runAction({
    db,
    actor,
    name: "media.useVersion",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const m = await loadMedia(tx, actor, input.mediaId);
      checkVersion(m, input.expectedVersion);
      if (m.lifecycleState !== "active") throw conflict("MEDIA_RETIRED", "Retired media cannot be changed.");
      const target = await loadCurrentVersion(tx, m.id, input.contentVersionId);
      if (m.currentContentVersionId === target.id) return { mediaId: m.id, contentVersionId: target.id, version: m.version };
      await tx
        .update(aircraftMedia)
        .set({
          currentContentVersionId: target.id,
          reviewState: reviewAfterChange(m.reviewState) ?? m.reviewState,
          version: m.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(aircraftMedia.id, m.id));
      return { mediaId: m.id, contentVersionId: target.id, version: m.version + 1 };
    },
  });
}

/**
 * Separate one photo out of a collage/multi-photo image as its own reviewable media.
 * The source media (original) is untouched. The new media starts unclassified/unresolved.
 */
export function extractCropAsMedia(db: Db, store: FileStore, actor: Actor, input: { mediaId: string; sourceContentVersionId: string; rect: CropRect }) {
  const { x, y, width, height } = input.rect;
  return runAction({
    db,
    actor,
    name: "media.extractCrop",
    idempotencyKey: `${input.sourceContentVersionId}:p1:${x},${y},${width},${height}:${CROP_EXTRACTION_VERSION}`,
    input,
    handler: async (tx) => {
      const m = await loadMedia(tx, actor, input.mediaId);
      const src = await loadCurrentVersion(tx, m.id, input.sourceContentVersionId);
      const crop = await cropBytes(store, src.storageRef, src.storageKind, input.rect);
      const ref = await store.put(crop.out, "crop", "Processing", crop.mime);
      const hash = sha256(crop.out);
      const [ev] = await tx
        .insert(sourceEvidence)
        .values({
          tenantId: actor.tenantId,
          sourceKind: "extracted_image",
          parentEvidenceId: src.sourceEvidenceId,
          pageNumber: 1,
          cropRef: { ...input.rect, extractionVersion: CROP_EXTRACTION_VERSION },
          senderId: actor.id,
          contentHash: hash,
          metadata: { parentContentVersionId: src.id, parentMediaId: m.id, mode: "separate" },
        })
        .returning({ id: sourceEvidence.id });
      const [nm] = await tx
        .insert(aircraftMedia)
        .values({ tenantId: actor.tenantId, reviewState: "needs_review", createdSourceEvidenceId: ev.id })
        .returning({ id: aircraftMedia.id });
      const [cv] = await tx
        .insert(mediaContentVersions)
        .values({
          aircraftMediaId: nm.id,
          versionNumber: 1,
          storageKind: store.kind,
          storageRef: ref,
          contentHash: hash,
          mimeType: crop.mime,
          sizeBytes: crop.out.byteLength,
          width: crop.width,
          height: crop.height,
          isDerivative: true,
          parentContentVersionId: src.id,
          sourceEvidenceId: ev.id,
          createdBy: actor.id,
        })
        .returning({ id: mediaContentVersions.id });
      await tx.update(aircraftMedia).set({ currentContentVersionId: cv.id }).where(eq(aircraftMedia.id, nm.id));
      return { mediaId: nm.id, contentVersionId: cv.id, evidenceId: ev.id };
    },
  });
}

// ---------------------------------------------------------------- bytes

/**
 * Read exact stored bytes. If they cannot be retrieved the version is flagged unavailable
 * (so it stops counting as available); a later successful read clears the flag.
 */
export async function readContentBytes(db: Db, store: FileStore, contentVersionId: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const [cv] = await db.select().from(mediaContentVersions).where(eq(mediaContentVersions.id, contentVersionId));
  if (!cv) throw notFound("Content version");
  try {
    const bytes = await store.get(cv.storageRef, cv.storageKind as StorageKind);
    if (cv.unavailableAt) await db.update(mediaContentVersions).set({ unavailableAt: null }).where(eq(mediaContentVersions.id, cv.id));
    return { bytes, mimeType: cv.mimeType };
  } catch {
    await db.update(mediaContentVersions).set({ unavailableAt: new Date() }).where(eq(mediaContentVersions.id, cv.id));
    throw new DomainError("CONTENT_UNAVAILABLE", "The stored file could not be retrieved.");
  }
}

// ---------------------------------------------------------------- reads

export async function getMediaDetail(db: Q, tenantId: string, mediaId: string) {
  const [media] = await db.select().from(aircraftMedia).where(and(eq(aircraftMedia.id, mediaId), eq(aircraftMedia.tenantId, tenantId)));
  if (!media) return null;
  const versions = await db.select().from(mediaContentVersions).where(eq(mediaContentVersions.aircraftMediaId, mediaId)).orderBy(asc(mediaContentVersions.versionNumber));
  const [assoc] = await db.select().from(mediaAssociations).where(and(eq(mediaAssociations.aircraftMediaId, mediaId), eq(mediaAssociations.active, true)));
  const proposals = await db.select().from(processingProposals).where(eq(processingProposals.aircraftMediaId, mediaId)).orderBy(desc(processingProposals.createdAt));
  const [evidence] = media.createdSourceEvidenceId
    ? await db.select().from(sourceEvidence).where(eq(sourceEvidence.id, media.createdSourceEvidenceId))
    : [];
  return { media, versions, association: assoc ?? null, proposals, evidence: evidence ?? null };
}

export async function listReviewQueue(db: Q, tenantId: string) {
  return db
    .select()
    .from(aircraftMedia)
    .where(and(eq(aircraftMedia.tenantId, tenantId), eq(aircraftMedia.reviewState, "needs_review"), eq(aircraftMedia.lifecycleState, "active")))
    .orderBy(desc(aircraftMedia.createdAt));
}

export interface LineupItem {
  mediaId: string;
  contentVersionId: string;
  classification: Classification;
  label: string; // e.g. "EXT 1" — contextual order, not identity
  mimeType: string;
  associationStatus: AssociationStatus;
}

/** Contextual lineup: approved, active, non-restricted media with display labels per classification. */
export async function getLineup(db: Q, opts: { aircraftId: string; aircraftTypeId: string }): Promise<LineupItem[]> {
  const rows = await db
    .select({
      m: aircraftMedia,
      a: mediaAssociations,
      cv: mediaContentVersions,
    })
    .from(aircraftMedia)
    .innerJoin(mediaAssociations, and(eq(mediaAssociations.aircraftMediaId, aircraftMedia.id), eq(mediaAssociations.active, true)))
    .innerJoin(mediaContentVersions, eq(mediaContentVersions.id, aircraftMedia.currentContentVersionId))
    .where(
      and(
        eq(aircraftMedia.reviewState, "approved"),
        eq(aircraftMedia.lifecycleState, "active"),
        // Only the workspace that owns this aircraft type: types are per workspace, so this keeps users' photos apart.
        eq(aircraftMedia.tenantId, sql`(select ${aircraftTypes.tenantId} from ${aircraftTypes} where ${aircraftTypes.id} = ${opts.aircraftTypeId})`),
        opts.aircraftId ? or(eq(mediaAssociations.aircraftId, opts.aircraftId), eq(mediaAssociations.aircraftTypeId, opts.aircraftTypeId)) : eq(mediaAssociations.aircraftTypeId, opts.aircraftTypeId),
      ),
    )
    .orderBy(asc(aircraftMedia.displayOrder), asc(aircraftMedia.createdAt));
  const counters = new Map<Classification, number>();
  const out: LineupItem[] = [];
  for (const r of rows) {
    if (r.m.rightsStatus === "restricted" || r.cv.unavailableAt) continue;
    const actual = r.a.associationStatus === "actual_aircraft" && r.a.aircraftId === opts.aircraftId;
    const repr = r.a.associationStatus === "representative_type" && r.a.aircraftTypeId === opts.aircraftTypeId;
    if (!actual && !repr) continue;
    const n = (counters.get(r.m.primaryClassification) ?? 0) + 1;
    counters.set(r.m.primaryClassification, n);
    out.push({
      mediaId: r.m.id,
      contentVersionId: r.cv.id,
      classification: r.m.primaryClassification,
      label: displayLabel(r.m.primaryClassification, n),
      mimeType: r.cv.mimeType,
      associationStatus: r.a.associationStatus,
    });
  }
  return out;
}

export interface SiblingPhoto {
  mediaId: string;
  contentVersionId: string | null;
  filename: string | null;
  classification: Classification;
  /** Why the upload scan chose its view ("from the file name", "looks like a floor plan drawing"), if it did. */
  autoReason: string | null;
}

export interface WaitingGroup {
  /** Stable while the group exists: the id of its first photo. */
  key: string;
  photos: (SiblingPhoto & { receivedAt: Date })[];
  /** The card text sent with these photos (from the photo, or from the PDF it came out of). */
  evidenceText: string | null;
  /** The aircraft or type a photo in the group is already linked to, if any. */
  associatedAircraftId: string | null;
  /** Where the set came from, when known ("Drive: Aircraft Media / Metrojet"). */
  label: string | null;
}

/**
 * Every photo waiting in Review, grouped by how it arrived: the same upload (or Chocks message), the same PDF,
 * or the same card text from the same person. A group carries one source evidence, so it is assigned in one go.
 * Newest group first.
 */
export async function listWaitingGroups(db: Q, tenantId: string): Promise<WaitingGroup[]> {
  const rows = await db
    .select({ m: aircraftMedia, ev: sourceEvidence, a: mediaAssociations })
    .from(aircraftMedia)
    .innerJoin(sourceEvidence, eq(sourceEvidence.id, aircraftMedia.createdSourceEvidenceId))
    .leftJoin(mediaAssociations, and(eq(mediaAssociations.aircraftMediaId, aircraftMedia.id), eq(mediaAssociations.active, true)))
    .where(and(eq(aircraftMedia.tenantId, tenantId), eq(aircraftMedia.reviewState, "needs_review"), eq(aircraftMedia.lifecycleState, "active")))
    .orderBy(asc(aircraftMedia.createdAt));
  // A PDF's photos point at the PDF's evidence, which carries the batch id and the card text.
  const parents = new Map<string, { batchId: string | null; text: string | null; label: string | null }>();
  for (const r of rows) {
    const pid = r.ev.parentEvidenceId;
    if (pid && !parents.has(pid)) {
      const [p] = await db.select().from(sourceEvidence).where(and(eq(sourceEvidence.id, pid), eq(sourceEvidence.tenantId, tenantId)));
      const meta = p?.metadata as { batchId?: string; batchLabel?: string } | undefined;
      parents.set(pid, { batchId: meta?.batchId ?? null, text: p?.originalText?.trim() || null, label: meta?.batchLabel ?? null });
    }
  }
  // Join photos that share any key (union-find), so "same upload" and "same card text" both hold a group together.
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const pid = r.ev.parentEvidenceId;
    const batch = (r.ev.metadata as { batchId?: string } | null)?.batchId ?? (pid ? parents.get(pid)?.batchId ?? null : null);
    const text = r.ev.originalText?.trim() || null;
    const keys = [batch && `b:${batch}`, pid && `p:${pid}`, text && `t:${r.ev.senderId}:${text}`].filter(Boolean) as string[];
    for (const k of keys) {
      const j = seen.get(k);
      if (j === undefined) seen.set(k, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, WaitingGroup>();
  rows.forEach((r, i) => {
    const root = find(i);
    let g = groups.get(root);
    if (!g) {
      g = { key: r.m.id, photos: [], evidenceText: null, associatedAircraftId: null, label: null };
      groups.set(root, g);
    }
    g.photos.push({
      mediaId: r.m.id,
      contentVersionId: r.m.currentContentVersionId,
      filename: r.ev.originalFilename,
      classification: r.m.primaryClassification,
      autoReason: (r.ev.metadata as { autoViewReason?: string } | null)?.autoViewReason ?? null,
      receivedAt: r.m.createdAt,
    });
    g.evidenceText ??= r.ev.originalText?.trim() || (r.ev.parentEvidenceId ? parents.get(r.ev.parentEvidenceId)?.text ?? null : null);
    g.associatedAircraftId ??= r.a?.aircraftId ?? null;
    g.label ??= (r.ev.metadata as { batchLabel?: string } | null)?.batchLabel ?? (r.ev.parentEvidenceId ? parents.get(r.ev.parentEvidenceId)?.label ?? null : null);
  });
  return [...groups.values()].reverse();
}

/** Other photos still waiting in Review that came with this one (see listWaitingGroups). */
export async function findUploadSiblings(db: Q, tenantId: string, mediaId: string): Promise<SiblingPhoto[]> {
  const g = (await listWaitingGroups(db, tenantId)).find((x) => x.photos.some((p) => p.mediaId === mediaId));
  return (g?.photos ?? []).filter((p) => p.mediaId !== mediaId).map(({ receivedAt: _r, ...p }) => p);
}
