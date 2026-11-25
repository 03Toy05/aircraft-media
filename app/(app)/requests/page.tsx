import Link from "next/link";
import { requireOwner } from "@/lib/session";
import { getDb } from "@/db/client";
import { listRequests } from "@/domain/requests";
import { Flash, one, type SP } from "../../_components/ui";
import LocalTime from "../../_components/LocalTime";


/** Requests: start one from the client's routing (then straight to its quote), or find one to quote again. */
export default async function RequestsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor } = await requireOwner();
  const q = (one(sp.q) ?? "").trim();
  const archived = one(sp.archived) === "1";
  const rows = await listRequests(await getDb(), actor.tenantId, { q, archived });
  return (
    <>
      <h1>Requests</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <p className="muted small" style={{ marginTop: 0 }}>
        A request is the client&apos;s routing: airports, dates and passengers, entered at the top of the Quote page. Each quote you save for it
        is kept here as a version. <Link className="btn small-btn" href="/quote?fresh=1">New quote</Link>
      </p>
      <form className="row" style={{ margin: "10px 0" }}>
        {archived && <input type="hidden" name="archived" value="1" />}
        <div><input name="q" defaultValue={q} placeholder="Search reference, airport or note" aria-label="Search requests" /></div>
        <div style={{ flex: "0 0 auto" }}><button className="secondary" type="submit">Search</button></div>
      </form>
      <p className="small muted" style={{ margin: "0 0 8px" }}>
        {archived ? <Link href="/requests">← Back to open requests</Link> : <Link href="/requests?archived=1">Archived requests</Link>}
      </p>
      {rows.length === 0 && <div className="card muted">{q ? "No requests match." : archived ? "No archived requests." : "No requests yet. Enter a routing at the top of a quote and save it."}</div>}
      {rows.map((r) => (
        <Link key={r.id} href={`/requests/${r.id}`} className="card request-row">
          <span><b>{r.reference}</b> <span className="muted small">· {r.label}</span></span>
          <span className="small muted">
            {r.versions ? <>{r.versions} version{r.versions === 1 ? "" : "s"} · last saved <LocalTime iso={(r.lastSavedAt ?? r.updatedAt).toISOString()} time={false} /></> : "No quote saved yet"}
            {r.notes ? ` · ${r.notes.slice(0, 60)}${r.notes.length > 60 ? "…" : ""}` : ""}
          </span>
        </Link>
      ))}
    </>
  );
}
