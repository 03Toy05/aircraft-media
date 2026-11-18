import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftTypes, organisations } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import Icon from "../../_components/Icon";
import OpenSection from "../../_components/OpenSection";
import { AC_SORTS, runFleetQuery, type AcSort, type OperatorSort } from "@/domain/fleetQuery";
import { getCatalogue, type CatalogueRow } from "@/domain/catalogue";
import { AIRCRAFT_CATEGORIES, AIRCRAFT_CATEGORY_LABEL } from "@/domain/constants";
import { getAircraftCard, resolveAircraftTypes } from "@/domain/directory";
import { getLineup } from "@/domain/media";
import { STANDARD_AIRCRAFT_TYPES } from "@/domain/standardTypes";
import {
  addTypeAliasAction, createAircraftAction, createOperatorThenAircraftAction, createOrganisationAction, createTypeAction, loadStandardTypesAction, setOrgRegionAction, setTypeCategoryAction,
} from "../../actions";
import { Flash, Key, one, type SP } from "../../_components/ui";

/** Operators and their aircraft on one page: each aircraft shows its details and a few approved photos. */
export default async function Fleet({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor } = await requireOwner();
  const db = await getDb();
  const orgs = await db.select().from(organisations).where(eq(organisations.tenantId, actor.tenantId)).orderBy(asc(organisations.canonicalName));
  const types = await db.select().from(aircraftTypes).where(eq(aircraftTypes.tenantId, actor.tenantId)).orderBy(asc(aircraftTypes.model));
  const rows = await getCatalogue(db, actor.tenantId);
  const tq = (one(sp.tq) ?? "").trim();
  const found = tq ? (await resolveAircraftTypes(db, actor.tenantId, tq)).slice(0, 12) : [];
  const tailInUse = (one(sp.error) ?? "").includes("another aircraft");
  const add = one(sp.add);
  const openAircraft = add === "aircraft" || !!one(sp.tail) || !!one(sp.typeId) || tailInUse;
  const openOperator = add === "operator";

  const details = new Map<string, Awaited<ReturnType<typeof detailFor>>>();
  async function detailFor(r: CatalogueRow) {
    return { card: await getAircraftCard(db, r.aircraftId), photos: (await getLineup(db, { aircraftId: r.aircraftId, aircraftTypeId: r.aircraftTypeId })).slice(0, 4) };
  }
  for (const r of rows) details.set(r.aircraftId, await detailFor(r));

  const groups = [...AIRCRAFT_CATEGORIES, "none" as const]
    .map((k) => ({
      key: k,
      label: k === "none" ? "No category" : AIRCRAFT_CATEGORY_LABEL[k],
      items: types.filter((t) => (k === "none" ? !t.category || !(AIRCRAFT_CATEGORIES as readonly string[]).includes(t.category) : t.category === k)),
    }))
    .filter((g) => g.items.length > 0);

  const AircraftCard = ({ r }: { r: CatalogueRow }) => {
    const d = details.get(r.aircraftId)!;
    const facts = [d.card?.yom != null && `YOM ${d.card.yom}`, d.card?.yor != null && `YOR ${d.card.yor}`, d.card?.capacity != null && `${d.card.capacity} seats`, r.base && `Base: ${r.base}`].filter(Boolean);
    return (
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}>
        <div>
          <Link href={`/aircraft/${r.aircraftId}`}><b>{r.aircraft}</b></Link>
          <span className="muted"> · {r.tail ?? "no tail number yet"}</span>
        </div>
        {facts.length > 0 && <div className="small muted">{facts.join(" · ")}</div>}
        {d.card?.notes && <div className="small muted">{d.card.notes}</div>}
        {d.photos.length > 0 && (
          <div className="thumbs" style={{ marginTop: 6 }}>
            {d.photos.map((p) => (
              <a key={p.contentVersionId} href={`/api/media/${p.contentVersionId}`} target="_blank" title={p.label}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${p.contentVersionId}`} alt={p.label} style={{ width: 96, height: 68 }} />
              </a>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Filters and sorting are shared with Chocks (src/domain/fleetQuery.ts), so both give the same answer.
  const wifiParam = one(sp.wifi);
  const {
    regions, baseOptions, sort, acSort, q, regionFilter, catFilter, baseFilter, wifiFilter, filtering, groups: shownGroups, unassigned,
  } = runFleetQuery(
    { orgs, rows, types, cards: new Map([...details].map(([id, d]) => [id, d.card])) },
    { q: one(sp.q), region: one(sp.region), category: one(sp.category), base: one(sp.base), sort: one(sp.sort) as OperatorSort, acsort: one(sp.acsort) as AcSort, wifi: ["yes", "no", "tbc", "unknown"].includes(wifiParam ?? "") ? (wifiParam as "yes") : undefined },
  );
  const shown = shownGroups.map((g) => g.org);

  return (
    <>
      <h1>Operators &amp; aircraft</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />

      <div className="row" style={{ marginBottom: 12 }}>
        <div style={{ flex: "0 0 auto" }}><OpenSection target="add-operator" icon="operator">Add operator</OpenSection></div>
        <div style={{ flex: "0 0 auto" }}><OpenSection target="add-aircraft" icon="plane">Add aircraft</OpenSection></div>
      </div>

      {orgs.length > 0 && (
        <form method="get" className="card row" style={{ alignItems: "end" }}>
          <div><label>Search</label><input name="q" defaultValue={q} placeholder="Operator, tail or aircraft" /></div>
          <div><label>Region</label>
            <select name="region" defaultValue={regionFilter}>
              <option value="">All regions</option>
              {regions.map((r) => <option key={r} value={r}>{r}</option>)}
              <option value="__none">No region set</option>
            </select></div>
          <div><label>Aircraft category</label>
            <select name="category" defaultValue={catFilter}>
              <option value="">All categories</option>
              {AIRCRAFT_CATEGORIES.map((c) => <option key={c} value={c}>{AIRCRAFT_CATEGORY_LABEL[c]}</option>)}
            </select></div>
          <div><label>Base</label>
            <select name="base" defaultValue={baseFilter}>
              <option value="">All bases</option>
              {baseOptions.map((b) => <option key={b} value={b}>{b}</option>)}
              <option value="__none">Base not recorded</option>
            </select></div>
          <div><label>Sort operators by</label>
            <select name="sort" defaultValue={sort}><option value="name">Name</option><option value="region">Region</option><option value="aircraft">Most aircraft</option></select></div>
          <div><label>WIFI</label>
            <select name="wifi" defaultValue={wifiFilter}><option value="">Any</option><option value="yes">Yes</option><option value="no">No</option><option value="tbc">TBC</option><option value="unknown">Unknown</option></select></div>
          <div><label>Sort aircraft by</label>
            <select name="acsort" defaultValue={acSort}>{AC_SORTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
          <div style={{ flex: "0 0 auto" }}><button type="submit"><Icon name="search" />Apply</button> {filtering && <Link href="/fleet">Clear</Link>}</div>
        </form>
      )}
      {filtering && <p className="muted small">Showing {shown.length} of {orgs.length} operators.</p>}

      {orgs.length === 0 && rows.length === 0 && <div className="card muted">Nothing here yet. Add an operator or an aircraft, or tell Chocks on the dashboard.</div>}
      {shown.map((o) => {
        const mine = shownGroups.find((g) => g.org.id === o.id)?.aircraft ?? [];
        return (
          <div className="card" key={o.id}>
            <h3 style={{ margin: 0 }}><Link href={`/organisations/${o.id}`}>{o.canonicalName}</Link> <span className="muted small" style={{ fontWeight: 400 }}>· {mine.length} aircraft{o.region ? ` · ${o.region}` : ""}{o.base ? ` · Base: ${o.base}` : ""}</span></h3>
            {mine.length === 0 ? <p className="muted small" style={{ margin: "6px 0 0" }}>No aircraft yet.</p> : mine.map((r) => <AircraftCard key={r.aircraftId} r={r} />)}
          </div>
        );
      })}
      {unassigned.length > 0 && (
        <div className="card">
          <h3 style={{ margin: 0 }}>No operator <span className="muted small" style={{ fontWeight: 400 }}>· {unassigned.length} aircraft</span></h3>
          {unassigned.map((r) => <AircraftCard key={r.aircraftId} r={r} />)}
        </div>
      )}

      <div className="grid g2">
        <details className="card" id="add-operator" open={openOperator}>
          <summary><Icon name="operator" /><b>Add operator</b></summary>
          <form action={createOrganisationAction}>
            <Key />
            <label>Name</label>
            <input name="name" required placeholder="e.g. Metrojet" />
            <label>Type of organisation</label>
            <label><input type="checkbox" name="roles" value="operator" defaultChecked /> Operator (flies the aircraft)</label>
            <label><input type="checkbox" name="roles" value="management_company" /> Management company</label>
            <label>Region (optional)</label>
            <input name="region" list="regions" placeholder="e.g. Asia, Middle East, Europe" />
            <datalist id="regions">{regions.map((r) => <option key={r} value={r} />)}</datalist>
            <label>Base (optional)</label>
            <input name="base" placeholder="Hong Kong, Singapore" />
            <p className="muted small" style={{ margin: "2px 0 8px" }}>The operator's usual base. New aircraft for this operator start with it, and you can change it per aircraft.</p>
            <label>Other names (comma separated, optional)</label>
            <input name="aliases" placeholder="Metro Jet, MJ" />
            <p className="muted small">An “other name” (alias) is another way the same company gets written. When a card says “Metro Jet”, the app finds “Metrojet”.</p>
            <p className="row" style={{ alignItems: "center" }}>
              <span style={{ flex: "0 0 auto" }}><button type="submit">Create operator</button></span>
              <span style={{ flex: "0 0 auto" }}><button type="submit" className="secondary" formAction={createOperatorThenAircraftAction}><Icon name="plane" />Create &amp; add its aircraft</button></span>
            </p>
          </form>
        </details>

        <details className="card" id="add-aircraft" open={openAircraft}>
          <summary><Icon name="plane" /><b>Add aircraft</b></summary>
          <form action={createAircraftAction}>
            <Key />
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
                <select name="baseMode" defaultValue={one(sp.baseMode) ?? ""}><option value="">Not recorded</option><option value="based">Based at…</option><option value="floating">Floating (no fixed base)</option></select></div>
              <div><label>Locations (separate with commas)</label><input name="baseLocations" defaultValue={one(sp.baseLocations)} placeholder="Hong Kong, Singapore" /></div>
            </div>
            <div className="row">
              <div><label>YOM</label><input name="yom" type="number" defaultValue={one(sp.yom)} /></div>
              <div><label>YOR</label><input name="yor" type="number" defaultValue={one(sp.yor)} /></div>
              <div><label>Capacity</label><input name="capacity" type="number" defaultValue={one(sp.capacity)} /></div>
              <div><label>WIFI</label>
                <select name="wifiStatus" defaultValue={one(sp.wifi) ?? "unknown"}><option value="yes">Yes</option><option value="no">No</option><option value="tbc">TBC</option><option value="unknown">Unknown</option></select></div>
            </div>
            <label>WIFI details (optional, shown in quotes)</label><input name="wifiDetail" placeholder="e.g. at USD 10/MB" />
            <label>Notes</label><input name="notes" defaultValue={one(sp.notes)} placeholder="Owner's approval required" />
            {tailInUse && <label style={{ color: "var(--warn)" }}><input type="checkbox" name="tailResolution" value="distinct_aircraft" /> This is a different aircraft that uses the same tail number</label>}
            <p><button type="submit">Create aircraft</button></p>
          </form>
        </details>
      </div>

      <details className="card" id="types" open={!!tq}>
        <summary><Icon name="list" /><b>Aircraft types</b> <span className="muted small">({types.length} available when you add an aircraft)</span></summary>
        <p className="muted small">About {STANDARD_AIRCRAFT_TYPES.length} standard types load automatically, each with a size category. Search to change a category or add another name for a type.</p>
        <form method="get" action="/fleet#types" className="row">
          <div><input name="tq" defaultValue={tq} placeholder="e.g. G280, Citation, Falcon" /></div>
          <div style={{ flex: "0 0 auto" }}><button type="submit"><Icon name="search" />Search</button></div>
        </form>
        {tq && found.length === 0 && <p className="muted small">No type matches “{tq}”. Add it below.</p>}
        {found.map((t) => (
          <div key={t.id} style={{ marginTop: 10 }}>
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
        <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "14px 0" }} />
        <form action={createTypeAction}>
          <Key />
          <b>Not in the list? Add an aircraft type</b>
          <div className="row">
            <div><label>Manufacturer</label><input name="manufacturer" required placeholder="Gulfstream" /></div>
            <div><label>Model / variant</label><input name="model" required placeholder="G650ER" /></div>
          </div>
          <label>Category</label>
          <select name="category" defaultValue=""><option value="">Not set</option>{AIRCRAFT_CATEGORIES.map((c) => <option key={c} value={c}>{AIRCRAFT_CATEGORY_LABEL[c]}</option>)}</select>
          <label>Other names (comma separated, optional)</label><input name="aliases" placeholder="G650 ER, GVI" />
          <p><button type="submit">Create type</button></p>
        </form>
        <form action={loadStandardTypesAction}><Key /><button type="submit" className="secondary">Check for new standard types</button></form>
      </details>
    </>
  );
}
