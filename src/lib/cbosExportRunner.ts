import { after } from "next/server";
import { getDb } from "@/db/client";
import { getDriveClient, getFileStore } from "@/storage";
import { exportRootFor, exportToDrive, type ExportSummary } from "@/domain/cbosExport";
import type { Session } from "./session";
import { devBypassEnabled } from "./owner";

/** One export at a time per workspace, so two quick approvals never upload the same photo twice. */
const running = new Map<string, Promise<unknown>>();

export function runExport(s: Pick<Session, "actor" | "isAdmin" | "email">): Promise<ExportSummary> {
  const client = getDriveClient();
  if (!client) return Promise.reject(new Error("Google Drive is not connected"));
  const prev = running.get(s.actor.tenantId) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => exportToDrive(await getDb(), client, getFileStore(), s.actor.tenantId, exportRootFor(s.isAdmin, s.email)));
  running.set(s.actor.tenantId, next);
  return next;
}

/**
 * After photos are approved, refresh the CBOS export once the response has gone out, so saving stays fast.
 * Best effort: a failure is logged and the next export (or the Export button) catches up.
 */
export function exportAfterResponse(s: Pick<Session, "actor" | "isAdmin" | "email">) {
  // Local development shares the real Drive: only export there when asked (Export button), never automatically.
  if (!getDriveClient() || devBypassEnabled()) return;
  after(async () => {
    try {
      const r = await runExport(s);
      if (r.failed.length) console.error("CBOS export: some photos failed", r.failed);
    } catch (e) {
      console.error("CBOS export failed", e);
    }
  });
}
