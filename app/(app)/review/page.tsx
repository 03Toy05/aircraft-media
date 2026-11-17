import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftMedia } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { CLASSIFICATION_LABEL } from "@/domain/constants";

export default async function ReviewQueue() {
  const { actor } = await requireOwner();
  const db = await getDb();
  const rows = await db
    .select()
    .from(aircraftMedia)
    .where(and(eq(aircraftMedia.tenantId, actor.tenantId), inArray(aircraftMedia.reviewState, ["needs_review", "rejected", "failed", "partially_processed", "processing"])))
    .orderBy(desc(aircraftMedia.createdAt));
  return (
    <>
      <h1>Review</h1>
      {rows.length === 0 ? <div className="card muted">Nothing waiting for review.</div> : (
        <div className="card">
          <table>
            <thead><tr><th></th><th>State</th><th>Classification</th><th>Association</th><th>Lifecycle</th><th>Received</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{/* eslint-disable-next-line @next/next/no-img-element */}<Link href={`/review/${m.id}`}><img src={`/api/media/${m.currentContentVersionId}`} alt="" style={{ width: 90, height: 64, objectFit: "cover", borderRadius: 4 }} /></Link></td>
                  <td>{m.reviewState.replace(/_/g, " ")}</td>
                  <td>{CLASSIFICATION_LABEL[m.primaryClassification]}</td>
                  <td>{m.associationStatus.replace(/_/g, " ")}</td>
                  <td>{m.lifecycleState}</td>
                  <td className="small">{m.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
