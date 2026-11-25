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
import { serverT } from "@/lib/uiLang";

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
  const t = await serverT();
  const { actor, isAdmin } = await requireOwner();
  const db = await getDb();
  const results = parse<Result[]>(one(sp.r), []);
  const drive = parse<DriveImportSummary | null>(one(sp.d), null);
  const driveOn = getDriveClient() !== null;
  const showDrive = isAdmin; // the Drive folder is the admin's; everyone else uploads
  const folders = await db.select().from(driveSyncState).where(eq(driveSyncState.tenantId, actor.tenantId)).orderBy(desc(driveSyncState.lastSyncedAt));
  const label: Record<Result["status"], string> = {
    new: t("Received"),
    partial: t("Received — some items skipped"),
    duplicate: t("Sent before (the same file) — nothing duplicated"),
    failed: t("Failed"),
  };
  return (
    <>
      <h1>{t("Upload photos")}</h1>
      <Flash error={one(sp.error)} />
      {results.length > 0 && (
        <div className="card">
          <h3>{t("What happened")}</h3>
          <table>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td>{label[r.status]}{r.error ? `: ${r.error}` : ""}{r.detail ? <div className="small muted">{r.detail}</div> : null}</td>
                  <td>{r.mediaId && <Link href={`/review/${r.mediaId}`}>{t("Open")}</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small"><Link href="/review">{t("Check and approve them in Review →")}</Link></p>
        </div>
      )}
      <UploadForm action={uploadMediaAction} />

      {showDrive && <div className="card">
        <h3>Google Drive</h3>
        {!driveOn ? (
          <p className="muted">{t("Not connected. Set the Drive credentials described in")} <code>docs/CONFIGURATION.md</code> {t("to import from the Aircraft Media folder.")}</p>
        ) : (
          <>
            <p className="muted small">{t("Imports photos and PDFs from a folder inside the Aircraft Media folder. Originals stay where they are; files already imported are skipped without downloading again.")}</p>
            {drive && (
              <div className="flash ok">
                <b>{drive.folderName}</b>: {drive.truncated
                  ? t("{imported} imported, {already} already imported, {unsupported} not photos/PDFs, {failed} failed — more files remain; run again to continue.", { imported: drive.imported, already: drive.alreadyImported, unsupported: drive.unsupported, failed: drive.failed })
                  : t("{imported} imported, {already} already imported, {unsupported} not photos/PDFs, {failed} failed.", { imported: drive.imported, already: drive.alreadyImported, unsupported: drive.unsupported, failed: drive.failed })}
                {drive.items.length > 0 && <ul className="small">{drive.items.map((i) => <li key={i.fileId + i.outcome}>{i.name}: {i.outcome}{i.error ? ` (${i.error})` : ""}</li>)}</ul>}
              </div>
            )}
            <form action={driveImportAction} className="row">
              <div><label htmlFor="folder">{t("Folder link or ID (leave empty for the whole Aircraft Media folder)")}</label><input id="folder" name="folder" placeholder="https://drive.google.com/drive/folders/…" /></div>
              <div style={{ flex: "0 0 auto" }}><button type="submit">{t("Import")}</button></div>
            </form>
            {folders.length > 0 && (
              <table style={{ marginTop: 10 }}>
                <thead><tr><th>{t("Folder")}</th><th>{t("Last import")}</th><th></th></tr></thead>
                <tbody>{folders.map((f) => (
                  <tr key={f.id}>
                    <td>{f.folderName ?? f.folderId}</td>
                    <td className="small">{f.lastSyncedAt?.toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td><form action={driveImportAction}><input type="hidden" name="folder" value={f.folderId} /><button className="secondary" type="submit">{t("Refresh")}</button></form></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </>
        )}
      </div>}
      <div className="card">
        <h3>WhatsApp</h3>
        <p className="muted">{t("Not connected yet. To send photos and details from your phone, open an aircraft and tap")} <b>{t("Share")}</b>{t(".")}</p>
      </div>
    </>
  );
}
