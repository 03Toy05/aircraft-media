import { and, eq } from "drizzle-orm";
import { aircraftMedia, mediaAssociations, mediaContentVersions, processingProposals, sourceEvidence } from "../db/schema";
import type { Db } from "../db/client";
import { runAction, type Actor } from "./action";
import { parseAircraftCard } from "./card";
import { invalid } from "./errors";
import { extractPdfImages, PDF_EXTRACTION_VERSION, type SkippedImage } from "./pdf";
import { sha256 } from "../lib/hash";
import { scanView } from "./autoView";
import type { FileStore } from "../storage";
import { reopenMedia, type DriveSource } from "./media";

export const MAX_PDF_BYTES = 40 * 1024 * 1024;

/** How a PDF from Drive is recognised as already read. Includes the extraction version: when extraction improves, it is read once more. */
export const pdfDriveKey = (fileId: string, revision: string | number) => `pdf:drive:${fileId}:${revision}:${PDF_EXTRACTION_VERSION}`;

export interface PdfIntakeResult {
  pdfEvidenceId: string;
  status: "processed" | "partially_processed" | "no_images";
  pageCount: number;
  extracted: { mediaId: string; contentVersionId: string; page: number; objectName: string; width: number; height: number }[];
  skipped: SkippedImage[];
}

/**
 * PDF intake. The complete original is retained first (as source evidence), then each embedded photo
 * becomes its own reviewable media with its page and image reference and the extraction version.
 * Duplicate identity is the PDF's content hash, so a repeat returns the first result and extracts nothing again.
 * Items that cannot be extracted are reported (partially_processed), never silently dropped or merged.
 * Extraction does not establish identity, operator, rights or configuration: every photo starts
 * unclassified/unresolved in needs_review.
 */
