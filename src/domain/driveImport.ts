import { and, eq } from "drizzle-orm";
import { actionExecutions, driveSyncState } from "../db/schema";
import type { Db } from "../db/client";
import type { Actor } from "./action";
import { ALLOWED_IMAGE_MIME } from "./constants";
import { DomainError, invalid } from "./errors";
import { ingestPdf, pdfDriveKey } from "./intake";
import { ingestUpload } from "./media";
import { DriveClient, DriveError, FOLDER_MIME, type DriveFile } from "../storage/drive";
import type { FileStore } from "../storage";

export type DriveItemOutcome = "imported" | "already_imported" | "unsupported" | "failed";

export interface DriveImportSummary {
  folderId: string;
  folderName: string | null;
  imported: number;
  alreadyImported: number;
  unsupported: number;
  failed: number;
  /** more files were found than one run handles; run Refresh again to continue */
  truncated: boolean;
  items: { fileId: string; name: string; outcome: DriveItemOutcome; error?: string; mediaIds?: string[] }[];
}

const MAX_FILES_PER_RUN = 100;
const MAX_DEPTH = 6;

/** Accepts a folder ID or a Drive folder URL. */
export function parseFolderRef(ref: string): string | null {
  const t = ref.trim();
  const m = t.match(/\/folders\/([\w-]{10,})/) ?? t.match(/[?&]id=([\w-]{10,})/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(t) ? t : null;
}

const revisionOf = (f: DriveFile) => f.headRevisionId ?? f.md5Checksum ?? f.modifiedTime ?? "0";

/**
 * Import photos and PDFs from one folder tree inside the configured `Aircraft Media` root.
 *  - Only that tree is listed (never the whole account); the folder must be inside the root.
 *  - Duplicate identity is Drive file ID + revision, so unchanged files are skipped BEFORE any download
 *    and repeated runs do no repeated work; an edited file (new revision) imports as new.
 *  - Originals stay where they are in Drive; the app references them in place.
 *  - Every file is its own idempotent action: one failure never blocks or rolls back the others.
 *  - Anything else in the folder (documents, videos, …) is counted as unsupported, not an error.
 */
export async function importDriveFolder(
  db: Db,
  client: DriveClient,
  store: FileStore,
  actor: Actor,
  folderRef: string,
): Promise<DriveImportSummary> {
  const folderId = parseFolderRef(folderRef);
  if (!folderId) throw invalid("Enter a Google Drive folder link or ID");
  let folder: DriveFile;
  try {
    if (!(await client.isWithinRoot(folderId))) throw new DomainError("OUTSIDE_ROOT", "That folder is not inside the Aircraft Media Drive folder, so it will not be imported.");
    folder = await client.getFile(folderId);
  } catch (e) {
    if (e instanceof DriveError) throw new DomainError("DRIVE_ERROR", e.status === 404 ? "That Drive folder was not found or is not shared with the app." : e.message);
    throw e;
  }
  if (folder.mimeType !== FOLDER_MIME) throw invalid("That Drive link is a file, not a folder");

  const startedAt = new Date();
  const summary: DriveImportSummary = { folderId, folderName: folder.name, imported: 0, alreadyImported: 0, unsupported: 0, failed: 0, truncated: false, items: [] };
  let handled = 0;

  // Each Drive folder is one set in Review (photos of one aircraft usually sit in one folder).
  const walk = async (id: string, depth: number, path: string): Promise<void> => {
    let children: DriveFile[];
    try {
      children = await client.listChildren(id);
    } catch (e) {
      summary.failed++;
      summary.items.push({ fileId: id, name: "(folder)", outcome: "failed", error: e instanceof Error ? e.message : "listing failed" });
      return;
    }
    for (const f of children) {
      if (summary.truncated) return;
      if (f.mimeType === FOLDER_MIME) {
        if (depth < MAX_DEPTH) await walk(f.id, depth + 1, `${path} / ${f.name}`);
        continue;
      }
      const isImage = (ALLOWED_IMAGE_MIME as readonly string[]).includes(f.mimeType);
      const isPdf = f.mimeType === "application/pdf";
      if (!isImage && !isPdf) {
        summary.unsupported++;
        continue;
      }
      if (handled >= MAX_FILES_PER_RUN) {
        summary.truncated = true;
        return;
      }
      const revision = revisionOf(f);
      const actionName = isPdf ? "media.uploadPdf" : "media.importDrive";
      const key = isPdf ? pdfDriveKey(f.id, revision) : `drive:${f.id}:${revision}`;
      const [done] = await db
        .select({ id: actionExecutions.id, status: actionExecutions.status })
        .from(actionExecutions)
        .where(and(eq(actionExecutions.tenantId, actor.tenantId), eq(actionExecutions.actionName, actionName), eq(actionExecutions.idempotencyKey, key)));
      if (done && (done.status === "succeeded" || done.status === "partially_succeeded")) {
        summary.alreadyImported++;
        continue;
      }
      handled++;
      try {
        const bytes = await client.download(f.id);
        const drive = { fileId: f.id, revision };
        const set = { batchId: `drive:${id}`, batchLabel: `Drive: ${path}` };
        if (isPdf) {
          const r = await ingestPdf(db, store, actor, { filename: f.name, bytes, drive, ...set });
          summary.imported++;
          summary.items.push({ fileId: f.id, name: f.name, outcome: "imported", mediaIds: r.result.extracted.map((x) => x.mediaId), error: r.result.skipped.length ? `${r.result.skipped.length} embedded image(s) skipped` : r.result.status === "no_images" ? "no embedded photos found" : undefined });
        } else {
          const r = await ingestUpload(db, store, actor, { filename: f.name, bytes, drive, ...set });
          summary.imported++;
          summary.items.push({ fileId: f.id, name: f.name, outcome: "imported", mediaIds: [r.result.mediaId] });
        }
      } catch (e) {
        summary.failed++;
        summary.items.push({ fileId: f.id, name: f.name, outcome: "failed", error: e instanceof DomainError || e instanceof DriveError ? e.message : "Unexpected error while importing this file" });
      }
    }
  };
  await walk(folderId, 0, folder.name);

  await db
    .insert(driveSyncState)
    .values({ tenantId: actor.tenantId, folderId, folderName: folder.name, lastSyncedAt: startedAt, lastSummary: { ...summary, items: undefined } })
    .onConflictDoUpdate({
      target: [driveSyncState.tenantId, driveSyncState.folderId],
      set: { folderName: folder.name, lastSyncedAt: startedAt, lastSummary: { ...summary, items: undefined }, updatedAt: new Date() },
    });
  return summary;
}
