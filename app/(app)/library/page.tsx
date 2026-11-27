import Link from "next/link";
import OperatorContacts from "../../_components/OperatorContacts";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraft as aircraftTable, aircraftInformationVersions, aircraftRegistrations, organisations } from "@/db/schema";
import { normalizeRegistration } from "@/domain/constants";
import { requireOwner } from "@/lib/session";
import { getCatalogue } from "@/domain/catalogue";
import { matchesWords, searchWords } from "@/domain/searchMatch";
import { getAircraftCard, orgAliasesFor } from "@/domain/directory";
import { getLineup } from "@/domain/media";
import { LIBRARY_TENANT_ID, addingNow, copiedLibraryAircraft, libraryScope, pendingCount, readyLibraryAircraft, scopeHasAircraft, scopeHasOperator } from "@/domain/library";
import { addFromLibraryAction } from "../../actions";
import { Flash, one, type SP } from "../../_components/ui";
import { AutoRefresh } from "../../_components/AutoRefresh";
import { PendingButton } from "../../_components/PendingButton";
import { serverT } from "@/lib/uiLang";

const WIFI: Record<string, string | null> = { yes: "WIFI", no: "No WIFI", tbc: "WIFI TBC", unknown: null };
/** Aircraft already in the workspace are hidden unless they changed this recently (or a search or "Show all" asks). */
const RECENT_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

/**
 * The platform library: every operator with its region, base and fleet, and each aircraft's details and photos
 * (1 EXT, 2 CABIN, 1 FLOOR PLAN, plus the combined photo once the set is complete). For the admin and the people
 * the admin has shared it with: they can add an aircraft, or a whole operator, to their own workspace.
 */
