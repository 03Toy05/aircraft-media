import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organisations } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { getCatalogue } from "@/domain/catalogue";
import { getAircraftCard } from "@/domain/directory";
import { getLineup } from "@/domain/media";
import { LIBRARY_TENANT_ID, addingNow, copiedLibraryAircraft, hasLibraryAccess, pendingCount } from "@/domain/library";
import { addFromLibraryAction } from "../../actions";
import { Flash, one, type SP } from "../../_components/ui";
import { AutoRefresh } from "../../_components/AutoRefresh";
import { PendingButton } from "../../_components/PendingButton";

const WIFI: Record<string, string | null> = { yes: "WIFI", no: "No WIFI", tbc: "WIFI TBC", unknown: null };

/**
 * The platform library: every operator with its region, base and fleet, and each aircraft's details and photos
 * (1 EXT, 2 CABIN, 1 FLOOR PLAN, plus the combined photo once the set is complete). For the admin and the people
 * the admin has shared it with: they can add an aircraft, or a whole operator, to their own workspace.
 */
export default async function Library({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const session = await requireOwner();
  const db = await getDb();
  if (!(await hasLibraryAccess(db, session))) {
    return (
      <>
        <h1>Library</h1>
        <div className="card muted">The Aircraft Media library is not shared with you yet. Ask the admin to turn it on for you.</div>
      </>
    );
  }
  const isAdmin = session.isAdmin;
  const canAdd = !session.readOnly && !session.viewingAs;
  const copied = await copiedLibraryAircraft(db, session.actor.tenantId);
  const adding = addingNow(session.actor.tenantId);
  for (const id of copied) adding.delete(id);
  const q = (one(sp.q) ?? "").trim().toLowerCase();
  const rows = await getCatalogue(db, LIBRARY_TENANT_ID);
  const orgs = await db.select().from(organisations).where(and(eq(organisations.tenantId, LIBRARY_TENANT_ID), eq(organisations.active, true))).orderBy(asc(organisations.canonicalName));
  const waiting = isAdmin ? await pendingCount(db) : 0;

  const shown = orgs
    .map((o) => ({ o, aircraft: rows.filter((r) => r.operatorId === o.id) }))
    .filter(({ o, aircraft }) => aircraft.length > 0 && (!q || `${o.canonicalName} ${o.region ?? ""} ${o.base ?? ""} ${aircraft.map((a) => `${a.aircraft} ${a.tail ?? ""}`).join(" ")}`.toLowerCase().includes(q)));
  const totalAircraft = rows.length;

  const details = new Map<string, { facts: string; photos: Awaited<ReturnType<typeof getLineup>> }>();
  for (const { aircraft } of shown) {
    for (const r of aircraft) {
      const c = await getAircraftCard(db, r.aircraftId);
      const facts = [
        c?.yom != null && `YOM ${c.yom}`, c?.yor != null && `YOR ${c.yor}`, c?.capacity != null && `${c.capacity} seats`,
        c && WIFI[c.wifi], c?.smoking === "yes" ? "Smoking" : c?.smoking === "no" ? "No smoking" : null,
        c?.pets === "yes" ? "Pets" : c?.pets === "no" ? "No pets" : null, r.base && `Base: ${r.base}`,
      ].filter(Boolean).join(" · ");
      details.set(r.aircraftId, { facts, photos: await getLineup(db, { aircraftId: r.aircraftId, aircraftTypeId: r.aircraftTypeId }) });
    }
  }

  return (
    <>
      <h1>Library</h1>
      <Flash error={one(sp.error)} ok={adding.size ? undefined : one(sp.ok)} />
      {adding.size > 0 && (
        <div className="card small">
          <AutoRefresh />
          Adding {adding.size} aircraft to your workspace with their photos (about half a minute each). You can leave this page; they keep arriving.
        </div>
      )}
      <div className="people-head" style={{ marginBottom: 10 }}>
        <p className="muted small" style={{ margin: 0 }}>
          The Aircraft Media library: {orgs.length} operator{orgs.length === 1 ? "" : "s"}, {totalAircraft} aircraft. Library aircraft can be quoted straight away (Quote page and Toy). Add one to your workspace to edit it or add your own photos.
        </p>
        {isAdmin && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Link href="/library/review" className="btn secondary small-btn">Library review{waiting ? ` (${waiting})` : ""}</Link>
            <Link href="/library/import" className="btn secondary small-btn">Import</Link>
          </div>
        )}
      </div>
      <form className="row" style={{ marginBottom: 10 }}>
        <div><input name="q" defaultValue={one(sp.q) ?? ""} placeholder="Search operator, region, type or tail" aria-label="Search the library" /></div>
        <div style={{ flex: "0 0 auto" }}><button type="submit" className="secondary">Search</button></div>
      </form>
      {shown.length === 0 && (
        <div className="card muted">
          {orgs.length === 0 ? (isAdmin ? "The library is empty. Photos arrive in Library review once people who share with the library approve them." : "The library is empty for now.") : "Nothing matches that search."}
        </div>
      )}
      {shown.map(({ o, aircraft }) => (
        <div key={o.id} className="card">
          <div className="person-head">
            <div style={{ minWidth: 0 }}>
              <b>{o.canonicalName}</b>{" "}
              <span className="pill wait">{aircraft.length} aircraft</span>
              <div className="small muted">{[o.region && `Region: ${o.region}`, o.base && `Base: ${o.base}`].filter(Boolean).join(" · ") || "No region or base yet"}</div>
            </div>
            {canAdd && aircraft.length > 1 && (() => {
              const left = aircraft.filter((r) => !copied.has(r.aircraftId) && !adding.has(r.aircraftId)).length;
              return left > 0 && (
                <form action={addFromLibraryAction}>
                  <input type="hidden" name="libraryOperatorId" value={o.id} /><input type="hidden" name="q" value={one(sp.q) ?? ""} />
                  <PendingButton className="secondary small-btn" pending="Adding…">{left === aircraft.length ? `Add all ${left} to my workspace` : `Add the other ${left} to my workspace`}</PendingButton>
                </form>
              );
            })()}
          </div>
          {aircraft.map((r) => {
            const d = details.get(r.aircraftId)!;
            const kinds = ["exterior", "cabin", "floor_plan"] as const;
            const singles = d.photos.filter((p) => (kinds as readonly string[]).includes(p.classification));
            const combined = d.photos.find((p) => p.classification === "combined");
            return (
              <div key={r.aircraftId} className="lib-ac">
                <div className="person-head">
                  <div><b>{r.aircraft}</b>{r.tail ? ` · ${r.tail}` : ""}</div>
                  {copied.has(r.aircraftId) ? <span className="pill ok">In your workspace</span>
                    : adding.has(r.aircraftId) ? <span className="pill wait">Adding…</span>
                    : canAdd && (
                    <form action={addFromLibraryAction}>
                      <input type="hidden" name="libraryAircraftId" value={r.aircraftId} /><input type="hidden" name="q" value={one(sp.q) ?? ""} />
                      <PendingButton className="secondary small-btn" pending="Adding…">Add to my workspace</PendingButton>
                    </form>
                  )}
                </div>
                {d.facts && <div className="small muted">{d.facts}</div>}
                <div className="lib-tiles">
                  {singles.map((p) => (
                    <a key={p.mediaId} className="lib-tile" href={`/api/media/${p.contentVersionId}`} target="_blank">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/media/${p.contentVersionId}`} alt={p.label} loading="lazy" />
                      <span>{p.label}</span>
                    </a>
                  ))}
                  {combined && (
                    <a className="lib-tile combined" href={`/api/media/${combined.contentVersionId}`} target="_blank">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/media/${combined.contentVersionId}`} alt="Combined" loading="lazy" />
                      <span>COMBINED</span>
                    </a>
                  )}
                </div>
                {singles.length < 4 && <div className="small muted">Still needs: {kinds.map((k) => ({ k, n: (k === "cabin" ? 2 : 1) - singles.filter((p) => p.classification === k).length })).filter((x) => x.n > 0).map((x) => `${x.n} ${x.k === "floor_plan" ? "floor plan" : x.k}`).join(", ")}</div>}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
