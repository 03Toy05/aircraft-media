import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftMedia } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { CLASSIFICATION_LABEL } from "@/domain/constants";

/** Every approved photo, newest first. */
export default async function AllPhotos() {
  const { actor } = await requireOwner();
  const db = await getDb();
  const rows = await db
    .select()
    .from(aircraftMedia)
    .where(and(eq(aircraftMedia.tenantId, actor.tenantId), eq(aircraftMedia.reviewState, "approved"), eq(aircraftMedia.lifecycleState, "active")))
    .orderBy(desc(aircraftMedia.updatedAt))
    .limit(300);
  return (
    <>
      <p className="small"><Link href="/">← Dashboard</Link></p>
      <h1>Approved photos</h1>
      {rows.length === 0 ? <div className="card muted">Nothing approved yet.</div> : (
        <div className="card">
          <div className="thumbs">
            {rows.map((m) => (
              <Link key={m.id} href={`/review/${m.id}`} title={CLASSIFICATION_LABEL[m.primaryClassification]}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${m.currentContentVersionId}`} alt={CLASSIFICATION_LABEL[m.primaryClassification]} />
              </Link>
            ))}
          </div>
          {rows.length === 300 && <p className="muted small">Showing the latest 300.</p>}
        </div>
      )}
    </>
  );
}
