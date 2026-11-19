import { after } from "next/server";
import { getDb } from "@/db/client";
import { getDriveClient, getFileStore } from "@/storage";
import { exportRootFor, exportToDrive, type ExportSummary } from "@/domain/cbosExport";
import { ensureCombinedPhotos } from "@/domain/combinedPhoto";
import type { Session } from "./session";
import { devBypassEnabled } from "./owner";

/** One export at a time per workspace, so two quick approvals never upload the same photo twice. */
const running = new Map<string, Promise<unknown>>();

/** Queue work for a workspace behind whatever is already running for it. */
function queued<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
  const prev = running.get(tenantId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(work);
  running.set(tenantId, next);
  return next;
}

export function runExport(s: Pick<Session, "actor" | "isAdmin" | "email">): Promise<ExportSummary> {
  const client = getDriveClient();
  if (!client) return Promise.reject(new Error("Google Drive is not connected"));
  return queued(s.actor.tenantId, async () => exportToDrive(await getDb(), client, getFileStore(), s.actor.tenantId, exportRootFor(s.isAdmin, s.email)));
}

/** Make the missing combined photos for the workspace (see combinedPhoto.ts). */
export function runCombine(s: Pick<Session, "actor">) {
  return queued(s.actor.tenantId, async () => ensureCombinedPhotos(await getDb(), getFileStore(), s.actor));
}

/**
 * After photos are approved or changed, once the response has gone out (so saving stays fast):
 *  1. make the combined photo for any aircraft that now has enough photos, then
 *  2. refresh the CBOS export.
 * Best effort: a failure is logged and the next change (or the buttons) catches up.
 */
export function exportAfterResponse(s: Pick<Session, "actor" | "isAdmin" | "email">) {
  // Local development shares the real Drive: never write there automatically. Combined photos are still made when
  // new files go to local disk.
  const dev = devBypassEnabled();
  const combine = !dev || getFileStore().kind === "local";
  const exportNow = !!getDriveClient() && !dev;
  if (!combine && !exportNow) return;
  after(async () => {
    if (combine) {
      try {
        const r = await runCombine(s);
        if (r.failed.length) console.error("Combined photos: some failed", r.failed);
      } catch (e) {
        console.error("Combined photos failed", e);
      }
    }
    if (exportNow) {
      try {
        const r = await runExport(s);
        if (r.failed.length) console.error("CBOS export: some photos failed", r.failed);
      } catch (e) {
        console.error("CBOS export failed", e);
      }
    }
  });
}
