import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organisations } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { getCatalogue } from "@/domain/catalogue";
import { getAircraftCard } from "@/domain/directory";
import { getLineup } from "@/domain/media";
import { LIBRARY_TENANT_ID, pendingCount } from "@/domain/library";
import { one, type SP } from "../../_components/ui";

const WIFI: Record<string, string | null> = { yes: "WIFI", no: "No WIFI", tbc: "WIFI TBC", unknown: null };

/**
 * The platform library: every operator with its region, base and fleet, and each aircraft's details and photos
 * (1 EXT, 2 CABIN, 1 FLOOR PLAN, plus the combined photo once the set is complete). Admin only for now.
 */
export default async function Library({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await requireAdmin();
  const db = await getDb();
  const q = (one(sp.q) ?? "").trim().toLowerCase();
  const rows = await getCatalogue(db, LIBRARY_TENANT_ID);
  const orgs = await db.select().from(organisations).where(and(eq(organisations.tenantId, LIBRARY_TENANT_ID), eq(organisations.active, true))).orderBy(asc(organisations.canonicalName));
  const waiting = await pendingCount(db);

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
      <div className="people-head" style={{ marginBottom: 10 }}>
        <p className="muted small" style={{ margin: 0 }}>
          The shared platform library: {orgs.length} operator{orgs.length === 1 ? "" : "s"}, {totalAircraft} aircraft. Only you can see it for now.
        </p>
        <Link href="/library/review" className="btn secondary small-btn">Library review{waiting ? ` (${waiting})` : ""}</Link>
      </div>
      <form className="row" style={{ marginBottom: 10 }}>
        <div><input name="q" defaultValue={one(sp.q) ?? ""} placeholder="Search operator, region, type or tail" aria-label="Search the library" /></div>
        <div style={{ flex: "0 0 auto" }}><button type="submit" className="secondary">Search</button></div>
      </form>
      {shown.length === 0 && (
        <div className="card muted">
          {orgs.length === 0 ? "The library is empty. Photos arrive in Library review once people who share with the library approve them." : "Nothing matches that search."}
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
          </div>
          {aircraft.map((r) => {
            const d = details.get(r.aircraftId)!;
            const kinds = ["exterior", "cabin", "floor_plan"] as const;
            const singles = d.photos.filter((p) => (kinds as readonly string[]).includes(p.classification));
            const combined = d.photos.find((p) => p.classification === "combined");
            return (
              <div key={r.aircraftId} className="lib-ac">
                <div><b>{r.aircraft}</b>{r.tail ? ` · ${r.tail}` : ""}</div>
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
