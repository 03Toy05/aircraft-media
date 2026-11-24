import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftTypes, organisations } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import Icon from "../../_components/Icon";
import OpenSection from "../../_components/OpenSection";
import CollapseOnMobile from "../../_components/CollapseOnMobile";
import { AC_SORTS, matchesWords, runFleetQuery, searchWords, sortAircraft, type AcSort, type OperatorSort } from "@/domain/fleetQuery";
import { LIBRARY_TENANT_ID, libraryScope, scopeHasOperator } from "@/domain/library";
import { orgAliasesFor } from "@/domain/directory";
import FleetSearch, { type FleetSuggestion } from "../../_components/FleetSearch";
import RememberFilters from "../../_components/RememberFilters";
import { getCatalogue, type CatalogueRow } from "@/domain/catalogue";
import { AIRCRAFT_CATEGORIES, AIRCRAFT_CATEGORY_LABEL } from "@/domain/constants";
import { getAircraftCard, resolveAircraftTypes, tidyExistingPlaces } from "@/domain/directory";
import { getLineup } from "@/domain/media";
import { STANDARD_AIRCRAFT_TYPES } from "@/domain/standardTypes";
import {
  addTypeAliasAction, createAircraftAction, createOperatorThenAircraftAction, createOrganisationAction, createTypeAction, loadStandardTypesAction, setOrgRegionAction, setTypeCategoryAction,
} from "../../actions";
import { Flash, Key, one, type SP } from "../../_components/ui";
import PlacePicker from "../../_components/PlacePicker";
import SearchSelect from "../../_components/SearchSelect";
import Choice, { WIFI_CHOICES, YES_NO_CHOICES } from "../../_components/Choice";

/** The page's filters and view, remembered on each device (see RememberFilters). */
const FILTER_KEYS = ["q", "in", "region", "category", "base", "wifi", "acsort", "sort", "view"];

