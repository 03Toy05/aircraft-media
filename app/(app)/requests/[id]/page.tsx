import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/session";
import { getDb } from "@/db/client";
import { getRequest, listVersions } from "@/domain/requests";
import { airportsFor } from "@/domain/airports";
import { requestLabel, routingLines } from "@/domain/routing";
import { QUOTE_WORDS } from "@/domain/quote";
import { archiveRequestAction } from "../../../requestActions";
import { Flash, one, type SP } from "../../../_components/ui";
import LocalTime from "../../../_components/LocalTime";

/** One request: its routing, and every quote saved for it (open one to change it and save the next version). */
export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const { actor } = await requireOwner();
  const db = await getDb();
  const r = await getRequest(db, actor.tenantId, id);
  if (!r) notFound();
  const versions = await listVersions(db, actor.tenantId, id);
  const airports = airportsFor(r.legs.flatMap((l) => [l.from, l.to]));
  return (
    <>
      <p className="small"><Link href="/requests">← Requests</Link></p>
      <h1 style={{ marginBottom: 2 }}>{r.reference}</h1>
      <p className="muted" style={{ marginTop: 0 }}>{requestLabel(r.legs, airports)}{r.archived ? " · archived" : ""}</p>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />

      <div className="card">
        <pre className="cardtext" style={{ margin: "0 0 8px" }}>{routingLines(r.legs, airports, QUOTE_WORDS.en, "en-GB")}</pre>
        {r.notes && <p className="small muted" style={{ margin: "0 0 8px" }}>Notes: {r.notes}</p>}
        <div className="row" style={{ gap: 6 }}>
          <div style={{ flex: "0 0 auto" }}><Link className="btn" href={`/quote?request=${r.id}${versions.length ? `&version=${versions[0].version}` : ""}`}>{versions.length ? `Edit the latest quote (v${versions[0].version})` : "Build the quote →"}</Link></div>
        </div>
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          The airports and dates stay the same for every version; departure times, flight times and passengers can change. A different routing is a new request.
        </p>
      </div>

      <h3>Saved quotes</h3>
      {versions.length === 0 && <div className="card muted">No quote saved yet.</div>}
      {versions.map((v) => (
        <div key={v.id} className="card">
          <div className="people-head">
            <span><b>Version {v.version}</b> <span className="muted small">· saved <LocalTime iso={v.createdAt.toISOString()} /></span></span>
            <Link className="btn secondary small-btn" href={`/quote?request=${r.id}&version=${v.version}`}>Open and edit</Link>
          </div>
          <ul className="small" style={{ margin: "6px 0" }}>
            {v.content.options.map((o, i) => (
              <li key={i}>{o.type}{o.operator ? ` · ${o.operator}` : ""}{o.tail ? ` · ${o.tail}` : ""}{o.price ? ` — ${o.price}` : ""} <span className="muted">({o.photos.length} photo{o.photos.length === 1 ? "" : "s"})</span></li>
            ))}
          </ul>
          <details><summary className="small">The message</summary><pre className="cardtext">{v.content.text}</pre></details>
        </div>
      ))}

      <form action={archiveRequestAction} style={{ marginTop: 16 }}>
        <input type="hidden" name="requestId" value={r.id} />
        <input type="hidden" name="archived" value={r.archived ? "0" : "1"} />
        <button type="submit" className="secondary">{r.archived ? "Move back to open requests" : "Archive this request"}</button>
      </form>
    </>
  );
}
