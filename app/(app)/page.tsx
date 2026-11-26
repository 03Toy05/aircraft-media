import Link from "next/link";
import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftMedia } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import ChatClient from "../_components/ChatClient";
import Toy from "../_components/Toy";
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
      <div className="dash-main">
        <ChatClient sample={sample} firstSteps={firstSteps} />

        <section className="dash-requests" aria-labelledby="dash-req-title">
          <div className="dash-head">
            <h2 id="dash-req-title">{t("Recent requests")}</h2>
            {requests.length > 0 && <Link href="/requests">{t("All requests")} →</Link>}
          </div>
          {requests.length === 0 ? (
            <div className="dash-invite">
              <Toy size={44} />
              <p><b>{t("No requests yet.")}</b><br /><span className="muted">{t("Your first quote takes a few clicks.")}</span></p>
              <Link className="btn dash-invite-btn" href="/quote?fresh=1">{t("Draft your first quote")}</Link>
            </div>
          ) : (
            <div className="dash-request-cards">
              {requests.map((r) => (
                <Link key={r.id} href={`/requests/${r.id}`} className="dash-request-card">
                  <span className="dash-request-top"><b>{r.reference}</b><span className={`dash-badge ${r.versions ? "is-quoted" : "is-new"}`}>{r.versions ? `v${r.versions}` : t("no quote yet")}</span></span>
                  <span className="muted small">{r.label}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <aside className="dash-side">
        <div className="card">
          <h3>{t("Shortcuts")}</h3>
          <div className="dash-shortcuts">
            <Link className="btn secondary" href="/review"><Icon name="review" />{t("Review photos")}{needsReview > 0 && <span className="dash-count">{t("{n} waiting", { n: needsReview })}</span>}</Link>
            <Link className="btn secondary" href="/intake"><Icon name="upload" />{t("Upload photos")}</Link>
            <Link className="btn secondary" href="/fleet?add=aircraft#add-aircraft"><Icon name="plane" />{t("Add aircraft or operator")}</Link>
          </div>
        </div>
        <div className="card">
          <h3>{t("Recently approved")}</h3>
          {recent.length === 0 ? (
            <>
              <p className="muted small" style={{ marginTop: 0 }}>{t("Photos you approve show up here.")}</p>
              <Link className="btn secondary dash-wide" href="/intake"><Icon name="upload" />{t("Upload your first photos")}</Link>
            </>
          ) : (
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