export async function ingestPdf(db: Db, store: FileStore, actor: Actor, input: { filename: string; bytes: Uint8Array; cardText?: string | null; drive?: DriveSource; batchId?: string | null; batchLabel?: string | null }) {
  const { bytes } = input;
  const drive = input.drive;
  if (bytes.byteLength === 0) throw invalid("The file is empty");
  if (bytes.byteLength > MAX_PDF_BYTES) throw invalid(`PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB`);
  if (new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).indexOf("%PDF-") === -1) throw invalid("This file is not a PDF");
  const hash = sha256(bytes);

  return runAction<Record<string, unknown>, PdfIntakeResult>({
    db,
    actor,
    name: "media.uploadPdf",
    // The extraction version is part of the key: when extraction improves, sending the same PDF again reads it afresh.
    idempotencyKey: drive ? pdfDriveKey(drive.fileId, drive.revision) : `pdf:sha256:${hash}:${PDF_EXTRACTION_VERSION}`,
    input: drive ? { hash, fileId: drive.fileId, revision: drive.revision } : { hash },
    fingerprintOf: drive ? { fileId: drive.fileId, revision: drive.revision } : { hash },
    statusOf: (r) => (r.status === "partially_processed" ? "partially_succeeded" : "succeeded"),
    handler: async (tx) => {
      let extraction;
      try {
        extraction = await extractPdfImages(bytes);
      } catch (e) {
        throw invalid((e as Error).message);
      }
      // A PDF that came from Drive stays where it is; a manual upload is filed under Sources/.
      const pdfRef = drive ? drive.fileId : await store.put(bytes, input.filename, "Sources", "application/pdf");
      const [pdfEv] = await tx
        .insert(sourceEvidence)
        .values({
          tenantId: actor.tenantId,
          sourceKind: "pdf",
          originalFilename: input.filename,
          senderId: actor.id,
          originalText: input.cardText?.trim() || null,
          contentHash: hash,
          providerSourceId: drive?.fileId ?? null,
          originalDriveFileId: drive?.fileId ?? null,
          originalDriveVersion: drive?.revision ?? null,
          metadata: {
            ...(input.batchId ? { batchId: input.batchId } : {}),
            ...(input.batchLabel ? { batchLabel: input.batchLabel } : {}),
            mime: "application/pdf",
            storageKind: drive ? "drive" : store.kind,
            storageRef: pdfRef,
            pageCount: extraction.pageCount,
            extractionVersion: PDF_EXTRACTION_VERSION,
            imagesFound: extraction.images.length,
            skipped: extraction.skipped,
          },
        })
        .returning({ id: sourceEvidence.id });

      const extracted: PdfIntakeResult["extracted"] = [];
      for (const img of extraction.images) {
        const imgHash = sha256(img.bytes);
        // Already in this workspace (the same PDF read again, or the photo sent on its own before): reuse it, no duplicate.
        const [already] = await tx
          .select({ mediaId: aircraftMedia.id, cvId: mediaContentVersions.id })
          .from(mediaContentVersions)
          .innerJoin(aircraftMedia, eq(aircraftMedia.id, mediaContentVersions.aircraftMediaId))
          .where(and(eq(aircraftMedia.tenantId, actor.tenantId), eq(mediaContentVersions.contentHash, imgHash), eq(aircraftMedia.lifecycleState, "active")))
          .limit(1);
        if (already) {
          extracted.push({ mediaId: already.mediaId, contentVersionId: already.cvId, page: img.page, objectName: img.objectName, width: img.width, height: img.height });
          continue;
        }
        const ref = await store.put(img.bytes, `p${img.page}-${img.objectName}`, "Processing", img.mimeType);
        const view = await scanView(img.bytes, ""); // brochures often carry the floor plan
        const [ev] = await tx
          .insert(sourceEvidence)
          .values({
            tenantId: actor.tenantId,
            sourceKind: "extracted_image",
            parentEvidenceId: pdfEv.id,
            pageNumber: img.page,
            cropRef: { x: 0, y: 0, width: img.width, height: img.height, extractionVersion: PDF_EXTRACTION_VERSION },
            senderId: actor.id,
            contentHash: imgHash,
            metadata: { pdfImageObject: img.objectName, ...(view.reason ? { autoView: view.classification, autoViewReason: view.reason } : {}) },
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
            storageKind: store.kind,
            storageRef: ref,
            contentHash: imgHash,
            mimeType: img.mimeType,
            sizeBytes: img.bytes.byteLength,
            width: img.width,
            height: img.height,
            isDerivative: true,
            sourceEvidenceId: ev.id,
            createdBy: actor.id,
          })
          .returning({ id: mediaContentVersions.id });
        await tx.update(aircraftMedia).set({ currentContentVersionId: cv.id }).where(eq(aircraftMedia.id, media.id));
        if (input.cardText?.trim()) {
          await tx.insert(processingProposals).values({
            tenantId: actor.tenantId,
            sourceEvidenceId: pdfEv.id,
            aircraftMediaId: media.id,
            proposalType: "details",
            provider: "deterministic-card-parser",
            model: "card-v1",
            proposal: parseAircraftCard(input.cardText) as unknown as Record<string, unknown>,
          });
        }
        extracted.push({ mediaId: media.id, contentVersionId: cv.id, page: img.page, objectName: img.objectName, width: img.width, height: img.height });
      }

      const status: PdfIntakeResult["status"] = extraction.images.length === 0 ? "no_images" : extraction.skipped.length > 0 ? "partially_processed" : "processed";
      return { pdfEvidenceId: pdfEv.id, status, pageCount: extraction.pageCount, extracted, skipped: extraction.skipped };
    },
  });
}

export interface ReviewStanding {
  /** Waiting in Review already (new, or sent before and not decided yet). */
  waiting: string[];
  /** Removed or rejected before; sent again, so back in Review. */
  reopened: string[];
  /** Approved before: already on an aircraft (or a type), nothing to review. */
  approved: { mediaId: string; aircraftId: string | null }[];
}

/**
 * After an upload: where each of its photos stands. A photo the workspace already had is reused, never copied, so it
 * keeps its earlier state. One that was removed or rejected comes back to Review, since it was just sent again on
 * purpose; one already approved stays where it is, and the upload says so instead of claiming it is waiting.
 */
export async function bringBackForReview(db: Db, actor: Actor, mediaIds: string[]): Promise<ReviewStanding> {
  const out: ReviewStanding = { waiting: [], reopened: [], approved: [] };
  for (const id of [...new Set(mediaIds)]) {
    const [m] = await db.select().from(aircraftMedia).where(and(eq(aircraftMedia.id, id), eq(aircraftMedia.tenantId, actor.tenantId)));
    if (!m || m.lifecycleState !== "active") continue;
    if (m.reviewState === "approved") {
      const [a] = await db.select({ aircraftId: mediaAssociations.aircraftId }).from(mediaAssociations)
        .where(and(eq(mediaAssociations.aircraftMediaId, id), eq(mediaAssociations.active, true)));
      out.approved.push({ mediaId: id, aircraftId: a?.aircraftId ?? null });
    } else if (m.reviewState === "rejected") {
      await reopenMedia(db, actor, `reopen-on-upload:${id}:${m.version}`, { mediaId: id, expectedVersion: m.version });
      out.reopened.push(id);
    } else out.waiting.push(id);
  }
  return out;
}
