import Link from "next/link";
import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftMedia } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { getCatalogue } from "@/domain/catalogue";
import { Badge } from "../_components/ui";

export default async function Dashboard() {
  const { actor } = await requireOwner();
  const db = await getDb();
  const n = async (state: (typeof aircraftMedia.$inferSelect)["reviewState"]) =>
    (await db.select({ c: count() }).from(aircraftMedia).where(and(eq(aircraftMedia.tenantId, actor.tenantId), eq(aircraftMedia.reviewState, state), eq(aircraftMedia.lifecycleState, "active"))))[0].c;
  const [needsReview, approved, failed, partial, processing] = await Promise.all([n("needs_review"), n("approved"), n("failed"), n("partially_processed"), n("processing")]);
  const recent = await db
    .select()
    .from(aircraftMedia)
    .where(and(eq(aircraftMedia.tenantId, actor.tenantId), eq(aircraftMedia.reviewState, "approved")))
    .orderBy(desc(aircraftMedia.updatedAt))
    .limit(8);
  const cat = await getCatalogue(db, actor.tenantId);
  const byStatus = new Map<string, number>();
  for (const r of cat) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);

  return (
    <>
      <h1>Dashboard</h1>
      <form action="/catalogue" className="card row">
        <div>
          <label htmlFor="q">Quick search — operator, aircraft, tail number or base</label>
          <input id="q" name="q" placeholder="e.g. Metrojet, G650ER, B-KXX, Hong Kong" />
        </div>
        <div style={{ flex: "0 0 auto" }}><button type="submit">Search</button></div>
      </form>
      <div className="grid g4">
        <Link href="/review" className="card stat"><b>{needsReview}</b>Needs review</Link>
        <div className="card stat"><b>{processing}</b>Processing</div>
        <div className="card stat"><b>{approved}</b>Approved photos</div>
        <div className="card stat"><b>{failed + partial}</b>Failed / partial</div>
      </div>
      <div className="grid g2">
        <div className="card">
          <h3>Aircraft by availability</h3>
          {cat.length === 0 ? <p className="muted">No aircraft yet. <Link href="/aircraft">Add one</Link>.</p> : (
            <table><tbody>
              {[...byStatus.entries()].map(([s, c]) => (
                <tr key={s}><td><Badge status={s} /></td><td>{c}</td><td><Link href={`/catalogue?status=${s}`}>View</Link></td></tr>
              ))}
            </tbody></table>
          )}
        </div>
        <div className="card">
          <h3>Recently approved</h3>
          {recent.length === 0 ? <p className="muted">Nothing approved yet.</p> : (
            <div className="thumbs">
              {recent.map((m) => (
                <Link key={m.id} href={`/review/${m.id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/media/${m.currentContentVersionId}`} alt={m.primaryClassification} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