/** Operators and their aircraft on one page: each aircraft shows its details and a few approved photos. */
export default async function Fleet({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const session = await requireOwner();
  const { actor, readOnly } = session;
  const db = await getDb();
  if (!readOnly) await tidyExistingPlaces(db, actor.tenantId); // "HK" saved before the city list -> "Hong Kong"
  const orgRows = await db.select().from(organisations).where(eq(organisations.tenantId, actor.tenantId)).orderBy(asc(organisations.canonicalName));
  // Each operator with its other names ("VJ"), so the search finds them too.
  const ownAliases = await orgAliasesFor(db, actor.tenantId);
  const orgs = orgRows.map((o) => ({ ...o, aliases: ownAliases.filter((a) => a.organisationId === o.id).map((a) => a.alias) }));
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

  /** One aircraft in two lines (name and tail; its facts) with small photos beside it, so long fleets stay readable. */
  const opName = new Map(orgs.map((o) => [o.id, o.canonicalName]));
  const AircraftCard = ({ r, showOperator = false }: { r: CatalogueRow; showOperator?: boolean }) => {
    const d = details.get(r.aircraftId)!;
    const wifi = d.card?.wifi === "yes" ? "WIFI" : d.card?.wifi === "no" ? "No WIFI" : null;
    const facts = [d.card?.yom != null && `YOM ${d.card.yom}`, d.card?.yor != null && `YOR ${d.card.yor}`, d.card?.capacity != null && `${d.card.capacity} seats`, wifi, r.base && `Base: ${r.base}`, d.card?.notes].filter(Boolean);
    return (
      <div className="ac-row">
        <div className="ac-row-text">
          <div className="ac-row-name">
            <Link href={`/aircraft/${r.aircraftId}`}><b>{r.aircraft}</b></Link>
            <span className="muted"> · {r.tail ?? "no tail yet"}</span>
            {showOperator && <span className="muted"> · {r.operatorId ? <Link href={`/organisations/${r.operatorId}`}>{opName.get(r.operatorId) ?? "Operator"}</Link> : "No operator"}</span>}
          </div>
          <div className="small muted ac-row-facts">{facts.length ? facts.join(" · ") : "No details yet"}</div>
        </div>
        {d.photos.length > 0 && (
          <div className="ac-row-photos">
            {d.photos.map((p) => (
              <a key={p.contentVersionId} href={`/api/media/${p.contentVersionId}`} target="_blank" title={p.label}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${p.contentVersionId}`} alt={p.label} loading="lazy" />
              </a>
            ))}
          </div>
        )}
      </div>
    );
  };
  /** An operator's aircraft: the first few, then the rest folded away behind "Show all". */
  const SHOW_FIRST = 3;
  const AircraftList = ({ list }: { list: CatalogueRow[] }) => (
    <>
      {list.slice(0, SHOW_FIRST).map((r) => <AircraftCard key={r.aircraftId} r={r} />)}
      {list.length > SHOW_FIRST && (
        <details className="ac-more">
          <summary className="small">Show all {list.length} aircraft</summary>
          {list.slice(SHOW_FIRST).map((r) => <AircraftCard key={r.aircraftId} r={r} />)}
        </details>
      )}
    </>
  );

  // Filters and sorting are shared with Toy (src/domain/fleetQuery.ts), so both give the same answer.
  const wifiParam = one(sp.wifi);
  const {
    regions, baseOptions, sort, acSort, q, regionFilter, catFilter, baseFilter, wifiFilter, filtering, groups: shownGroups, unassigned, searchIn,
  } = runFleetQuery(
    { orgs, rows, types, cards: new Map([...details].map(([id, d]) => [id, d.card])) },
    { q: one(sp.q), in: (["aircraft", "operator"] as const).find((x) => x === one(sp.in)), region: one(sp.region), category: one(sp.category), base: one(sp.base), sort: one(sp.sort) as OperatorSort, acsort: one(sp.acsort) as AcSort, wifi: ["yes", "no", "tbc", "unknown"].includes(wifiParam ?? "") ? (wifiParam as "yes") : undefined },
  );
  const shown = shownGroups.map((g) => g.org);
  const cardMap = new Map([...details].map(([id, d]) => [id, d.card]));

  // "By operator" (cards) or "All aircraft" (one list across operators, in the chosen order).
  // Searching for an aircraft lists just the aircraft, each with its operator.
  const view = one(sp.view) === "aircraft" || (searchIn === "aircraft" && !!q) ? "aircraft" : "operators";
  const allAircraft = view === "aircraft"
    ? (acSort ? sortAircraft([...shownGroups.flatMap((g) => g.aircraft), ...unassigned], acSort, cardMap)
      : [...shownGroups.flatMap((g) => g.aircraft), ...unassigned].sort((a, b) => a.aircraft.localeCompare(b.aircraft) || (a.tail ?? "").localeCompare(b.tail ?? "")))
    : [];
  const viewLink = (v: "operators" | "aircraft") => {
    const p = new URLSearchParams();
    for (const k of FILTER_KEYS) { const val = one(sp[k]); if (val && k !== "view") p.set(k, val); }
    p.set("view", v);
    return `/fleet?${p}`;
  };
  const withAircraft = shownGroups.filter((g) => g.aircraft.length > 0);

  // What the search box suggests while typing: your operators and aircraft, then the library's (when shared with you).
  const suggestions: FleetSuggestion[] = [
    ...orgs.filter((o) => o.active).map((o) => ({ kind: "operator" as const, label: o.canonicalName, sub: `${rows.filter((r) => r.operatorId === o.id).length} aircraft${o.aliases.length ? ` · ${o.aliases.join(", ")}` : ""}`, keys: `${o.canonicalName} ${o.aliases.join(" ")} ${o.region ?? ""}`, href: `/organisations/${o.id}` })),
    ...rows.map((r) => {
      const o = orgs.find((x) => x.id === r.operatorId);
      return { kind: "aircraft" as const, label: `${r.aircraft}${r.tail ? ` · ${r.tail}` : ""}`, sub: o?.canonicalName ?? "No operator", keys: `${r.aircraft} ${r.tail ?? ""} ${o ? `${o.canonicalName} ${o.aliases.join(" ")}` : ""}`, href: `/aircraft/${r.aircraftId}` };
    }),
  ];
  let libraryHits = 0;
  const scope = await libraryScope(db, session);
  if (scope) {
    const libRows = (await getCatalogue(db, LIBRARY_TENANT_ID)).filter((r) => scopeHasOperator(scope, r.operatorId));
    const libOrgs = (await db.select().from(organisations).where(and(eq(organisations.tenantId, LIBRARY_TENANT_ID), eq(organisations.active, true)))).filter((o) => scopeHasOperator(scope, o.id));
    const libAliases = await orgAliasesFor(db, LIBRARY_TENANT_ID);
    const aliasOf = (id: string | null) => libAliases.filter((a) => a.organisationId === id).map((a) => a.alias).join(" ");
    const libLink = (text: string) => `/library?q=${encodeURIComponent(text)}`;
    // Your own operator with no aircraft, when the library has one of the same name, would only be a confusing
    // "0 aircraft" line above the real fleet: leave it out of the suggestions.
    const libNames = new Set(libOrgs.filter((o) => libRows.some((r) => r.operatorId === o.id)).map((o) => o.canonicalName.trim().toLowerCase()));
    for (let i = suggestions.length - 1; i >= 0; i--) {
      const x = suggestions[i];
      if (x.kind === "operator" && x.sub?.startsWith("0 aircraft") && libNames.has(x.label.trim().toLowerCase())) suggestions.splice(i, 1);
    }
    for (const o of libOrgs) {
      const n = libRows.filter((r) => r.operatorId === o.id).length;
      if (n) suggestions.push({ kind: "operator", label: o.canonicalName, sub: `${n} aircraft`, keys: `${o.canonicalName} ${aliasOf(o.id)} ${o.region ?? ""}`, href: libLink(o.canonicalName), library: true });
    }
    for (const r of libRows) suggestions.push({ kind: "aircraft", label: `${r.aircraft}${r.tail ? ` · ${r.tail}` : ""}`, sub: r.operator ?? undefined, keys: `${r.aircraft} ${r.tail ?? ""} ${r.operator ?? ""} ${aliasOf(r.operatorId)}`, href: libLink(r.operator ?? r.aircraft), library: true });
    // Nothing of your own matches: say what the library has, so the search never just comes back empty.
    const w = searchWords(q);
    if (w.length) libraryHits = suggestions.filter((x) => x.library && x.kind === "aircraft" && (searchIn !== "operator" || matchesWords(x.sub ?? "", w)) && matchesWords(x.keys, w)).length;
  }
  // Filters other than the search: the folded "Filters and sort" panel stays open, and says how many, when any is set.
  const otherFilters = [regionFilter, catFilter, baseFilter, wifiFilter, acSort].filter(Boolean).length;
  // Fold operator cards to one line each once there are many (opened when a filter narrows the list).
  const FOLD_AT = 30;
  const fold = withAircraft.length >= FOLD_AT && !filtering;

  return (
    <>
      <div className="page-head">
        <h1>Operators &amp; aircraft</h1>
        {/* On phones the two Add buttons fold into one small "Add" menu, so the search comes first. */}
        <details className="add-menu only-phone">
          <summary className="btn"><Icon name="plus" />Add</summary>
          <div className="add-menu-list">
            <OpenSection target="add-operator" icon="operator">Operator</OpenSection>
            <OpenSection target="add-aircraft" icon="plane">Aircraft</OpenSection>
          </div>
        </details>
      </div>
      {/* The search itself is not remembered: opening the page should not bring back an old search. */}
      <RememberFilters keys={FILTER_KEYS.filter((k) => k !== "q" && k !== "in")} />
      <Flash error={one(sp.error)} ok={one(sp.ok)} />

      <div className="row hide-phone" style={{ marginBottom: 12 }}>
        <div style={{ flex: "0 0 auto" }}><OpenSection target="add-operator" icon="operator">Add operator</OpenSection></div>
        <div style={{ flex: "0 0 auto" }}><OpenSection target="add-aircraft" icon="plane">Add aircraft</OpenSection></div>
      </div>

      {orgs.length > 0 && (
        <div className="card fleet-filters">
        {/* Search always shows; the other filters fold away on phones. Both belong to the one form below. */}
        <div className="search-cell"><FleetSearch form="fleet-filters" defaultQ={one(sp.q) ?? ""} defaultIn={searchIn} items={suggestions} /></div>
        <CollapseOnMobile plain keepOpen={otherFilters > 0} summary={`Filters and sort${otherFilters ? ` (${otherFilters})` : ""}`}>
        <form id="fleet-filters" method="get" className="row filterbar" style={{ alignItems: "end" }}>
          <div><label>Region</label>
            <SearchSelect name="region" defaultValue={regionFilter} emptyLabel="All regions"
              options={[...regions.map((r) => ({ value: r, label: r })), { value: "__none", label: "No region set" }]} /></div>
          <div><label>Aircraft category</label>
            <SearchSelect name="category" defaultValue={catFilter} emptyLabel="All categories"
              options={AIRCRAFT_CATEGORIES.map((c) => ({ value: c, label: AIRCRAFT_CATEGORY_LABEL[c] }))} /></div>
          <div><label>Base</label>
            <SearchSelect name="base" defaultValue={baseFilter} emptyLabel="All bases"
              options={[...baseOptions.map((b) => ({ value: b, label: b })), { value: "__none", label: "Base not recorded" }]} /></div>
          {sort !== "name" && <input type="hidden" name="sort" value={sort} />}
          <input type="hidden" name="view" value={view} />
          <div><label>WIFI</label>
            <SearchSelect name="wifi" defaultValue={wifiFilter} emptyLabel="Any WIFI"
              options={WIFI_CHOICES.map((w) => ({ value: w.value, label: `WIFI: ${w.label}` }))} /></div>
          <div><label>Sort aircraft by</label>
            <SearchSelect name="acsort" defaultValue={acSort} options={AC_SORTS.map((o) => ({ value: o.id, label: o.label }))} /></div>
          <div style={{ flex: "0 0 auto" }}><button type="submit"><Icon name="search" />Apply</button> {filtering && <Link href={`/fleet?reset=1&view=${view}`}>Clear</Link>}</div>
        </form>
        </CollapseOnMobile>
        </div>
      )}
      {filtering && (
        <p className="muted small">
          {view === "operators" ? <>Showing {shown.length} of {orgs.length} operators</> : <>Filtered</>}{q ? `, for “${one(sp.q)?.trim()}”` : ""}.{" "}
          <Link href={`/fleet?reset=1&view=${view}`}>Clear</Link>
        </p>
      )}
      {q && libraryHits > 0 && (
        <div className="card small">
          {shown.length || unassigned.length ? "The library also has" : "Nothing in your workspace matches, but the library has"} {libraryHits} aircraft for “{one(sp.q)?.trim()}”.{" "}
          <Link href={`/library?q=${encodeURIComponent(one(sp.q)?.trim() ?? "")}`}>See them in the library →</Link>
        </div>
      )}

      {orgs.length === 0 && rows.length === 0 && <div className="card muted">Nothing here yet. Add an operator or an aircraft, or tell Toy on the dashboard.</div>}
      {rows.length > 0 && (
        <div className="view-switch" role="tablist" aria-label="Show">
          <Link role="tab" aria-selected={view === "operators"} className={view === "operators" ? "on" : ""} href={viewLink("operators")}>By operator</Link>
          <Link role="tab" aria-selected={view === "aircraft"} className={view === "aircraft" ? "on" : ""} href={viewLink("aircraft")}>All aircraft ({shownGroups.reduce((n, g) => n + g.aircraft.length, 0) + unassigned.length})</Link>
        </div>
      )}

      {view === "aircraft" ? (
        <div className="card">
          <p className="small muted" style={{ margin: 0 }}>
            {allAircraft.length} aircraft, {acSort ? `sorted by ${AC_SORTS.find((s) => s.id === acSort)?.label.toLowerCase()}` : "by type"}. Change the order with “Sort aircraft by” above.
          </p>
          {allAircraft.length === 0 ? <p className="muted">No aircraft match.</p> : allAircraft.map((r) => <AircraftCard key={r.aircraftId} r={r} showOperator />)}
        </div>
      ) : (
        <>
      {withAircraft.map(({ org: o, aircraft: mine }) => {
        const head = <><Link href={`/organisations/${o.id}`}>{o.canonicalName}</Link> <span className="muted small" style={{ fontWeight: 400 }}>· {mine.length} aircraft{o.region ? ` · ${o.region}` : ""}{o.base ? ` · Base: ${o.base}` : ""}</span></>;
        // With many operators, each card folds to one line; tap it to see its aircraft.
        return fold ? (
          <details className="card op-card" key={o.id}>
            <summary><h3 style={{ margin: 0, display: "inline" }}>{head}</h3></summary>
            <AircraftList list={mine} />
          </details>
        ) : (
          <div className="card" key={o.id}>
            <h3 style={{ margin: 0 }}>{head}</h3>
            <AircraftList list={mine} />
          </div>
        );
      })}
      {/* Operators without aircraft take one line each in a single card, instead of a card each. */}
      {shownGroups.some((g) => g.aircraft.length === 0) && (
        <details className="card" open={filtering || shownGroups.every((g) => g.aircraft.length === 0)}>
          <summary><b>Operators with no aircraft yet</b> <span className="muted small">· {shownGroups.filter((g) => g.aircraft.length === 0).length}</span></summary>
          <div className="op-names">
            {shownGroups.filter((g) => g.aircraft.length === 0).map(({ org: o }) => (
              <Link key={o.id} href={`/organisations/${o.id}`} className="chip small">{o.canonicalName}{o.region ? <span className="muted"> · {o.region}</span> : null}</Link>
            ))}
          </div>
        </details>
      )}
      {unassigned.length > 0 && (
        <div className="card">
          <h3 style={{ margin: 0 }}>No operator <span className="muted small" style={{ fontWeight: 400 }}>· {unassigned.length} aircraft</span></h3>
          <AircraftList list={unassigned} />
        </div>
      )}
        </>
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
            <PlacePicker name="region" kind="region" placeholder="e.g. Asia, Middle East, Hong Kong" />
            <label>Base (optional)</label>
            <PlacePicker name="base" kind="base" multiple />
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
            <SearchSelect name="aircraftTypeId" required defaultValue={one(sp.typeId) ?? ""} placeholder="Type a model, e.g. G650 or Challenger"
              options={groups.flatMap((g) => g.items.map((t) => ({ value: t.id, label: `${t.manufacturer} ${t.model}`, group: g.label })))} />
            <div className="row">
              <div><label>Tail number</label><input name="registration" defaultValue={one(sp.tail)} placeholder="Optional. Add it later if unknown" /></div>
              <div><label>Serial number</label><input name="serialNumber" /></div>
            </div>
            <label>Operator</label>
            <SearchSelect name="operatorId" defaultValue={one(sp.operatorId) ?? ""} emptyLabel="Not recorded / new operator below"
              options={orgs.map((o) => ({ value: o.id, label: o.canonicalName, hint: o.region ?? undefined }))} />
            <label>…or add a new operator now (used only when none is chosen above)</label>
            <input name="newOperatorName" defaultValue={one(sp.newOperator)} placeholder="e.g. Jet Aviation Hong Kong" />
            <label>Base</label>
            <Choice name="baseMode" defaultValue={one(sp.baseMode) ?? ""} ariaLabel="Base"
              options={[{ value: "", label: "Not recorded" }, { value: "based", label: "Based at…" }, { value: "floating", label: "Floating" }]} />
            <label>Base locations (for “Based at”)</label>
            <PlacePicker name="baseLocations" kind="base" multiple defaultValue={one(sp.baseLocations)} />
            <div className="row">
              <div><label>YOM</label><input name="yom" type="number" inputMode="numeric" defaultValue={one(sp.yom)} /></div>
              <div><label>YOR</label><input name="yor" type="number" inputMode="numeric" defaultValue={one(sp.yor)} /></div>
              <div><label>Capacity</label><input name="capacity" type="number" inputMode="numeric" defaultValue={one(sp.capacity)} /></div>
            </div>
            <label>WIFI</label>
            <Choice name="wifiStatus" defaultValue={one(sp.wifi) ?? "unknown"} options={WIFI_CHOICES} ariaLabel="WIFI" />
            <label>WIFI details</label><input name="wifiDetail" placeholder="e.g. complimentary, or USD 10/MB" />
            <div className="row">
              <div><label>Smoking</label><Choice name="smoking" defaultValue={"unknown"} options={YES_NO_CHOICES} ariaLabel="Smoking" /></div>
              <div><label>Pets</label><Choice name="pets" defaultValue={"unknown"} options={YES_NO_CHOICES} ariaLabel="Pets" /></div>
            </div>
            <label>Cleaning fee</label><input name="cleaningFee" placeholder="e.g. USD 500 for pets or smoking" />
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
              <div><SearchSelect name="category" defaultValue={t.category ?? ""} emptyLabel="No category" ariaLabel="Category"
                options={AIRCRAFT_CATEGORIES.map((c) => ({ value: c, label: AIRCRAFT_CATEGORY_LABEL[c] }))} /></div>
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
          <SearchSelect name="category" defaultValue="" emptyLabel="Not set" ariaLabel="Category"
            options={AIRCRAFT_CATEGORIES.map((c) => ({ value: c, label: AIRCRAFT_CATEGORY_LABEL[c] }))} />
          <label>Other names (comma separated, optional)</label><input name="aliases" placeholder="G650 ER, GVI" />
          <p><button type="submit">Create type</button></p>
        </form>
        <form action={loadStandardTypesAction}><Key /><button type="submit" className="secondary">Check for new standard types</button></form>
      </details>
    </>
  );
}
