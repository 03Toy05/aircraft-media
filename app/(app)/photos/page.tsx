import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftMedia, cbosExports } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { getDriveClient } from "@/storage";
import { CLASSIFICATION_LABEL } from "@/domain/constants";
import { exportRootFor } from "@/domain/cbosExport";
import { exportCbosAction } from "../../actions";
import { Flash, one, type SP } from "../../_components/ui";

/** Every approved photo, newest first, and the CBOS export of them. */
export default async function AllPhotos({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor, isAdmin, email, readOnly } = await requireOwner();
  const db = await getDb();
  const rows = await db
    .select()
    .from(aircraftMedia)
    .where(and(eq(aircraftMedia.tenantId, actor.tenantId), eq(aircraftMedia.reviewState, "approved"), eq(aircraftMedia.lifecycleState, "active")))
    .orderBy(desc(aircraftMedia.updatedAt))
    .limit(300);
  const exported = await db.select({ id: cbosExports.id, at: cbosExports.updatedAt }).from(cbosExports).where(eq(cbosExports.tenantId, actor.tenantId));
  const last = exported.reduce<Date | null>((m, x) => (!m || x.at > m ? x.at : m), null);
  const driveOn = getDriveClient() !== null;
  return (
    <>
      <h1>Approved photos</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      {rows.length === 0 ? <div className="card muted">Nothing approved yet.</div> : (
        <div className="card">
          <div className="thumbs">
            {rows.map((m) => (
              <Link key={m.id} href={`/review/${m.id}`} title={CLASSIFICATION_LABEL[m.primaryClassification]}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${m.currentContentVersionId}`} alt={CLASSIFICATION_LABEL[m.primaryClassification]} loading="lazy" />
              </Link>
            ))}
          </div>
          {rows.length === 300 && <p className="muted small">Showing the latest 300.</p>}
        </div>
      )}
      {/* Admin detail: folded below the photos so brokers see their photos first. */}
      <details className="card collapse">
        <summary>Export for CBOS <span className="muted small" style={{ fontWeight: 400, marginLeft: 6 }}>{exported.length} of {rows.length} exported</span></summary>
        <p className="muted small">
          Approved photos are copied into Google Drive under <b>{exportRootFor(isAdmin, email).join(" / ")}</b>, named the way CBOS imports them
          (for example <code>Operator Aircraft / Metrojet / B-KXX / Exterior_01.jpg</code>, or <code>Private Aircraft / Heavy Jets / BOMBARDIER_CHALLENGER_650_Floorplan_01.jpg</code> for
          photos of a type). A data sheet, <code>aircraft-media.csv</code>, lists every photo with its IDs, aircraft, operator, view and source, so CBOS can match them exactly.
          Your original files and their names are never changed. The export updates itself after you approve or change photos.
        </p>
        <p className="small">{exported.length} of {rows.length} photo{rows.length === 1 ? "" : "s"} exported{last ? `, last on ${last.toISOString().slice(0, 16).replace("T", " ")}` : ""}.</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {driveOn && <form action={exportCbosAction}><button type="submit" disabled={readOnly}>Export to Drive now</button></form>}
          <a className="btn secondary" href="/api/export/aircraft-media" download>Download the data sheet (CSV)</a>
        </div>
        {!driveOn && <p className="muted small">Google Drive is not connected, so only the data sheet is available.</p>}
      </details>
    </>
  );
}
