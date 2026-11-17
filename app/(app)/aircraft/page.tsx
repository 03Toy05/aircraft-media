import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftTypes, organisations } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { getCatalogue } from "@/domain/catalogue";
import { addTypeAliasAction, createAircraftAction, createTypeAction } from "../../actions";
import { Badge, Flash, Key, one, type SP } from "../../_components/ui";

export default async function AircraftList({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor } = await requireOwner();
  const db = await getDb();
  const types = await db.select().from(aircraftTypes).where(eq(aircraftTypes.tenantId, actor.tenantId)).orderBy(asc(aircraftTypes.model));
  const orgs = await db.select().from(organisations).where(eq(organisations.tenantId, actor.tenantId)).orderBy(asc(organisations.canonicalName));
  const rows = await getCatalogue(db, actor.tenantId);
  const tailInUse = (one(sp.error) ?? "").includes("another aircraft");

  return (
    <>
      <h1>Aircraft</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Tail</th><th>Aircraft</th><th>Operator</th><th>Base</th><th>Availability</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">No aircraft yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.aircraftId}>
                <td><Link href={`/aircraft/${r.aircraftId}`}>{r.tail}</Link></td><td>{r.aircraft}</td><td>{r.operator ?? "–"}</td><td>{r.base ?? "–"}</td><td><Badge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid g2">
        <form action={createAircraftAction} className="card" id="create">
          <h3>Add aircraft</h3>
          <Key />
          {types.length === 0 && <p className="muted">Create an aircraft type first (right).</p>}
          <label>Aircraft type</label>
          <select name="aircraftTypeId" required defaultValue={one(sp.typeId) ?? ""}><option value="" disabled>Choose…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.manufacturer} {t.model}</option>)}</select>
          <div className="row">
            <div><label>Tail number</label><input name="registration" required defaultValue={one(sp.tail)} /></div>
            <div><label>Serial number</label><input name="serialNumber" /></div>
          </div>
          <label>Operator</label>
          <select name="operatorId" defaultValue={one(sp.operatorId) ?? ""}><option value="">Not recorded / new operator below</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.canonicalName}</option>)}</select>
          <label>…or add a new operator now (used only when none is chosen above)</label>
          <input name="newOperatorName" defaultValue={one(sp.newOperator)} placeholder="e.g. Jet Aviation Hong Kong" />
          <div className="row">
            <div><label>Base</label>
              <select name="baseMode" defaultValue={one(sp.baseMode) ?? ""}><option value="">Not recorded</option><option value="based">Based at…</option><option value="floating">Floating</option></select></div>
            <div><label>Locations (separate with commas)</label><input name="baseLocations" defaultValue={one(sp.baseLocations)} placeholder="Hong Kong, Singapore" /></div>
          </div>
          <div className="row">
            <div><label>YOM</label><input name="yom" type="number" defaultValue={one(sp.yom)} /></div>
            <div><label>YOR</label><input name="yor" type="number" defaultValue={one(sp.yor)} /></div>
            <div><label>Capacity</label><input name="capacity" type="number" defaultValue={one(sp.capacity)} /></div>
            <div><label>WIFI</label>
              <select name="wifiStatus" defaultValue={one(sp.wifi) ?? "unknown"}><option value="yes">Yes</option><option value="no">No</option><option value="tbc">TBC</option><option value="unknown">Unknown</option></select></div>
          </div>
          <label>Notes</label><input name="notes" defaultValue={one(sp.notes)} placeholder="Owner's approval required" />
          {tailInUse && <label style={{ color: "var(--warn)" }}><input type="checkbox" name="tailResolution" value="distinct_aircraft" /> This is a different aircraft that uses the same tail number</label>}
          <p><button type="submit">Create aircraft</button></p>
        </form>

        <div>
          <form action={createTypeAction} className="card">
            <h3>Add aircraft type</h3><Key />
            <div className="row">
              <div><label>Manufacturer</label><input name="manufacturer" required placeholder="Gulfstream" /></div>
              <div><label>Model / variant</label><input name="model" required placeholder="G650ER" /></div>
            </div>
            <label>Other names (comma separated, optional)</label><input name="aliases" placeholder="G650 ER, GVI" />
            <p><button type="submit">Create type</button></p>
          </form>
          <div className="card">
            <h3>Types and aliases</h3>
            {types.length === 0 ? <p className="muted">None yet.</p> : types.map((t) => (
              <form key={t.id} action={addTypeAliasAction} className="row" style={{ marginBottom: 6 }}>
                <Key /><input type="hidden" name="aircraftTypeId" value={t.id} />
                <div style={{ flex: "1 1 140px" }}>{t.manufacturer} {t.model}</div>
                <div><input name="alias" placeholder="add alias" required /></div>
                <div style={{ flex: "0 0 auto" }}><button className="secondary" type="submit">Add</button></div>
              </form>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
