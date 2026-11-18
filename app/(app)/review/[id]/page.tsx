import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraft, aircraftTypes, organisations } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { getMediaDetail } from "@/domain/media";
import { getAircraftCard } from "@/domain/directory";
import { AIRCRAFT_CATEGORIES, AIRCRAFT_CATEGORY_LABEL, CLASSIFICATIONS, CLASSIFICATION_LABEL, guessClassificationFromFilename } from "@/domain/constants";
import { getCatalogue } from "@/domain/catalogue";
import { parseAircraftCard, type ParsedCard } from "@/domain/card";
import { matchCard } from "@/domain/chat";
import {
  approveAction, assignPhotoAction, cropAction, mediaAssociationAction, mediaMetadataAction, reopenAction, rejectAction, restoreAction, retireAction, useVersionAction,
} from "../../../actions";
import { Flash, Key, one, type SP } from "../../../_components/ui";
import CropTool from "../../../_components/CropTool";

export default async function ReviewWorkspace({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const { actor } = await requireOwner();
  const db = await getDb();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await getMediaDetail(db, id);
  if (!d || d.media.tenantId !== actor.tenantId) notFound();
  const { media, versions, association, proposals, evidence } = d;
  const current = versions.find((v) => v.id === media.currentContentVersionId)!;

  const acs = await db.select({ a: aircraft, t: aircraftTypes }).from(aircraft).innerJoin(aircraftTypes, eq(aircraftTypes.id, aircraft.aircraftTypeId)).where(eq(aircraft.active, true));
  const aircraftOptions = await Promise.all(acs.map(async ({ a, t }) => ({ id: a.id, label: `${(await getAircraftCard(db, a.id))?.tailNumber ?? "?"} — ${t.manufacturer} ${t.model}` })));
  const types = await db.select().from(aircraftTypes).where(eq(aircraftTypes.active, true)).orderBy(asc(aircraftTypes.model));

  // Card proposal (deterministic parse): show what it suggests; the owner confirms through normal actions.
  const cardProposal = proposals.find((p) => p.proposalType === "details");
  // Re-read the card text each time (deterministic) so improvements and newly created operators apply to old photos too.
  const parsed: ParsedCard | undefined = evidence?.originalText
    ? parseAircraftCard(evidence.originalText)
    : cardProposal ? (cardProposal.proposal as unknown as ParsedCard) : undefined;
  const { tailMatches, opMatches, typeMatches, operatorText, operatorLoose, aircraftText, leftover } = parsed
    ? await matchCard(db, actor.tenantId, parsed)
    : { tailMatches: [] as string[], opMatches: [], typeMatches: [], operatorText: "", operatorLoose: false, aircraftText: "", leftover: [] as string[] };
  const suggestedClass = media.primaryClassification === "unclassified" ? guessClassificationFromFilename(evidence?.originalFilename ?? "") : null;
  const allOrgs = await db.select().from(organisations).where(eq(organisations.tenantId, actor.tenantId)).orderBy(asc(organisations.canonicalName));
  const catalogueRows = await getCatalogue(db, actor.tenantId);
  const operatorDefault = opMatches.length === 1 ? opMatches[0].id : opMatches.length === 0 && operatorText ? "new" : "";
  const typeDefault = typeMatches.length === 1 ? typeMatches[0].id : "";
  // Default aircraft: the one tail match, else the operator's only aircraft of that type (so a second photo joins it), else a new one.
  const sameTypeAndOperator = opMatches.length === 1 && typeMatches.length === 1 ? catalogueRows.filter((r) => r.operatorId === opMatches[0].id && r.aircraftTypeId === typeMatches[0].id) : [];
  const aircraftDefault = tailMatches.length === 1 ? tailMatches[0] : sameTypeAndOperator.length === 1 ? sameTypeAndOperator[0].aircraftId : association?.aircraftId ?? (parsed ? "new" : "none");
  const typeGroups = [...AIRCRAFT_CATEGORIES, "none" as const]
    .map((k) => ({
      key: k,
      label: k === "none" ? "No category" : AIRCRAFT_CATEGORY_LABEL[k],
      items: types.filter((t) => (k === "none" ? !t.category || !(AIRCRAFT_CATEGORIES as readonly string[]).includes(t.category) : t.category === k)),
    }))
    .filter((g) => g.items.length > 0);

  const retired = media.lifecycleState === "retired";
  const canDecide = media.reviewState === "needs_review" && !retired;

  return (
    <>
      <p className="small"><Link href="/review">← Review queue</Link></p>
      <h1>Review photo</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="grid g2">
        <div>
          <div className="card">
            <h3>Photo {versions.length > 1 && <span className="muted small">(version {current.versionNumber} of {versions.length})</span>}</h3>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="preview" src={`/api/media/${current.id}`} alt="Aircraft media" />
            <p className="muted small">{current.width}×{current.height}px · {current.mimeType} · {current.isDerivative ? "derivative (cropped)" : "original"} · state: <b>{media.reviewState.replace(/_/g, " ")}</b> · {media.lifecycleState}{media.rejectionReason ? ` · rejected: ${media.rejectionReason}` : ""}</p>
          </div>
          <div className="card">
            <h3>Source evidence</h3>
            <p className="small">File: {evidence?.originalFilename ?? "–"} · received {evidence?.receivedAt.toISOString().slice(0, 16).replace("T", " ")} · {evidence?.sourceKind}</p>
            {evidence?.originalText && <pre className="cardtext">{evidence.originalText}</pre>}
</div>
          {versions.length > 1 && (
            <div className="card">
              <h3>Versions</h3>
              <p className="muted small">Every crop is kept. Switching back (undo) does not delete anything.</p>
              <table><tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>{/* eslint-disable-next-line @next/next/no-img-element */}<a href={`/api/media/${v.id}`} target="_blank"><img src={`/api/media/${v.id}`} alt="" style={{ width: 80, height: 56, objectFit: "cover", borderRadius: 4 }} /></a></td>
                    <td>v{v.versionNumber}<br /><span className="small muted">{v.width}×{v.height} · {v.isDerivative ? "cropped" : "original"}</span></td>
                    <td>
                      {v.id === current.id ? <b className="small">Current</b> : (
                        <form action={useVersionAction}>
                          <Key /><input type="hidden" name="mediaId" value={media.id} /><input type="hidden" name="expectedVersion" value={media.version} /><input type="hidden" name="contentVersionId" value={v.id} />
                          <button className="secondary" type="submit" disabled={retired}>{v.id === current.parentContentVersionId ? "Undo crop (use this)" : "Use this version"}</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}
          <div className="card">
            <h3>Crop / separate photos</h3>
            <p className="muted small">“Replace” adds a cropped version and keeps the earlier one, so it can be undone. “Separate” makes a new photo (for collages); this photo stays untouched.</p>
            <CropTool
              src={`/api/media/${current.id}`}
              width={current.width ?? 100}
              height={current.height ?? 100}
              action={cropAction}
              mediaId={media.id}
              contentVersionId={current.id}
              disabled={retired}
              submitKey={randomUUID()}
            />
          </div>
        </div>

        <div>
          <form action={assignPhotoAction} className="card">
            <h3>Assign this photo</h3>
            <p className="muted small">
              Choose the operator and aircraft, and the details to save. {parsed ? "I filled in what I read from this photo's card text." : "No card text was sent with this photo."} Nothing is saved until you press the button.
            </p>
            {(parsed?.assumed ?? []).map((a, i) => <p key={`a${i}`} className="small muted" style={{ margin: "2px 0" }}>Assumed: {a}</p>)}
            {[...(parsed?.problems ?? []), ...leftover.map((u) => `Not recognised: ${u}`)].map((p, i) => <p key={i} className="small" style={{ color: "var(--warn)", margin: "2px 0" }}>{p}</p>)}
            <Key /><input type="hidden" name="mediaId" value={media.id} />
            <label>Operator</label>
            <select name="operator" defaultValue={operatorDefault}>
              <option value="">No operator</option>
              {operatorText && opMatches.length === 0 && <option value="new">Create new operator: {operatorText}</option>}
              {allOrgs.map((o) => <option key={o.id} value={o.id}>{o.canonicalName}</option>)}
            </select>
            <input type="hidden" name="newOperatorName" value={operatorText} />
            <label>Aircraft</label>
            <select name="aircraft" defaultValue={aircraftDefault}>
              <option value="new">Create a new aircraft</option>
              {catalogueRows.map((r) => <option key={r.aircraftId} value={r.aircraftId}>Use existing: {r.tail ?? "no tail yet"} — {r.aircraft}{r.operator ? ` — ${r.operator}` : ""}</option>)}
              <option value="none">No aircraft (photo represents the aircraft type)</option>
            </select>
            <label>Aircraft type</label>
            <select name="aircraftTypeId" defaultValue={typeDefault}>
              <option value="">Not chosen</option>
              {typeGroups.map((g) => (
                <optgroup key={g.key} label={g.label}>{g.items.map((t) => <option key={t.id} value={t.id}>{t.manufacturer} {t.model}</option>)}</optgroup>
              ))}
            </select>
            <div className="row">
              <div><label>Tail number</label><input name="tail" defaultValue={parsed?.tail ?? ""} placeholder="Optional" /></div>
              <div><label>View</label>
                <select name="classification" defaultValue={suggestedClass ?? media.primaryClassification}>{CLASSIFICATIONS.map((c) => <option key={c} value={c}>{CLASSIFICATION_LABEL[c]}</option>)}</select></div>
            </div>
            <div className="row">
              <div><label>YOM</label><input name="yom" type="number" defaultValue={parsed?.yom ?? ""} /></div>
              <div><label>YOR</label><input name="yor" type="number" defaultValue={parsed?.yor ?? ""} /></div>
              <div><label>Capacity</label><input name="capacity" type="number" defaultValue={parsed?.capacity ?? ""} /></div>
              <div><label>WIFI</label>
                <select name="wifiStatus" defaultValue={parsed?.wifi ?? "unknown"}><option value="yes">Yes</option><option value="no">No</option><option value="tbc">TBC</option><option value="unknown">Unknown</option></select></div>
            </div>
            <label>Notes</label><input name="notes" defaultValue={parsed?.notes ?? ""} />
            <input type="hidden" name="baseMode" value={parsed?.base?.mode ?? ""} /><input type="hidden" name="baseLocations" value={parsed?.base?.locations.join(", ") ?? ""} />
            <p className="muted small">Details are saved on a new aircraft, or added to the existing aircraft you choose (only the fields you fill in). The photo is approved when it has a view and an aircraft or type.</p>
            <p><button type="submit" disabled={retired}>Assign and approve</button></p>
          </form>

          <div className="card">
            <h3>Classification, order and rights</h3>
            <form action={mediaMetadataAction}>
              <Key /><input type="hidden" name="mediaId" value={media.id} /><input type="hidden" name="expectedVersion" value={media.version} />
              <div className="row">
                <div><label>Classification</label>
                  <select name="classification" defaultValue={suggestedClass ?? media.primaryClassification}>{CLASSIFICATIONS.map((c) => <option key={c} value={c}>{CLASSIFICATION_LABEL[c]}</option>)}</select></div>
                <div><label>Library order</label><input name="displayOrder" type="number" min={0} defaultValue={media.displayOrder} /></div>
                <div><label>Rights</label>
                  <select name="rightsStatus" defaultValue={media.rightsStatus}><option value="permitted">Permitted</option><option value="restricted">Restricted</option><option value="unknown">Unknown</option></select></div>
              </div>
              {suggestedClass && <p className="small muted">Suggested “{CLASSIFICATION_LABEL[suggestedClass]}” from the file name “{evidence?.originalFilename}”. Click Save to accept it.</p>}
              <p><button type="submit" className="secondary">Save</button></p>
            </form>
          </div>

          <div className="card">
            <h3>Association <span className="badge">{media.associationStatus.replace(/_/g, " ")}</span></h3>
            <p className="muted small">What this photo is evidence of. Visual similarity is not proof of identity — choose deliberately.</p>
            <form action={mediaAssociationAction}>
              <Key /><input type="hidden" name="mediaId" value={media.id} /><input type="hidden" name="expectedVersion" value={media.version} />
              <label>Status</label>
              <select name="status" defaultValue={media.associationStatus}>
                <option value="actual_aircraft">Actual aircraft (this exact aircraft)</option>
                <option value="representative_type">Representative of the aircraft type</option>
                <option value="unresolved">Unresolved</option>
              </select>
              <label>Aircraft (for actual)</label>
              <select name="aircraftId" defaultValue={association?.aircraftId ?? tailMatches[0] ?? ""}><option value="">—</option>{aircraftOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
              <label>Aircraft type (for representative)</label>
              <select name="aircraftTypeId" defaultValue={association?.aircraftTypeId ?? ""}><option value="">—</option>{types.map((t) => <option key={t.id} value={t.id}>{t.manufacturer} {t.model}</option>)}</select>
              <p><button type="submit" className="secondary">Save association</button></p>
            </form>
          </div>

          <div className="card">
            <h3>Decision</h3>
            {canDecide && (
              <div className="row">
                <form action={approveAction}>
                  <input type="hidden" name="mediaId" value={media.id} /><input type="hidden" name="contentVersionId" value={current.id} /><input type="hidden" name="expectedVersion" value={media.version} />
                  <button type="submit">Approve</button>
                </form>
                <form action={rejectAction} style={{ flex: 3 }}>
                  <Key /><input type="hidden" name="mediaId" value={media.id} /><input type="hidden" name="expectedVersion" value={media.version} />
                  <div className="row"><div><input name="reason" placeholder="Reason (optional)" /></div><div style={{ flex: "0 0 auto" }}><button type="submit" className="danger">Reject</button></div></div>
                </form>
              </div>
            )}
            {media.reviewState === "rejected" && (
              <form action={reopenAction}><Key /><input type="hidden" name="mediaId" value={media.id} /><input type="hidden" name="expectedVersion" value={media.version} /><button className="secondary" type="submit">Reopen for review</button></form>
            )}
            {media.reviewState === "approved" && !retired && <p className="muted">Approved. Changing the classification, association or crop returns it to review.</p>}
            <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "12px 0" }} />
            {retired ? (
              <form action={restoreAction}><Key /><input type="hidden" name="mediaId" value={media.id} /><button className="secondary" type="submit">Restore (retired)</button></form>
            ) : (
              <form action={retireAction}><Key /><input type="hidden" name="mediaId" value={media.id} /><button className="secondary" type="submit">Retire (hide from retrieval; history kept)</button></form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
