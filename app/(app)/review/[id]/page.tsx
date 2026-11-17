import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraft, aircraftTypes } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { getMediaDetail } from "@/domain/media";
import { findAircraftByTail, getAircraftCard, resolveAircraftTypes, resolveOrganisations } from "@/domain/directory";
import { CLASSIFICATIONS, CLASSIFICATION_LABEL, guessClassificationFromFilename } from "@/domain/constants";
import { parseAircraftCard, type ParsedCard } from "@/domain/card";
import { matchCard } from "@/domain/chat";
import {
  approveAction, createOperatorFromCardAction, cropAction, mediaAssociationAction, mediaMetadataAction, reopenAction, rejectAction, restoreAction, retireAction, useVersionAction,
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
  const prefill = new URLSearchParams();
  if (parsed?.tail) prefill.set("tail", parsed.tail);
  if (opMatches.length === 1) prefill.set("operatorId", opMatches[0].id);
  else if (opMatches.length === 0 && operatorText) prefill.set("newOperator", operatorText);
  if (typeMatches.length === 1) prefill.set("typeId", typeMatches[0].id);
  const suggestedClass = media.primaryClassification === "unclassified" ? guessClassificationFromFilename(evidence?.originalFilename ?? "") : null;
  if (parsed?.yom != null) prefill.set("yom", String(parsed.yom));
  if (parsed?.yor != null) prefill.set("yor", String(parsed.yor));
  if (parsed?.capacity != null) prefill.set("capacity", String(parsed.capacity));
  if (parsed?.wifi) prefill.set("wifi", parsed.wifi);
  if (parsed?.notes) prefill.set("notes", parsed.notes);
  if (parsed?.base) { prefill.set("baseMode", parsed.base.mode); prefill.set("baseLocations", parsed.base.locations.join(", ")); }

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
          {parsed && (
            <div className="card">
              <h3>Proposed from aircraft card <span className="badge">{cardProposal?.state ?? "proposed"}</span></h3>
              <p className="muted small">Proposal only — not a fact until you confirm it through the forms below or on the Aircraft page.</p>
              <table><tbody>
                {operatorText && (
                  <tr>
                    <td>Operator{operatorLoose && <span className="small muted"><br />(unlabelled line)</span>}</td>
                    <td>{operatorText}</td>
                    <td className="small">
                      {opMatches.length === 0 ? (
                        <form action={createOperatorFromCardAction}>
                          <Key /><input type="hidden" name="mediaId" value={media.id} /><input type="hidden" name="name" value={operatorText} />
                          <span>no match </span><button className="secondary" type="submit">Create operator “{operatorText}”</button>
                        </form>
                      ) : opMatches.map((o) => o.canonicalName).join(" | ")}
                    </td>
                  </tr>
                )}
                {aircraftText && <tr><td>Aircraft</td><td>{aircraftText}</td><td className="small">{typeMatches.length === 0 ? "no match" : typeMatches.map((t) => `${t.manufacturer} ${t.model}`).join(" | ")}</td></tr>}
                {parsed.tail && <tr><td>Tail number</td><td>{parsed.tail}</td><td className="small">{tailMatches.length === 0 ? "no current aircraft" : `${tailMatches.length} aircraft`}</td></tr>}
                {parsed.base && <tr><td>Base</td><td>{parsed.base.mode === "floating" ? "Floating" : parsed.base.locations.join(" / ")}</td><td /></tr>}
                {parsed.yom != null && <tr><td>YOM</td><td>{parsed.yom}</td><td /></tr>}
                {parsed.yor != null && <tr><td>YOR</td><td>{parsed.yor}</td><td /></tr>}
                {parsed.capacity != null && <tr><td>Capacity</td><td>{parsed.capacity}</td><td /></tr>}
                {parsed.wifi && <tr><td>WIFI</td><td>{parsed.wifi}</td><td /></tr>}
                {parsed.notes && <tr><td>Notes</td><td>{parsed.notes}</td><td /></tr>}
              </tbody></table>
              {(parsed.assumed ?? []).map((a, i) => <p key={`a${i}`} className="small muted">Assumed: {a}</p>)}
              {[...parsed.problems, ...leftover.map((u) => `Not recognised: ${u}`)].map((p, i) => <p key={i} className="small" style={{ color: "var(--warn)" }}>{p}</p>)}
              <p className="small">{tailMatches.length === 0 && <Link href={`/aircraft?${prefill.toString()}#create`}>Create this aircraft from the card →</Link>}</p>
            </div>
          )}

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
