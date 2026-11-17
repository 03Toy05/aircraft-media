import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftTypes, organisations } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { AVAILABILITY_STATUSES, getCatalogue, type AvailabilityStatus } from "@/domain/catalogue";
import { CLASSIFICATIONS, CLASSIFICATION_LABEL, type Classification } from "@/domain/constants";
import { Badge, one, type SP } from "../../_components/ui";

export default async function Catalogue({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor } = await requireOwner();
  const db = await getDb();
  const orgs = await db.select().from(organisations).where(eq(organisations.tenantId, actor.tenantId)).orderBy(asc(organisations.canonicalName));
  const types = await db.select().from(aircraftTypes).where(eq(aircraftTypes.tenantId, actor.tenantId)).orderBy(asc(aircraftTypes.model));

  const missing = one(sp.missing) as Classification | undefined;
  const status = one(sp.status) as AvailabilityStatus | undefined;
  const kind = one(sp.kind);
  const rows = await getCatalogue(db, actor.tenantId, {
    q: one(sp.q) || undefined,
    operatorId: one(sp.operatorId) || undefined,
    aircraftTypeId: one(sp.typeId) || undefined,
    tail: one(sp.tail) || undefined,
    base: one(sp.base) || undefined,
    floatingOnly: one(sp.floating) === "1",
    mediaKind: kind === "actual" || kind === "representative" ? kind : undefined,
    missingClass: missing && CLASSIFICATIONS.includes(missing) ? missing : undefined,
    status: status && AVAILABILITY_STATUSES.includes(status) ? status : undefined,
  });

  const cell = (r: (typeof rows)[number], c: Classification) => {
    const x = r.cells[c];
    return (
      <td key={c}>
        {x.actual + x.representative + x.pending === 0 ? <span className="muted">–</span> : (
          <span className={`badge s-${x.status}`} title={`${x.actual} actual, ${x.representative} representative, ${x.pending} awaiting review`}>
            {x.actual}{x.representative ? ` +${x.representative}r` : ""}{x.pending ? ` (${x.pending}?)` : ""}
          </span>
        )}
      </td>
    );
  };
  const others = (r: (typeof rows)[number]) =>
    CLASSIFICATIONS.filter((c) => !["exterior", "cabin", "floor_plan", "unclassified"].includes(c))
      .filter((c) => r.cells[c].actual + r.cells[c].representative > 0)
      .map((c) => `${CLASSIFICATION_LABEL[c]} ${r.cells[c].actual + r.cells[c].representative}`)
      .join(", ");

  return (
    <>
      <h1>Availability catalogue</h1>
      <form className="card" method="get">
        <div className="row">
          <div><label>Search</label><input name="q" defaultValue={one(sp.q)} placeholder="operator, aircraft, tail, base" /></div>
          <div><label>Operator</label>
            <select name="operatorId" defaultValue={one(sp.operatorId) ?? ""}><option value="">All</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.canonicalName}</option>)}</select></div>
          <div><label>Aircraft type</label>
            <select name="typeId" defaultValue={one(sp.typeId) ?? ""}><option value="">All</option>{types.map((t) => <option key={t.id} value={t.id}>{t.manufacturer} {t.model}</option>)}</select></div>
          <div><label>Tail</label><input name="tail" defaultValue={one(sp.tail)} /></div>
          <div><label>Base</label><input name="base" defaultValue={one(sp.base)} /></div>
        </div>
        <div className="row">
          <div><label>Missing view</label>
            <select name="missing" defaultValue={missing ?? ""}><option value="">Any</option>{CLASSIFICATIONS.filter((c) => c !== "unclassified").map((c) => <option key={c} value={c}>{CLASSIFICATION_LABEL[c]}</option>)}</select></div>
          <div><label>Has media of kind</label>
            <select name="kind" defaultValue={kind ?? ""}><option value="">Any</option><option value="actual">Actual aircraft</option><option value="representative">Representative</option></select></div>
          <div><label>Status</label>
            <select name="status" defaultValue={status ?? ""}><option value="">Any</option>{AVAILABILITY_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select></div>
          <div><label><input type="checkbox" name="floating" value="1" defaultChecked={one(sp.floating) === "1"} /> Floating only</label></div>
          <div style={{ flex: "0 0 auto" }}><button type="submit">Filter</button> <Link href="/catalogue">Reset</Link></div>
        </div>
      </form>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Operator</th><th>Aircraft</th><th>Tail</th><th>Base</th><th>EXT</th><th>CABIN</th><th>FLOOR PLAN</th><th>Other</th><th>Overall</th><th>Last approved</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} className="muted">No aircraft match.</td></tr>}
            {rows.map((r) => (
              <tr key={r.aircraftId}>
                <td>{r.operator ?? <span className="muted">–</span>}</td>
                <td><Link href={`/aircraft/${r.aircraftId}`}>{r.aircraft}</Link></td>
                <td>{r.tail}</td>
                <td>{r.base ?? <span className="muted">–</span>}</td>
                {cell(r, "exterior")}{cell(r, "cabin")}{cell(r, "floor_plan")}
                <td className="small">{others(r) || <span className="muted">–</span>}</td>
                <td><Badge status={r.status} /></td>
                <td className="small">{r.lastApproved ? r.lastApproved.toISOString().slice(0, 10) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Counts are approved, active photos. “+Nr” = representative (type-level) photos; “(N?)” = awaiting review.</p>
      </div>
    </>
  );
}
