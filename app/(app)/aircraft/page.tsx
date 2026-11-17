import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftTypes, organisations } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { getCatalogue } from "@/domain/catalogue";
import { AIRCRAFT_CATEGORIES, AIRCRAFT_CATEGORY_LABEL } from "@/domain/constants";
import { STANDARD_AIRCRAFT_TYPES } from "@/domain/standardTypes";
import { addTypeAliasAction, createAircraftAction, createTypeAction, loadStandardTypesAction, setTypeCategoryAction } from "../../actions";
import { Badge, Flash, Key, one, type SP } from "../../_components/ui";

export default async function AircraftList({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor } = await requireOwner();
  const db = await getDb();
  const types = await db.select().from(aircraftTypes).where(eq(aircraftTypes.tenantId, actor.tenantId)).orderBy(asc(aircraftTypes.model));
  const orgs = await db.select().from(organisations).where(eq(organisations.tenantId, actor.tenantId)).orderBy(asc(organisations.canonicalName));
  const rows = await getCatalogue(db, actor.tenantId);
  const tailInUse = (one(sp.error) ?? "").includes("another aircraft");
  const groups = [...AIRCRAFT_CATEGORIES, "none" as const]
    .map((k) => ({
      key: k,
      label: k === "none" ? "No category" : AIRCRAFT_CATEGORY_LABEL[k],
      items: types.filter((t) => (k === "none" ? !t.category || !(AIRCRAFT_CATEGORIES as readonly string[]).includes(t.category) : t.category === k)),
    }))
    .filter((g) => g.items.length > 0);

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
                <td><Link href={`/aircraft/${r.aircraftId}`}>{r.tail ?? "(no tail yet)"}</Link></td><td>{r.aircraft}</td><td>{r.operator ?? "–"}</td><td>{r.base ?? "–"}</td><td><Badge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid g2">
        <form action={createAircraftAction} className="card" id="create">
          <h3>Add aircraft</h3>
          <Key />
          {types.length === 0 && <p className="muted">No aircraft types yet. The standard list loads automatically; refresh the page.</p>}
          <label>Aircraft type</label>
          <select name="aircraftTypeId" required defaultValue={one(sp.typeId) ?? ""}>
            <option value="" disabled>Choose…</option>
            {groups.map((g) => (
              <optgroup key={g.key} label={g.label}>{g.items.map((t) => <option key={t.id} value={t.id}>{t.manufacturer} {t.model}</option>)}</optgroup>
            ))}
          </select>
          <div className="row">
            <div><label>Tail number</label><input name="registration" defaultValue={one(sp.tail)} placeholder="Optional. Add it later if unknown" /></div>
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
          <form action={loadStandardTypesAction} className="card">
            <h3>Standard aircraft types</h3><Key />
            <p className="muted small">About {STANDARD_AIRCRAFT_TYPES.length} common business jets, turboprops, executive airliners and helicopters are loaded automatically, each with a size category (light jet, heavy jet, and so on). Use the button to check for newly added types. Nothing you already have is changed.</p>
            <button type="submit" className="secondary">Check for new standard types</button>
          </form>
          <form action={createTypeAction} className="card">
            <h3>Add aircraft type</h3><Key />
            <div className="row">
              <div><label>Manufacturer</label><input name="manufacturer" required placeholder="Gulfstream" /></div>
              <div><label>Model / variant</label><input name="model" required placeholder="G650ER" /></div>
            </div>
            <label>Category</label>
            <select name="category" defaultValue=""><option value="">Not set</option>{AIRCRAFT_CATEGORIES.map((c) => <option key={c} value={c}>{AIRCRAFT_CATEGORY_LABEL[c]}</option>)}</select>
            <label>Other names (comma separated, optional)</label><input name="aliases" placeholder="G650 ER, GVI" />
            <p className="muted small">An “other name” (alias) is another way the same aircraft type gets written, so a card that says “G650 ER” still finds “Gulfstream G650ER”.</p>
            <p><button type="submit">Create type</button></p>
          </form>
          <div className="card">
            <h3>Types, categories and other names</h3>
            {types.length === 0 ? <p className="muted">None yet.</p> : types.map((t) => (
              <div key={t.id} style={{ marginBottom: 8 }}>
                <form action={setTypeCategoryAction} className="row">
                  <Key /><input type="hidden" name="aircraftTypeId" value={t.id} />
                  <div style={{ flex: "1 1 140px" }}>{t.manufacturer} {t.model}</div>
                  <div><select name="category" defaultValue={t.category ?? ""}><option value="">No category</option>{AIRCRAFT_CATEGORIES.map((c) => <option key={c} value={c}>{AIRCRAFT_CATEGORY_LABEL[c]}</option>)}</select></div>
                  <div style={{ flex: "0 0 auto" }}><button className="secondary" type="submit">Save</button></div>
                </form>
                <form action={addTypeAliasAction} className="row">
                  <Key /><input type="hidden" name="aircraftTypeId" value={t.id} />
                  <div><input name="alias" placeholder="add another name" required /></div>
                  <div style={{ flex: "0 0 auto" }}><button className="secondary" type="submit">Add name</button></div>
                </form>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