export default async function Library({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const t = await serverT();
  const session = await requireOwner();
  const db = await getDb();
  const scope = await libraryScope(db, session);
  if (!scope) {
    return (
      <>
        <h1>{t("Library")}</h1>
        <div className="card muted">{t("The Aircraft Media library is not shared with you yet. Ask the admin to turn it on for you.")}</div>
      </>
    );
  }
  const isAdmin = session.isAdmin;
  const canAdd = !session.readOnly && !session.viewingAs;
  const copied = await copiedLibraryAircraft(db, session.actor.tenantId);
  const adding = addingNow(session.actor.tenantId);
  for (const id of copied) adding.delete(id);
  const q = (one(sp.q) ?? "").trim().toLowerCase();
  const showAll = one(sp.all) === "1";
  const readySet = await readyLibraryAircraft(db);
  const [allLib, orgs, waiting, infos, myTails, allOrgs] = await Promise.all([
    getCatalogue(db, LIBRARY_TENANT_ID),
    db.select().from(organisations).where(and(eq(organisations.tenantId, LIBRARY_TENANT_ID), eq(organisations.active, true))).orderBy(asc(organisations.canonicalName))
      // Only the operators the admin opened to this person.
      .then((list) => list.filter((o) => scopeHasOperator(scope, o.id))),
    isAdmin ? pendingCount(db) : Promise.resolve(0),
    db.select({ aircraftId: aircraftInformationVersions.aircraftId, at: aircraftInformationVersions.createdAt, made: aircraftTable.updatedAt })
      .from(aircraftInformationVersions).innerJoin(aircraftTable, eq(aircraftTable.id, aircraftInformationVersions.aircraftId))
      .where(and(eq(aircraftTable.tenantId, LIBRARY_TENANT_ID), eq(aircraftInformationVersions.isCurrent, true))),
    // Tails already in this workspace (uploaded here, not added from the library) count as in the workspace too.
    db.select({ t: aircraftRegistrations.normalizedRegistration }).from(aircraftRegistrations)
      .innerJoin(aircraftTable, eq(aircraftTable.id, aircraftRegistrations.aircraftId))
      .where(and(eq(aircraftTable.tenantId, session.actor.tenantId), eq(aircraftTable.active, true), eq(aircraftRegistrations.isCurrent, true))),
    db.select().from(organisations).where(and(eq(organisations.tenantId, LIBRARY_TENANT_ID), eq(organisations.active, true))),
  ]);
  // The library proper: aircraft with photos, open to this person. The directory: aircraft known only by their
  // details (e.g. the FAA's US Part 135 fleets), found by searching and open to everyone the library is shared with.
  const rows = allLib.filter((r) => readySet.has(r.aircraftId) && scopeHasAircraft(scope, r.aircraftId));
  const dirAll = allLib.filter((r) => !readySet.has(r.aircraftId));
  const orgName = new Map(allOrgs.map((o) => [o.id, o]));
  // Trading names (kept as the operator's aliases): brokers know most operators by these, so they lead.
  const brands = new Map<string, string[]>();
  for (const a of await orgAliasesFor(db, LIBRARY_TENANT_ID)) brands.set(a.organisationId, [...(brands.get(a.organisationId) ?? []), a.alias]);
  const brandOf = (id: string | null | undefined) => (id ? brands.get(id)?.[0] ?? null : null);
  const namesOf = (id: string | null | undefined, legal: string) => `${legal} ${(id && brands.get(id)?.join(" ")) || ""}`;
  const haveTail = new Set(myTails.map((x) => x.t));
  // Last change to an aircraft: its details or its newest approved photo.
  const updated = new Map<string, number>();
  for (const i of infos) updated.set(i.aircraftId, Math.max(i.at.getTime(), i.made.getTime()));
  for (const r of rows) if (r.lastApproved) updated.set(r.aircraftId, Math.max(updated.get(r.aircraftId) ?? 0, r.lastApproved.getTime()));
  const since = Date.now() - RECENT_DAYS * DAY;
  const tailOf = new Map(rows.map((r) => [r.aircraftId, r.tail ? normalizeRegistration(r.tail) : ""]));
  const toAdd = (id: string) => adding.has(id) || (!copied.has(id) && !haveTail.has(tailOf.get(id) ?? "-"));
  const recent = (id: string) => (updated.get(id) ?? 0) >= since;

  // Same matching as the Fleet search: an operator found by name shows its whole fleet, otherwise only the aircraft that match.
  // Without a search: only what still needs adding, and what changed this week (unless "Show all").
  const words = searchWords(q);
  const everything = showAll || words.length > 0;
  let hidden = 0;
  const shown = orgs
    .map((o) => {
      const all = rows.filter((r) => r.operatorId === o.id);
      const byName = !words.length || matchesWords(`${namesOf(o.id, o.canonicalName)} ${o.region ?? ""} ${o.base ?? ""}`, words);
      const found = byName ? all : all.filter((a) => matchesWords(`${a.aircraft} ${a.tail ?? ""} ${namesOf(o.id, o.canonicalName)}`, words));
      const aircraft = everything ? found : found.filter((a) => toAdd(a.aircraftId) || recent(a.aircraftId));
      hidden += found.length - aircraft.length;
      // Still to add first, then the newest changes.
      aircraft.sort((a, b) => Number(toAdd(b.aircraftId)) - Number(toAdd(a.aircraftId)) || (updated.get(b.aircraftId) ?? 0) - (updated.get(a.aircraftId) ?? 0));
      return { o, aircraft, left: found.filter((a) => toAdd(a.aircraftId)).length };
    })
    .filter(({ aircraft }) => aircraft.length > 0)
    // Operators with aircraft still to add go to the top.
    .sort((a, b) => Number(b.left > 0) - Number(a.left > 0));
  const totalAircraft = rows.filter((r) => scopeHasOperator(scope, r.operatorId)).length;
  // The directory's matches for this search: an operator found by name shows its fleet, otherwise matching aircraft.
  const DIR_MAX = 60;
  const dirFound = !words.length ? [] : dirAll.filter((r) => {
    const o = r.operatorId ? orgName.get(r.operatorId) : undefined;
    const names = o ? namesOf(o.id, o.canonicalName) : "";
    return matchesWords(`${names} ${o?.region ?? ""}`, words) || matchesWords(`${r.aircraft} ${r.tail ?? ""} ${names}`, words);
  });
  // One operator picked (e.g. from the A–Z list): its whole fleet, however large; otherwise the first DIR_MAX matches.
  const oneOperator = dirFound.length > 0 && dirFound.every((r) => r.operatorId === dirFound[0].operatorId);
  const dirLimit = oneOperator ? dirFound.length : DIR_MAX;
  const dirShown = dirFound.slice(0, dirLimit);
  const dirGroups = [...dirShown.reduce((m, r) => m.set(r.operatorId ?? "", [...(m.get(r.operatorId ?? "") ?? []), r]), new Map<string, typeof dirShown>())]
    .map(([id, list]) => ({ o: orgName.get(id), list: list.sort((a, b) => a.aircraft.localeCompare(b.aircraft) || (a.tail ?? "").localeCompare(b.tail ?? "")) }))
    .sort((a, b) => (brandOf(a.o?.id) ?? a.o?.canonicalName ?? "").localeCompare(brandOf(b.o?.id) ?? b.o?.canonicalName ?? ""));
  const shownCount = shown.reduce((n, s) => n + s.aircraft.length, 0);
  // Operators with photos (the library proper), and the directory's operators A–Z with their fleet sizes.
  const photoOps = new Set(rows.filter((r) => scopeHasOperator(scope, r.operatorId)).map((r) => r.operatorId));
  const dirCount = dirAll.reduce((m, r) => (r.operatorId ? m.set(r.operatorId, (m.get(r.operatorId) ?? 0) + 1) : m), new Map<string, number>());
  const dirOps = [...dirCount].map(([id, n]) => ({ o: orgName.get(id), n })).filter((x): x is { o: NonNullable<typeof x.o>; n: number } => !!x.o)
    .map((x) => ({ ...x, shown: brandOf(x.o.id) ?? x.o.canonicalName }))
    .sort((a, b) => a.shown.localeCompare(b.shown, "en", { sensitivity: "base" }));
  const letterOf = (name: string) => { const c = name.trim()[0]?.toUpperCase() ?? "#"; return c >= "A" && c <= "Z" ? c : "#"; };
  const dirLetters = [...dirOps.reduce((m, x) => m.set(letterOf(x.shown), [...(m.get(letterOf(x.shown)) ?? []), x]), new Map<string, typeof dirOps>())];

  // Details and photos only for what is shown, a few aircraft at a time.
  const details = new Map<string, { facts: string; photos: Awaited<ReturnType<typeof getLineup>> }>();
  const queue = shown.flatMap((s) => s.aircraft);
  const load = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const [c, photos] = await Promise.all([getAircraftCard(db, r.aircraftId), getLineup(db, { aircraftId: r.aircraftId, aircraftTypeId: r.aircraftTypeId })]);
      const facts = [
        c?.yom != null && `YOM ${c.yom}`, c?.yor != null && `YOR ${c.yor}`, c?.capacity != null && t("{n} seats", { n: c.capacity }),
        c && WIFI[c.wifi] && t(WIFI[c.wifi]!), c?.smoking === "yes" ? t("Smoking") : c?.smoking === "no" ? t("No smoking") : null,
        c?.pets === "yes" ? t("Pets") : c?.pets === "no" ? t("No pets") : null, r.base && t("Base: {base}", { base: r.base }),
      ].filter(Boolean).join(" · ");
      details.set(r.aircraftId, { facts, photos });
    }
  };
  await Promise.all(Array.from({ length: 4 }, load));
  const ago = (id: string) => {
    const ms = updated.get(id);
    if (!ms) return null;
    const d = Math.floor((Date.now() - ms) / DAY);
    return d <= 0 ? t("Updated today") : d === 1 ? t("Updated yesterday") : t("Updated {n} days ago", { n: d });
  };

  return (
    <>
      <h1>{t("Library")}</h1>
      <Flash error={one(sp.error)} ok={adding.size ? undefined : one(sp.ok)} />
      {adding.size > 0 && (
        <div className="card small">
          <AutoRefresh />
          {t("Adding {n} aircraft to your workspace with their photos (about half a minute each). You can leave this page; they keep arriving.", { n: adding.size })}
        </div>
      )}
      <div className="people-head" style={{ marginBottom: 10 }}>
        <p className="muted small" style={{ margin: 0 }}>
          {photoOps.size === 1 ? t("The Aircraft Media library: {n} operator with photos ({total} aircraft), ready to quote straight away (Quote page and Toy). Add one to your workspace to edit it or add your own photos.", { n: photoOps.size, total: totalAircraft }) : t("The Aircraft Media library: {n} operators with photos ({total} aircraft), ready to quote straight away (Quote page and Toy). Add one to your workspace to edit it or add your own photos.", { n: photoOps.size, total: totalAircraft })}
          {dirAll.length > 0 && <> {t("Plus a directory of {ops} US operators ({n} aircraft) known by their details only: search, or pick one from the list at the bottom of this page.", { ops: dirOps.length, n: dirAll.length })}</>}
        </p>
        {isAdmin && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Link href="/library/review" className="btn secondary small-btn">{t("Library review")}{waiting ? ` (${waiting})` : ""}</Link>
            <Link href="/library/import" className="btn secondary small-btn">{t("Import")}</Link>
          </div>
        )}
      </div>
      <form className="row" style={{ marginBottom: 10 }}>
        <div><input name="q" defaultValue={one(sp.q) ?? ""} placeholder={t("Search operator, region, type or tail")} aria-label={t("Search the library")} /></div>
        <div style={{ flex: "0 0 auto" }}><button type="submit" className="secondary">{t("Search")}</button></div>
      </form>
      {!words.length && orgs.length > 0 && (
        <p className="small muted" style={{ margin: "0 0 10px" }}>
          {showAll
            ? <>{t("Showing all {n} aircraft.", { n: totalAircraft })} <Link href="/library">{t("Show only new and recent")}</Link></>
            : <>{t("Showing {n} aircraft not in your workspace yet or updated in the last {days} days.", { n: shownCount, days: RECENT_DAYS })}{hidden > 0 && <> {t("{n} more are hidden: search for them, or", { n: hidden })} <Link href="/library?all=1">{t("show all")}</Link>{t(".")}</>}</>}
        </p>
      )}
      {shown.length === 0 && (
        <div className="card muted">
          {orgs.length === 0 ? (isAdmin ? t("The library is empty. Photos arrive in Library review once people who share with the library approve them.") : t("The library is empty for now."))
            : words.length ? (dirFound.length ? t("No library aircraft with photos match; see the directory below.") : t("Nothing matches that search.")) : t("Everything in the library is in your workspace and nothing changed in the last {n} days.", { n: RECENT_DAYS })}
        </div>
      )}
      {shown.map(({ o, aircraft, left }) => (
        <div key={o.id} className="card">
          <div className="person-head">
            <div style={{ minWidth: 0 }}>
              <b>{brandOf(o.id) ?? o.canonicalName}</b>{" "}
              <span className="pill wait">{t("{n} aircraft", { n: aircraft.length })}</span>
              {brandOf(o.id) && <div className="small muted">{o.canonicalName}</div>}
              <div className="small muted">{[o.region && t("Region: {region}", { region: o.region }), o.base && t("Base: {base}", { base: o.base })].filter(Boolean).join(" · ") || t("No region or base yet")}</div>
              <OperatorContacts o={o} />
            </div>
            {canAdd && (() => {
              const notAdding = aircraft.filter((r) => !copied.has(r.aircraftId) && !adding.has(r.aircraftId)).length;
              return left > 1 && notAdding > 0 && (
                <form action={addFromLibraryAction}>
                  <input type="hidden" name="libraryOperatorId" value={o.id} /><input type="hidden" name="q" value={one(sp.q) ?? ""} />
                  <PendingButton className="secondary small-btn" pending={t("Adding…")}>{notAdding === aircraft.length ? t("Add all {n} to my workspace", { n: notAdding }) : t("Add the other {n} to my workspace", { n: notAdding })}</PendingButton>
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
                  <div><b>{r.aircraft}</b>{r.tail ? ` · ${r.tail}` : ""}{ago(r.aircraftId) && <span className="small muted"> · {ago(r.aircraftId)}</span>}</div>
                  {copied.has(r.aircraftId) ? <span className="pill ok">{t("In your workspace")}</span>
                    : adding.has(r.aircraftId) ? <span className="pill wait">{t("Adding…")}</span>
                    : canAdd && (
                    <form action={addFromLibraryAction}>
                      <input type="hidden" name="libraryAircraftId" value={r.aircraftId} /><input type="hidden" name="q" value={one(sp.q) ?? ""} />
                      <PendingButton className="secondary small-btn" pending={t("Adding…")}>{t("Add to my workspace")}</PendingButton>
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
                      <img src={`/api/media/${combined.contentVersionId}`} alt={t("Combined photo")} loading="lazy" />
                      <span>COMBINED</span>
                    </a>
                  )}
                </div>
                {singles.length < 4 && <div className="small muted">{t("Still needs:")} {kinds.map((k) => ({ k, n: (k === "cabin" ? 2 : 1) - singles.filter((p) => p.classification === k).length })).filter((x) => x.n > 0).map((x) => (x.k === "floor_plan" ? t("{n} floor plan", { n: x.n }) : x.k === "cabin" ? t("{n} cabin", { n: x.n }) : t("{n} exterior", { n: x.n }))).join(t(", "))}</div>}
              </div>
            );
          })}
        </div>
      ))}
      {dirFound.length > 0 && (
        <div className="card" id="dir">
          <h3 style={{ marginTop: 0 }}>{t("Directory: {n} aircraft known by their details only", { n: dirFound.length })}</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            {t("From public registers (the FAA's list of US Part 135 operators): operator, type and tail. No photos yet: add one to your workspace, then add its photos and details there to quote it.")}
            {dirFound.length > dirLimit && <> {t("Showing the first {n}; search more precisely to see others.", { n: DIR_MAX })}</>}
          </p>
          {dirGroups.map(({ o, list }) => (
            <div key={o?.id ?? "none"} className="lib-ac">
              <div className="person-head">
                <div><b>{brandOf(o?.id) ?? o?.canonicalName ?? t("No operator")}</b> <span className="pill wait">{t("{n} aircraft", { n: list.length })}</span>{o && brandOf(o.id) && <div className="small muted">{o.canonicalName}</div>}</div>
                {canAdd && o && list.some((r) => !copied.has(r.aircraftId) && !adding.has(r.aircraftId)) && list.length > 1 && (
                  <form action={addFromLibraryAction}>
                    <input type="hidden" name="libraryOperatorId" value={o.id} /><input type="hidden" name="q" value={one(sp.q) ?? ""} />
                    <PendingButton className="secondary small-btn" pending={t("Adding…")}>{t("Add this operator's fleet to my workspace")}</PendingButton>
                  </form>
                )}
              </div>
              {list.map((r) => (
                <div key={r.aircraftId} className="person-head small" style={{ padding: "4px 0" }}>
                  <span>{r.aircraft}{r.tail ? ` · ${r.tail}` : ""}</span>
                  {copied.has(r.aircraftId) ? <span className="pill ok">{t("In your workspace")}</span>
                    : adding.has(r.aircraftId) ? <span className="pill wait">{t("Adding…")}</span>
                    : canAdd && (
                    <form action={addFromLibraryAction}>
                      <input type="hidden" name="libraryAircraftId" value={r.aircraftId} /><input type="hidden" name="q" value={one(sp.q) ?? ""} />
                      <PendingButton className="secondary small-btn" pending={t("Adding…")}>{t("Add to my workspace")}</PendingButton>
                    </form>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {!words.length && dirOps.length > 0 && (
        <details className="card collapse" id="directory">
          <summary><b>{t("US operators in the directory ({n})", { n: dirOps.length })}</b></summary>
          <p className="small muted">{t("From the FAA's list of US Part 135 operators, A–Z. Pick one to see its fleet and add aircraft to your workspace.")}</p>
          <div className="dir-letters">{dirLetters.map(([l]) => <a key={l} href={`#dir-${l}`}>{l}</a>)}</div>
          {dirLetters.map(([l, list]) => (
            <div key={l} id={`dir-${l}`} className="dir-letter">
              <h4>{l}</h4>
              <ul className="dir-ops">
                {list.map(({ o, n, shown }) => <li key={o.id}><Link href={`/library?q=${encodeURIComponent(o.canonicalName)}#dir`}>{shown}</Link> <span className="small muted">{n}</span>{shown !== o.canonicalName && <div className="small muted">{o.canonicalName}</div>}</li>)}
              </ul>
            </div>
          ))}
        </details>
      )}
    </>
  );
}
