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
import { serverT } from "@/lib/uiLang";

/** Every approved photo, newest first, and the CBOS export of them. */
export default async function AllPhotos({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const t = await serverT();
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
      <h1>{t("Approved photos")}</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      {rows.length === 0 ? <div className="card muted">{t("Nothing approved yet.")}</div> : (
        <div className="card">
          <div className="thumbs">
            {rows.map((m) => (
              <Link key={m.id} href={`/review/${m.id}`} title={t(CLASSIFICATION_LABEL[m.primaryClassification])}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${m.currentContentVersionId}`} alt={t(CLASSIFICATION_LABEL[m.primaryClassification])} loading="lazy" />
              </Link>
            ))}
          </div>
          {rows.length === 300 && <p className="muted small">{t("Showing the latest 300.")}</p>}
        </div>
      )}
      {/* Admin detail: folded below the photos so brokers see their photos first. */}
      <details className="card collapse">
        <summary>{t("Export for CBOS")} <span className="muted small" style={{ fontWeight: 400, marginLeft: 6 }}>{t("{n} of {total} exported", { n: exported.length, total: rows.length })}</span></summary>
        <p className="muted small">
          {t("Approved photos are copied into Google Drive under")} <b>{exportRootFor(isAdmin, email).join(" / ")}</b>{t(", named the way CBOS imports them")}
          {" "}{t("(for example")} <code>Operator Aircraft / Metrojet / B-KXX / Exterior_01.jpg</code>{t(", or")} <code>Private Aircraft / Heavy Jets / BOMBARDIER_CHALLENGER_650_Floorplan_01.jpg</code> {t("for photos of a type). A data sheet,")}
          {" "}<code>aircraft-media.csv</code>{t(", lists every photo with its IDs, aircraft, operator, view and source, so CBOS can match them exactly.")}
          {" "}{t("Your original files and their names are never changed. The export updates itself after you approve or change photos.")}
        </p>
        <p className="small">{last
          ? (rows.length === 1
            ? t("{n} of {total} photo exported, last on {date}.", { n: exported.length, total: 1, date: last.toISOString().slice(0, 16).replace("T", " ") })
            : t("{n} of {total} photos exported, last on {date}.", { n: exported.length, total: rows.length, date: last.toISOString().slice(0, 16).replace("T", " ") }))
          : rows.length === 1
            ? t("{n} of {total} photo exported.", { n: exported.length, total: 1 })
            : t("{n} of {total} photos exported.", { n: exported.length, total: rows.length })}</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {driveOn && <form action={exportCbosAction}><button type="submit" disabled={readOnly}>{t("Export to Drive now")}</button></form>}
          <a className="btn secondary" href="/api/export/aircraft-media" download>{t("Download the data sheet (CSV)")}</a>
        </div>
        {!driveOn && <p className="muted small">{t("Google Drive is not connected, so only the data sheet is available.")}</p>}
      </details>
    </>
  );
}
