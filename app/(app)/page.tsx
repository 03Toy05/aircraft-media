import Link from "next/link";
import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftMedia } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import ChatClient from "../_components/ChatClient";
import Icon from "../_components/Icon";
import { listRequests } from "@/domain/requests";
import { serverT } from "@/lib/uiLang";
import { libraryScope } from "@/domain/library";
import { isNewToQuotes, sampleAircraft, sampleQuoteText } from "@/domain/guide";

export default async function Dashboard() {
  const session = await requireOwner();
  const { actor } = session;
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
  const requests = (await listRequests(db, actor.tenantId)).slice(0, 5);
  const t = await serverT();
  // A quote line that works for this person, and whether they are new: for Toy's examples and welcome.
  const sample = sampleQuoteText(await sampleAircraft(db, actor.tenantId, await libraryScope(db, session)));
  const firstSteps = !session.viewingAs && (await isNewToQuotes(db, actor.tenantId));

  return (
    <div className="dash">
      <div style={{ minWidth: 0 }}>
        <ChatClient sample={sample} firstSteps={firstSteps} />
      </div>
      <aside style={{ minWidth: 0 }}>
        <div className="card qa-card">
          <h3>{t("Quick actions")}</h3>
          <div className="qa" style={{ display: "grid", gap: 8 }}>
            <Link className="btn" href="/review"><Icon name="review" />{t("Review photos")}{needsReview > 0 ? ` (${needsReview})` : ""}</Link>
            <Link className="btn" href="/intake"><Icon name="upload" />{t("Upload photos")}</Link>
            <Link className="btn" href="/quote?fresh=1"><Icon name="quote" />{t("New quote")}</Link>
            <Link className="btn" href="/fleet?add=aircraft#add-aircraft"><Icon name="plane" />{t("Add aircraft")}</Link>
            <Link className="btn" href="/fleet?add=operator#add-operator"><Icon name="operator" />{t("Add operator")}</Link>
            <Link className="btn secondary" style={{ color: "var(--accent)", background: "transparent" }} href="/fleet"><Icon name="list" />{t("View operators & aircraft")}</Link>
          </div>
        </div>
        <div className="card">
          <h3>{t("Recent requests")}</h3>
          {requests.length === 0 ? <p className="muted small" style={{ margin: 0 }}>{t("None yet. Enter a routing at the top of a quote and save it.")}</p> : (
            <>
              {requests.map((r) => (
                <Link key={r.id} href={`/requests/${r.id}`} className="dash-request">
                  <b>{r.reference}</b> <span className="muted small">{r.label}</span>
                  <span className="muted small"> · {r.versions ? `v${r.versions}` : t("no quote yet")}</span>
                </Link>
              ))}
              <p className="small" style={{ marginBottom: 0 }}><Link href="/requests"><Icon name="list" />{t("All requests")}</Link></p>
            </>
          )}
        </div>
        <div className="card">
          <h3>{t("Recently approved")}</h3>
          {recent.length === 0 ? <p className="muted">{t("Nothing approved yet.")}</p> : (
            <>
              <div className="thumbs">
                {recent.map((m) => (
                  <Link key={m.id} href={`/review/${m.id}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/media/${m.currentContentVersionId}`} alt={m.primaryClassification} style={{ width: 110, height: 80 }} />
                  </Link>
                ))}
              </div>
              <p className="small" style={{ marginBottom: 0 }}><Link href="/photos"><Icon name="photos" />{t("See all")}</Link></p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
