import { eq } from "drizzle-orm";
import { aircraftMedia, mediaContentVersions, processingProposals, sourceEvidence } from "../db/schema";
import type { Db } from "../db/client";
import { runAction, type Actor } from "./action";
import { parseAircraftCard } from "./card";
import { invalid } from "./errors";
import { extractPdfImages, PDF_EXTRACTION_VERSION, type SkippedImage } from "./pdf";
import { sha256 } from "../lib/hash";
import { scanView } from "./autoView";
import type { FileStore } from "../storage";
import type { DriveSource } from "./media";

export const MAX_PDF_BYTES = 40 * 1024 * 1024;

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
export async function ingestPdf(db: Db, store: FileStore, actor: Actor, input: { filename: string; bytes: Uint8Array; cardText?: string | null; drive?: DriveSource; batchId?: string | null }) {
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
    idempotencyKey: drive ? `pdf:drive:${drive.fileId}:${drive.revision}` : `pdf:sha256:${hash}`,
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
        const ref = await store.put(img.bytes, `p${img.page}-${img.objectName}`, "Processing", img.mimeType);
        const imgHash = sha256(img.bytes);
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
