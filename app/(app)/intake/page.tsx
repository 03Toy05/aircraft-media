import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { driveSyncState } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { getDriveClient } from "@/storage";
import type { DriveImportSummary } from "@/domain/driveImport";
import { driveImportAction, uploadMediaAction } from "../../actions";
import { Flash, one, type SP } from "../../_components/ui";
import UploadForm from "../../_components/UploadForm";

import type { UploadResult as Result } from "../../actions";

function parse<T>(raw: string | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default async function Intake({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor, isAdmin } = await requireOwner();
  const db = await getDb();
  const results = parse<Result[]>(one(sp.r), []);
  const drive = parse<DriveImportSummary | null>(one(sp.d), null);
  const driveOn = getDriveClient() !== null;
  const showDrive = isAdmin; // the Drive folder is the admin's; everyone else uploads
  const folders = await db.select().from(driveSyncState).where(eq(driveSyncState.tenantId, actor.tenantId)).orderBy(desc(driveSyncState.lastSyncedAt));
  const label: Record<Result["status"], string> = {
    new: "Received",
    partial: "Received — some items skipped",
    duplicate: "Sent before (the same file) — nothing duplicated",
    failed: "Failed",
  };
  return (
    <>
      <h1>Upload photos</h1>
      <Flash error={one(sp.error)} />
      {results.length > 0 && (
        <div className="card">
          <h3>What happened</h3>
          <table>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td>{label[r.status]}{r.error ? `: ${r.error}` : ""}{r.detail ? <div className="small muted">{r.detail}</div> : null}</td>
                  <td>{r.mediaId && <Link href={`/review/${r.mediaId}`}>Open</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small"><Link href="/review">Check and approve them in Review →</Link></p>
        </div>
      )}
      <UploadForm action={uploadMediaAction} />

      {showDrive && <div className="card">
        <h3>Google Drive</h3>
        {!driveOn ? (
          <p className="muted">Not connected. Set the Drive credentials described in <code>docs/CONFIGURATION.md</code> to import from the Aircraft Media folder.</p>
        ) : (
          <>
            <p className="muted small">Imports photos and PDFs from a folder inside the Aircraft Media folder. Originals stay where they are; files already imported are skipped without downloading again.</p>
            {drive && (
              <div className="flash ok">
                <b>{drive.folderName}</b>: {drive.imported} imported, {drive.alreadyImported} already imported, {drive.unsupported} not photos/PDFs, {drive.failed} failed{drive.truncated ? " — more files remain; run again to continue" : ""}.
                {drive.items.length > 0 && <ul className="small">{drive.items.map((i) => <li key={i.fileId + i.outcome}>{i.name}: {i.outcome}{i.error ? ` (${i.error})` : ""}</li>)}</ul>}
              </div>
            )}
            <form action={driveImportAction} className="row">
              <div><label htmlFor="folder">Folder link or ID (leave empty for the whole Aircraft Media folder)</label><input id="folder" name="folder" placeholder="https://drive.google.com/drive/folders/…" /></div>
              <div style={{ flex: "0 0 auto" }}><button type="submit">Import</button></div>
            </form>
            {folders.length > 0 && (
              <table style={{ marginTop: 10 }}>
                <thead><tr><th>Folder</th><th>Last import</th><th></th></tr></thead>
                <tbody>{folders.map((f) => (
                  <tr key={f.id}>
                    <td>{f.folderName ?? f.folderId}</td>
                    <td className="small">{f.lastSyncedAt?.toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td><form action={driveImportAction}><input type="hidden" name="folder" value={f.folderId} /><button className="secondary" type="submit">Refresh</button></form></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </>
        )}
      </div>}
      <div className="card">
        <h3>WhatsApp</h3>
        <p className="muted">Not connected yet. To send photos and details from your phone, open an aircraft and tap <b>Share</b>.</p>
      </div>
    </>
  );
}
