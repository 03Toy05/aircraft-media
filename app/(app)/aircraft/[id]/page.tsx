import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraft, aircraftMedia, mediaAssociations, organisationAircraftRelationships, organisations } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { serverT } from "@/lib/uiLang";
import { getAircraftCard, listInformationVersions, listRegistrationHistory } from "@/domain/directory";
import { formatAircraftCard } from "@/domain/card";
import { getLineup } from "@/domain/media";
import { CLASSIFICATIONS, CLASSIFICATION_LABEL } from "@/domain/constants";
import { COMBINED_NEEDS, combinedSources, existingCombined } from "@/domain/combinedPhoto";
import { addInfoVersionAction, addManagementAction, changeTailAction, makeCombinedAction, offerLibraryUpdateAction, setBasesAction, setOperatorAction, updateLibraryCopyAction } from "../../../actions";
import { copyStatus, libraryTwin, offerablePhotos } from "@/domain/library";
import { Flash, Key, one, type SP } from "../../../_components/ui";
import { ShareBox } from "../../../_components/ShareBox";
import PlacePicker from "../../../_components/PlacePicker";
import SearchSelect from "../../../_components/SearchSelect";
import Choice, { WIFI_CHOICES, YES_NO_CHOICES } from "../../../_components/Choice";

export default async function AircraftDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const { actor, readOnly } = await requireOwner();
  const t = await serverT();
  const db = await getDb();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [ac] = await db.select().from(aircraft).where(and(eq(aircraft.id, id), eq(aircraft.tenantId, actor.tenantId)));
  if (!ac) notFound();
  const card = (await getAircraftCard(db, id))!;
  const regs = await listRegistrationHistory(db, id);
  const infos = await listInformationVersions(db, id);
  const orgs = await db.select().from(organisations).where(eq(organisations.tenantId, actor.tenantId)).orderBy(asc(organisations.canonicalName));
  const rels = await db
    .select({ r: organisationAircraftRelationships, o: organisations })
    .from(organisationAircraftRelationships)
    .innerJoin(organisations, eq(organisations.id, organisationAircraftRelationships.organisationId))
    .where(and(eq(organisationAircraftRelationships.aircraftId, id), eq(organisations.tenantId, actor.tenantId)));
  const lineup = await getLineup(db, { aircraftId: id, aircraftTypeId: ac.aircraftTypeId });
  const pending = await db
    .select({ m: aircraftMedia })
    .from(aircraftMedia)
    .innerJoin(mediaAssociations, and(eq(mediaAssociations.aircraftMediaId, aircraftMedia.id), eq(mediaAssociations.active, true), eq(mediaAssociations.aircraftId, id)))
    .where(and(eq(aircraftMedia.tenantId, actor.tenantId), eq(aircraftMedia.reviewState, "needs_review")));
  const scope = { kind: "aircraft" as const, aircraftId: id, aircraftTypeId: ac.aircraftTypeId };
  const ownCombined = await existingCombined(db, actor.tenantId, scope);
  const canCombine = !!(await combinedSources(db, actor.tenantId, scope));
  const current = infos.find((i) => i.isCurrent);
  const tailInUse = (one(sp.error) ?? "").includes("another aircraft");
  // The platform library: an aircraft added from it can take its newer photos; one whose tail the library has can offer newer ones to it.
  const copy = await copyStatus(db, actor.tenantId, id);
  const twin = await libraryTwin(db, actor.tenantId, id);
  const offerable = twin ? await offerablePhotos(db, actor.tenantId, id) : [];

  // The facts as label / value pairs (the same lines the copied card uses), so the page and the message agree.
  const facts = formatAircraftCard(card).split("\n").map((line) => {
    const at = line.indexOf(":");
    return { label: line.slice(0, at), value: line.slice(at + 1).trim() };
  }).filter((f) => f.label !== "Aircraft");
  const yn = (v: string) => (v === "yes" ? t("Yes") : v === "no" ? t("No") : v === "tbc" ? "TBC" : "");
  const versionLine = (i: (typeof infos)[number]) => [
    i.yom != null && `YOM ${i.yom}`, i.yor != null && `YOR ${i.yor}`, i.capacity != null && t("{n} seats", { n: i.capacity }),
    yn(i.wifiStatus) && `WIFI ${yn(i.wifiStatus)}${i.wifiDetail ? ` (${i.wifiDetail})` : ""}`,
    yn(i.smoking) && `${t("Smoking")} ${yn(i.smoking)}`, yn(i.pets) && `${t("Pets")} ${yn(i.pets)}`, i.cleaningFee && `${t("Cleaning fee")} ${i.cleaningFee}`,
    i.notes && `${t("Notes:")} ${i.notes}`,
  ].filter(Boolean).join(" · ") || t("Nothing recorded");
  // The view names on this page: the Rulebook's EXT / CABIN codes in English, words in Chinese.
  const viewName = (c: string) => (t.lang === "en" ? CLASSIFICATION_LABEL[c as keyof typeof CLASSIFICATION_LABEL] ?? c : c === "exterior" ? t("Exterior") : c === "cabin" ? t("Cabin") : c === "floor_plan" ? t("Floor plan") : c === "combined" ? t("Combined") : CLASSIFICATION_LABEL[c as keyof typeof CLASSIFICATION_LABEL] ?? c);
  const factValue = (v: string) => (v === "Yes" ? t("Yes") : v === "No" ? t("No") : v === "Unknown" ? t("Unknown") : v);

  return (
    <>
      <p className="small"><Link href="/fleet">← {t("Operators & aircraft")}</Link></p>
      <h1 style={{ marginBottom: 2 }}>{card.aircraft}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {card.tailNumber ?? t("Tail TBC")}{card.operator ? ` · ${card.operator}` : ""}{card.base ? ` · ${card.base}` : ""}
      </p>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="grid g2">
        <div>
          {/* What people open an aircraft for: its photos, and sending them. */}
          <div className="card">
            <h3>{t("Photos")}</h3>
            {lineup.length === 0 && pending.length === 0 && <p className="muted">{t("No photos for this aircraft yet.")} <Link href="/intake">{t("Upload photos")}</Link>{t(".")}</p>}
            {CLASSIFICATIONS.map((c) => {
              const items = lineup.filter((l) => l.classification === c);
              if (!items.length) return null;
              return (
                <div key={c} style={{ marginBottom: 8 }}>
                  <div className="small muted">{viewName(c)}</div>
                  <div className="thumbs">{items.map((l) => (
                    <Link key={l.mediaId} href={`/review/${l.mediaId}`} title={l.label}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/media/${l.contentVersionId}`} alt={l.label} loading="lazy" />
                      <div className="small">{l.label}{l.associationStatus === "representative_type" ? ` ${t("(representative)")}` : ""}</div>
                    </Link>
                  ))}</div>
                </div>
              );
            })}
            {pending.length > 0 && <p className="small">{t("Waiting for review:")} {pending.map(({ m }) => <Link key={m.id} href={`/review/${m.id}`}>{t("photo")} </Link>)}</p>}
          </div>

          <div className="card">
            <h3>{t("Send to a client")}</h3>
            <p className="small" style={{ marginTop: 0 }}><Link href={`/quote?ids=${id}`}>{t("Write a quote message for this aircraft →")}</Link></p>
            <ShareBox
              aircraftId={id}
              tail={card.tailNumber ?? "aircraft"}
              cardText={formatAircraftCard(card)}
              items={lineup.map((l) => ({
                classification: l.classification,
                classificationLabel: CLASSIFICATION_LABEL[l.classification],
                label: l.label,
                url: `/api/media/${l.contentVersionId}`,
                mimeType: l.mimeType,
                representative: l.associationStatus === "representative_type",
              }))}
            />
            <div className="group" style={{ marginTop: 10 }}>
              <div className="group-row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="small">
                  <b>{t("Combined photo")}</b>{" "}
                  {ownCombined.length
                    ? t("made. Remake it after changing the photos.")
                    : canCombine
                      ? t("not made yet.")
                      : t("needs {needs}, all approved (photos of this type count too, but at least one must be of this aircraft).", { needs: t(COMBINED_NEEDS) })}
                </span>
                {canCombine && (
                  <form action={makeCombinedAction}>
                    <input type="hidden" name="aircraftId" value={id} />
                    <button type="submit" className="secondary small-btn" disabled={readOnly}>{ownCombined.length ? t("Remake") : t("Make it now")}</button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <h3>{t("Details")}</h3>
            <dl className="facts">
              {facts.map((f) => (
                <div key={f.label}><dt>{t(f.label)}</dt><dd className={f.value ? "" : "muted"}>{factValue(f.value) || "—"}</dd></div>
              ))}
            </dl>
            <details className="collapse edit-details" style={{ marginTop: 10 }}>
              <summary className="btn secondary">{t("Edit details")}</summary>
              <form action={addInfoVersionAction}>
                <Key /><input type="hidden" name="aircraftId" value={id} /><input type="hidden" name="expectedVersion" value={card.informationVersion} />
                <div className="info-form">
                  <div className="f"><label>YOM</label><input name="yom" type="number" inputMode="numeric" defaultValue={current?.yom ?? ""} /></div>
                  <div className="f"><label>YOR</label><input name="yor" type="number" inputMode="numeric" defaultValue={current?.yor ?? ""} /></div>
                  <div className="f"><label>{t("Capacity")}</label><input name="capacity" type="number" inputMode="numeric" defaultValue={current?.capacity ?? ""} /></div>
                  <div className="f half"><label>WIFI</label><Choice name="wifiStatus" defaultValue={current?.wifiStatus ?? "unknown"} options={WIFI_CHOICES} ariaLabel="WIFI" /></div>
                  <div className="f half"><label>{t("WIFI details")}</label><input name="wifiDetail" defaultValue={current?.wifiDetail ?? ""} placeholder={t("e.g. at USD 10/MB")} /></div>
                  <div className="f half"><label>{t("Smoking")}</label><Choice name="smoking" defaultValue={current?.smoking ?? "unknown"} options={YES_NO_CHOICES} ariaLabel={t("Smoking")} /></div>
                  <div className="f half"><label>{t("Pets")}</label><Choice name="pets" defaultValue={current?.pets ?? "unknown"} options={YES_NO_CHOICES} ariaLabel={t("Pets")} /></div>
                  <div className="f full"><label>{t("Cleaning fee")}</label><input name="cleaningFee" defaultValue={current?.cleaningFee ?? ""} placeholder={t("e.g. USD 500 for pets or smoking")} /></div>
                  <div className="f full"><label>{t("Notes")}</label><input name="notes" defaultValue={current?.notes ?? ""} /></div>
                </div>
                <div className="info-actions"><button type="submit">{t("Save")}</button><span className="muted small">{t("The old details are kept in the history.")}</span></div>
              </form>
            </details>
            {infos.length > 1 && (
              <details className="collapse" style={{ marginTop: 10 }}>
                <summary className="small">{t("Earlier versions ({n})", { n: infos.length })}</summary>
                <ul className="history">
                  {[...infos].reverse().map((i) => (
                    <li key={i.id}>
                      <b>{t("Version {n}", { n: i.versionNumber })}</b>{i.isCurrent ? ` ${t("(current)")}` : ""} <span className="muted small">· {i.createdAt.toISOString().slice(0, 10)}</span>
                      <div className="small">{versionLine(i)}</div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {(copy || (twin && offerable.length > 0)) && (
            <div className="card">
              <h3>{t("Aircraft Media library")}</h3>
              {copy && (
                <>
                  <p className="small muted" style={{ marginTop: 0 }}>{t("Added from the library on {date}.", { date: copy.addedAt.toISOString().slice(0, 10) })}</p>
                  {copy.newer > 0 ? (
                    <form action={updateLibraryCopyAction} className="row" style={{ alignItems: "center" }}>
                      <input type="hidden" name="aircraftId" value={id} />
                      <div className="small">{copy.newer === 1 ? t("The library has {n} newer photo for this aircraft.", { n: 1 }) : t("The library has {n} newer photos for this aircraft.", { n: copy.newer })}</div>
                      {!readOnly && <div style={{ flex: "0 0 auto" }}><button type="submit" className="small-btn">{t("Update my copy")}</button></div>}
                    </form>
                  ) : <p className="small" style={{ margin: 0 }}>{t("Your photos match the library's.")}</p>}
                  <p className="small muted">{t("Updating swaps only the photos that came from the library; photos you uploaded yourself are never touched.")}</p>
                </>
              )}
              {twin && offerable.length > 0 && (
                <form action={offerLibraryUpdateAction}>
                  <input type="hidden" name="aircraftId" value={id} />
                  <p className="small" style={{ marginTop: copy ? 8 : 0 }}>{t("The library has this aircraft. Are your photos newer (after a refurbishment, say)? Offer them, and the Aircraft Media team will compare them with the library's.")}</p>
                  <div className="lib-tiles">
                    {offerable.map((p) => (
                      <label key={p.mediaId} className="lib-tile">
                        <input type="checkbox" name="mediaId" value={p.mediaId} disabled={p.offered || readOnly} aria-label={t("Offer this {view}", { view: t.lang === "en" ? p.classification : viewName(p.classification) })} />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/media/${p.contentVersionId}`} alt={p.classification} />
                        <span>{viewName(p.classification)}{p.offered ? ` · ${t("offered")}` : ""}</span>
                      </label>
                    ))}
                  </div>
                  {!readOnly && <button type="submit" className="secondary small-btn">{t("Offer ticked photos as newer ones")}</button>}
                </form>
              )}
            </div>
          )}

          {/* Less often changed: folded so the page stays short. */}
          <details className="card collapse" open={tailInUse}>
            <summary>{t("Tail number")} <span className="muted small" style={{ fontWeight: 400, marginLeft: 6 }}>{card.tailNumber ?? "TBC"}</span></summary>
            <form action={changeTailAction}>
              <Key /><input type="hidden" name="aircraftId" value={id} />
              <div className="row">
                <div><label>{t("New tail number")}</label><input name="newRegistration" required /></div>
                <div><label>{t("Effective date")}</label><input name="effectiveDate" type="date" /></div>
              </div>
              {tailInUse && <label style={{ color: "var(--warn)" }}><input type="checkbox" name="tailResolution" value="distinct_aircraft" /> {t("Confirm: this tail is not the other aircraft")}</label>}
              <p><button type="submit">{t("Change tail (keeps history)")}</button></p>
            </form>
            {regs.length > 0 && (
              <ul className="history">{regs.map((r) => <li key={r.id}><b>{r.registration}</b>{r.isCurrent ? ` ${t("(current)")}` : ""} <span className="muted small">· {t("{from} to {to}", { from: r.validFrom ?? "–", to: r.validTo ?? t("now") })}</span></li>)}</ul>
            )}
          </details>

          <details className="card collapse">
            <summary>{t("Base")} <span className="muted small" style={{ fontWeight: 400, marginLeft: 6 }}>{card.base === "Floating" ? t("Floating") : card.base ?? t("not set")}</span></summary>
            <form action={setBasesAction}>
              <Key /><input type="hidden" name="aircraftId" value={id} />
              <Choice name="baseMode" defaultValue={card.base === "Floating" ? "floating" : "based"} ariaLabel={t("Base")}
                options={[{ value: "based", label: t("Based at…") }, { value: "floating", label: t("Floating") }]} />
              <label>{t("Locations")}</label>
              <PlacePicker name="baseLocations" kind="base" multiple defaultValue={card.base && card.base !== "Floating" ? card.base : ""} />
              <p><button type="submit" className="secondary">{t("Save base")}</button></p>
            </form>
          </details>

          <details className="card collapse">
            <summary>{t("Operator and management")} <span className="muted small" style={{ fontWeight: 400, marginLeft: 6 }}>{card.operator ?? t("none")}</span></summary>
            <ul className="history">{rels.map(({ r, o }) => <li key={r.id}><Link href={`/organisations/${o.id}`}>{o.canonicalName}</Link> <span className="muted small">· {r.role === "operator" ? t("operator") : t("management company")} · {r.active ? t("current") : t("ended {date}", { date: r.validTo ?? "" })}</span></li>)}</ul>
            <form action={setOperatorAction}>
              <Key /><input type="hidden" name="aircraftId" value={id} />
              <div className="row">
                <div><label>{t("Set current operator")}</label><SearchSelect name="organisationId" required placeholder={t("Type an operator name")} options={orgs.map((o) => ({ value: o.id, label: o.canonicalName, hint: o.region ?? undefined }))} /></div>
                <div><label>{t("From")}</label><input type="date" name="validFrom" /></div>
                <div style={{ flex: "0 0 auto" }}><button type="submit" className="secondary">{t("Set")}</button></div>
              </div>
            </form>
            <form action={addManagementAction} style={{ marginTop: 8 }}>
              <Key /><input type="hidden" name="aircraftId" value={id} />
              <div className="row">
                <div><label>{t("Add management company")}</label><SearchSelect name="organisationId" required placeholder={t("Type a company name")} options={orgs.map((o) => ({ value: o.id, label: o.canonicalName, hint: o.region ?? undefined }))} /></div>
                <div style={{ flex: "0 0 auto" }}><button type="submit" className="secondary">{t("Add")}</button></div>
              </div>
            </form>
          </details>
        </div>
      </div>
    </>
  );
}
