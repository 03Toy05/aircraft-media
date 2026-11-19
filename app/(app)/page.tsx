import Link from "next/link";
import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftMedia } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import ChatClient from "../_components/ChatClient";
import Icon from "../_components/Icon";

export default async function Dashboard() {
  const { actor } = await requireOwner();
  const db = await getDb();
  const needsReview = (
    await db
      .select({ c: count() })
      .from(aircraftMedia)
      .where(and(eq(aircraftMedia.tenantId, actor.tenantId), eq(aircraftMedia.reviewState, "needs_review"), eq(aircraftMedia.lifecycleState, "active")))
  )[0].c;
  const recent = await db
    .select()
    .from(aircraftMedia)
    .where(and(eq(aircraftMedia.tenantId, actor.tenantId), eq(aircraftMedia.reviewState, "approved"), eq(aircraftMedia.lifecycleState, "active")))
    .orderBy(desc(aircraftMedia.updatedAt))
    .limit(4);

  return (
    <div className="dash">
      <div style={{ minWidth: 0 }}>
        <h1>Chocks</h1>
        <p className="muted small">Quotes, aircraft and photos. Nothing is saved until you confirm.</p>
        <ChatClient />
      </div>
      <aside style={{ minWidth: 0 }}>
        <div className="card">
          <h3>Quick actions</h3>
          <div className="qa" style={{ display: "grid", gap: 8 }}>
            <Link className="btn" href="/review"><Icon name="review" />Review photos{needsReview > 0 ? ` (${needsReview})` : ""}</Link>
            <Link className="btn" href="/intake"><Icon name="upload" />Upload photos</Link>
            <Link className="btn" href="/quote"><Icon name="quote" />Quote for a client</Link>
            <Link className="btn" href="/fleet?add=aircraft#add-aircraft"><Icon name="plane" />Add aircraft</Link>
            <Link className="btn" href="/fleet?add=operator#add-operator"><Icon name="operator" />Add operator</Link>
            <Link className="btn secondary" style={{ color: "var(--accent)", background: "transparent" }} href="/fleet"><Icon name="list" />View operators &amp; aircraft</Link>
          </div>
        </div>
        <div className="card">
          <h3>Recently approved</h3>
          {recent.length === 0 ? <p className="muted">Nothing approved yet.</p> : (
            <>
              <div className="thumbs">
                {recent.map((m) => (
                  <Link key={m.id} href={`/review/${m.id}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/media/${m.currentContentVersionId}`} alt={m.primaryClassification} style={{ width: 110, height: 80 }} />
                  </Link>
                ))}
              </div>
              <p className="small" style={{ marginBottom: 0 }}><Link href="/photos"><Icon name="photos" />See all</Link></p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
