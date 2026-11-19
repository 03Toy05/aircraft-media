import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraft, aircraftMedia, mediaAssociations, organisationAircraftRelationships, organisations } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { getAircraftCard, listInformationVersions, listRegistrationHistory } from "@/domain/directory";
import { formatAircraftCard } from "@/domain/card";
import { getLineup } from "@/domain/media";
import { CLASSIFICATIONS, CLASSIFICATION_LABEL } from "@/domain/constants";
import { COMBINED_NEEDS, combinedSources, existingCombined } from "@/domain/combinedPhoto";
import { addInfoVersionAction, addManagementAction, changeTailAction, makeCombinedAction, setBasesAction, setOperatorAction } from "../../../actions";
import { Flash, Key, one, type SP } from "../../../_components/ui";
import { ShareBox } from "../../../_components/ShareBox";
import PlacePicker from "../../../_components/PlacePicker";
import SearchSelect from "../../../_components/SearchSelect";
import Choice, { WIFI_CHOICES } from "../../../_components/Choice";

export default async function AircraftDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const { actor, readOnly } = await requireOwner();
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

  return (
    <>
      <p className="small"><Link href="/fleet">← Operators &amp; aircraft</Link></p>
      <h1>{card.tailNumber ?? "No tail number yet"} — {card.aircraft}</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="grid g2">
        <div>
          <div className="card">
            <h3>Compact card <span className="muted small">(version {card.informationVersion})</span></h3>
            <pre className="cardtext">{formatAircraftCard(card)}</pre>
          </div>
          <div className="card">
            <h3>Update information</h3>
            <p className="muted small">Saving creates a new version; earlier versions are kept below.</p>
            <form action={addInfoVersionAction}>
              <Key /><input type="hidden" name="aircraftId" value={id} /><input type="hidden" name="expectedVersion" value={card.informationVersion} />
              <div className="row">
                <div><label>YOM</label><input name="yom" type="number" inputMode="numeric" defaultValue={current?.yom ?? ""} /></div>
                <div><label>YOR</label><input name="yor" type="number" inputMode="numeric" defaultValue={current?.yor ?? ""} /></div>
                <div><label>Capacity</label><input name="capacity" type="number" inputMode="numeric" defaultValue={current?.capacity ?? ""} /></div>
              </div>
              <label>WIFI</label>
              <Choice name="wifiStatus" defaultValue={current?.wifiStatus ?? "unknown"} options={WIFI_CHOICES} ariaLabel="WIFI" />
              <label>WIFI details (optional, shown in quotes)</label><input name="wifiDetail" defaultValue={current?.wifiDetail ?? ""} placeholder="e.g. at USD 10/MB" />
              <label>Notes</label><input name="notes" defaultValue={current?.notes ?? ""} />
              <label>Effective / observed date (optional)</label><input name="effectiveDate" type="date" />
              <p><button type="submit">Save new version</button></p>
            </form>
          </div>
          <div className="card">
            <h3>Information versions</h3>
            <table><thead><tr><th>#</th><th>YOM</th><th>YOR</th><th>Cap.</th><th>WIFI</th><th>Notes</th><th>Recorded</th></tr></thead>
              <tbody>{[...infos].reverse().map((i) => (
                <tr key={i.id}><td>{i.versionNumber}{i.isCurrent ? " ●" : ""}</td><td>{i.yom ?? ""}</td><td>{i.yor ?? ""}</td><td>{i.capacity ?? ""}</td><td>{i.wifiStatus}</td><td>{i.notes}</td><td className="small">{i.createdAt.toISOString().slice(0, 10)}</td></tr>
              ))}</tbody></table>
          </div>
        </div>

        <div>
          <div className="card">
            <h3>Tail number</h3>
            <form action={changeTailAction}>
              <Key /><input type="hidden" name="aircraftId" value={id} />
              <div className="row">
                <div><label>New tail number</label><input name="newRegistration" required /></div>
                <div><label>Effective date</label><input name="effectiveDate" type="date" /></div>
              </div>
              {tailInUse && <label style={{ color: "var(--warn)" }}><input type="checkbox" name="tailResolution" value="distinct_aircraft" /> Confirm: this tail is not the other aircraft</label>}
              <p><button type="submit">Change tail (keeps history)</button></p>
            </form>
            <table><thead><tr><th>Registration</th><th>From</th><th>To</th></tr></thead>
              <tbody>{regs.map((r) => <tr key={r.id}><td>{r.registration}{r.isCurrent ? " ●" : ""}</td><td>{r.validFrom ?? "–"}</td><td>{r.validTo ?? "–"}</td></tr>)}</tbody></table>
          </div>

          <div className="card">
            <h3>Base</h3>
            <form action={setBasesAction}>
              <Key /><input type="hidden" name="aircraftId" value={id} />
              <Choice name="baseMode" defaultValue={card.base === "Floating" ? "floating" : "based"} ariaLabel="Base"
                options={[{ value: "based", label: "Based at…" }, { value: "floating", label: "Floating" }]} />
              <label>Locations</label>
              <PlacePicker name="baseLocations" kind="base" multiple defaultValue={card.base && card.base !== "Floating" ? card.base : ""} />
              <p><button type="submit" className="secondary">Save base</button></p>
            </form>
          </div>

          <div className="card">
            <h3>Operator and management</h3>
            <table><tbody>{rels.map(({ r, o }) => <tr key={r.id}><td><Link href={`/organisations/${o.id}`}>{o.canonicalName}</Link></td><td>{r.role.replace("_", " ")}</td><td>{r.active ? "current" : `ended ${r.validTo ?? ""}`}</td></tr>)}</tbody></table>
            <form action={setOperatorAction}>
              <Key /><input type="hidden" name="aircraftId" value={id} />
              <div className="row">
                <div><label>Set current operator</label><SearchSelect name="organisationId" required placeholder="Type an operator name" options={orgs.map((o) => ({ value: o.id, label: o.canonicalName, hint: o.region ?? undefined }))} /></div>
                <div><label>From</label><input type="date" name="validFrom" /></div>
                <div style={{ flex: "0 0 auto" }}><button type="submit" className="secondary">Set</button></div>
              </div>
            </form>
            <form action={addManagementAction} style={{ marginTop: 8 }}>
              <Key /><input type="hidden" name="aircraftId" value={id} />
              <div className="row">
                <div><label>Add management company</label><SearchSelect name="organisationId" required placeholder="Type a company name" options={orgs.map((o) => ({ value: o.id, label: o.canonicalName, hint: o.region ?? undefined }))} /></div>
                <div style={{ flex: "0 0 auto" }}><button type="submit" className="secondary">Add</button></div>
              </div>
            </form>
          </div>

          <div className="card">
            <h3>Send to a client</h3>
            <p className="small"><Link href={`/quote?ids=${id}`}>Write a quote message for this aircraft →</Link></p>
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
          </div>

          <div className="card">
            <h3>Media</h3>
            {lineup.length === 0 && pending.length === 0 && <p className="muted">No photos for this aircraft yet. <Link href="/intake">Upload</Link>.</p>}
            {CLASSIFICATIONS.map((c) => {
              const items = lineup.filter((l) => l.classification === c);
              if (!items.length) return null;
              return (
                <div key={c} style={{ marginBottom: 8 }}>
                  <div className="small muted">{CLASSIFICATION_LABEL[c]}</div>
                  <div className="thumbs">{items.map((l) => (
                    <Link key={l.mediaId} href={`/review/${l.mediaId}`} title={l.label}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/media/${l.contentVersionId}`} alt={l.label} />
                      <div className="small">{l.label}{l.associationStatus === "representative_type" ? " (representative)" : ""}</div>
                    </Link>
                  ))}</div>
                </div>
              );
            })}
            <div className="group" style={{ marginTop: 10 }}>
              <div className="group-row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="small">
                  <b>Combined photo</b>{" "}
                  {ownCombined.length
                    ? "made. Remake it after changing the photos."
                    : canCombine
                      ? "not made yet."
                      : `needs ${COMBINED_NEEDS}, all approved (photos of this type count too, but at least one must be of this aircraft).`}
                </span>
                {canCombine && (
                  <form action={makeCombinedAction}>
                    <input type="hidden" name="aircraftId" value={id} />
                    <button type="submit" className="secondary small-btn" disabled={readOnly}>{ownCombined.length ? "Remake" : "Make it now"}</button>
                  </form>
                )}
              </div>
            </div>
            {pending.length > 0 && <p className="small">Awaiting review: {pending.map(({ m }) => <Link key={m.id} href={`/review/${m.id}`}>photo </Link>)}</p>}
          </div>
        </div>
      </div>
    </>
  );
}
