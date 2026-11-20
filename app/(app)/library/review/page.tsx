import Link from "next/link";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/session";
import { LIBRARY_NEEDS, libraryOperators, reviewGroups } from "@/domain/library";
import { CLASSIFICATION_LABEL, type Classification } from "@/domain/constants";
import { acceptLibraryAction, acceptLibraryUpdatesAction, collectLibraryNowAction, rejectLibraryAction } from "../../../actions";
import Choice from "../../../_components/Choice";
import { Flash, one, type SP } from "../../../_components/ui";
import SearchSelect from "../../../_components/SearchSelect";

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The admin's review of photos offered to the platform library: one card per aircraft. Tick the photos to keep,
 * choose the library operator they go under (the matching one is chosen for you), then Accept or Turn down.
 */
export default async function LibraryReview({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await requireAdmin();
  const db = await getDb();
  const groups = await reviewGroups(db);
  const ops = await libraryOperators(db);

  return (
    <>
      <h1>Library review</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="people-head" style={{ marginBottom: 10 }}>
        <p className="muted small" style={{ margin: 0 }}>
          Photos offered from workspaces that share with the library. Each aircraft keeps 1 EXT, 2 CABIN and 1 FLOOR PLAN; the first complete set wins. <Link href="/library">Open the library →</Link>
        </p>
        <form action={collectLibraryNowAction}><button className="secondary small-btn" type="submit">Check for new photos</button></form>
      </div>
      {groups.length === 0 && <div className="card muted">Nothing waiting. New photos appear here when people who share with the library approve them.</div>}
      {groups.map((g) => {
        const title = [g.operatorName ?? "No operator", g.aircraftType, g.tail].filter(Boolean).join(" · ");
        const need = (Object.keys(LIBRARY_NEEDS) as Classification[]).map((k) => `${CLASSIFICATION_LABEL[k]} ${g.have[k] ?? 0}/${LIBRARY_NEEDS[k]}`).join(" · ");
        const formId = `lib-${g.kind}-${g.matchKey.replace(/[^a-z0-9]/gi, "")}`;
        if (g.kind === "update") {
          // Newer photos: each one replaces the library photo chosen for it (the n-th offered cabin replaces CABIN n).
          const seen: Record<string, number> = {};
          return (
            <div key={formId} className="card">
              <div className="person-head">
                <div style={{ minWidth: 0 }}>
                  <b>{title}</b> <span className="pill warn">Newer photos</span>
                  <div className="small muted">Offered by {g.contributor} on {day(g.createdAt)}{g.note ? ` · ${g.note}` : ""}</div>
                </div>
              </div>
              <div className="group-title">In the library now</div>
              <div className="lib-tiles">
                {g.current.map((c) => (
                  <a key={c.mediaId} className="lib-tile" href={`/api/media/${c.contentVersionId}`} target="_blank">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/media/${c.contentVersionId}`} alt={c.label} />
                    <span>{c.label}</span>
                  </a>
                ))}
              </div>
              <form id={formId} action={acceptLibraryUpdatesAction}>
                <input type="hidden" name="matchKey" value={g.matchKey} />
                <div className="group-title">Offered</div>
                {g.photos.map((p) => {
                  const same = g.current.filter((c) => c.classification === p.classification);
                  const nth = (seen[p.classification] = (seen[p.classification] ?? 0) + 1) - 1;
                  const options = [...same.map((c) => ({ value: c.mediaId, label: `Replace ${c.label}` })), { value: "add", label: "Add" }, { value: "skip", label: "Don't use" }];
                  return (
                    <div key={p.id} className="row" style={{ alignItems: "center", marginBottom: 8 }}>
                      <input type="hidden" name="contributionId" value={p.id} />
                      <div style={{ flex: "0 0 140px" }}>
                        <div className="lib-tile">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/media/${p.contentVersionId}`} alt={p.classification} />
                          <span>{CLASSIFICATION_LABEL[p.classification as Classification] ?? p.classification}</span>
                        </div>
                      </div>
                      <div><Choice name={`replace-${p.id}`} defaultValue={same[nth]?.mediaId ?? same[0]?.mediaId ?? "add"} ariaLabel="What to do with this photo" options={options} /></div>
                    </div>
                  );
                })}
                <p className="small muted" style={{ margin: "4px 0 8px" }}>Replaced photos are retired, not deleted, so they stay in the library&apos;s history. The combined photo is made again from the new set. People who added this aircraft to their workspace are offered the newer photos.</p>
                <div className="person-actions">
                  <button type="submit" className="small-btn">Apply</button>
                  <span className="spacer" />
                  <button type="submit" formAction={rejectLibraryAction} className="danger small-btn">Turn all down</button>
                </div>
              </form>
            </div>
          );
        }
        return (
          <div key={formId} className="card">
            <div className="person-head">
              <div style={{ minWidth: 0 }}>
                <b>{title}</b>{" "}
                <span className={`pill ${g.libraryAircraft ? "ok" : "wait"}`}>{g.libraryAircraft ? "In the library" : "New to the library"}</span>
                <div className="small muted">Offered by {g.contributor} on {day(g.createdAt)} · library has {need}</div>
              </div>
            </div>
            <form id={formId} action={acceptLibraryAction}>
              <input type="hidden" name="matchKey" value={g.matchKey} />
              <div className="lib-tiles">
                {g.photos.map((p) => (
                  <label key={p.id} className="lib-tile">
                    <input type="checkbox" name="contributionId" value={p.id} defaultChecked aria-label={`Keep this ${p.classification}`} />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/media/${p.contentVersionId}`} alt={p.classification} />
                    <span>{CLASSIFICATION_LABEL[p.classification as Classification] ?? p.classification}</span>
                  </label>
                ))}
              </div>
              <label>Library operator</label>
              <SearchSelect name="operator" defaultValue={g.libraryOperator?.id ?? "new"} placeholder="Type an operator"
                ariaLabel="Library operator"
                options={[{ value: "new", label: `New operator: ${g.operatorName ?? "Unknown operator"}`, hint: g.libraryOperator ? undefined : "no match in the library" }, ...ops.map((o) => ({ value: o.id, label: o.name, hint: o.region ?? undefined }))]} />
              <input type="hidden" name="newOperatorName" value={g.operatorName ?? ""} />
              <p className="small muted" style={{ margin: "4px 0 8px" }}>
                {g.libraryOperator ? `Matched to the library's “${g.libraryOperator.name}”.` : "No library operator has this name. Pick one if it is the same company under another name, or keep New operator."}
                {" "}Only the aircraft details and photos are copied; never prices, quotes, contacts or notes.
              </p>
              <div className="person-actions">
                <button type="submit" className="small-btn">Accept ticked photos</button>
                <span className="spacer" />
                <button type="submit" formAction={rejectLibraryAction} className="danger small-btn">Turn down ticked photos</button>
              </div>
            </form>
          </div>
        );
      })}
    </>
  );
}
