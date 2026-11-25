import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftTypes, organisations } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { findUploadSiblings, getMediaDetail } from "@/domain/media";
import { AIRCRAFT_CATEGORIES, AIRCRAFT_CATEGORY_LABEL, CLASSIFICATIONS, CLASSIFICATION_LABEL, guessClassificationFromFilename } from "@/domain/constants";
import { getCatalogue } from "@/domain/catalogue";
import { parseAircraftCard, type ParsedCard } from "@/domain/card";
import { matchCard } from "@/domain/chat";
import {
  approveAction, assignPhotoAction, cropAction, mediaAssociationAction, mediaMetadataAction, reopenAction, rejectAction, restoreAction, retireAction, useVersionAction,
} from "../../../actions";
import { Flash, Key, one, type SP } from "../../../_components/ui";
import CropTool from "../../../_components/CropTool";
import AircraftPicker from "../../../_components/AircraftPicker";
import { SetRest, ViewChoice } from "../../../_components/ViewChoice";
import SearchSelect from "../../../_components/SearchSelect";
import Choice, { WIFI_CHOICES, YES_NO_CHOICES } from "../../../_components/Choice";
import { serverT } from "@/lib/uiLang";

export default async function ReviewWorkspace({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await serverT();
  const { actor } = await requireOwner();
  const db = await getDb();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await getMediaDetail(db, actor.tenantId, id);
  if (!d || d.media.tenantId !== actor.tenantId) notFound();
  const { media, versions, association, proposals, evidence } = d;
  const current = versions.find((v) => v.id === media.currentContentVersionId)!;

  const types = await db.select().from(aircraftTypes).where(and(eq(aircraftTypes.tenantId, actor.tenantId), eq(aircraftTypes.active, true))).orderBy(asc(aircraftTypes.model));
  const typeLabel = new Map(types.map((ty) => [ty.id, `${ty.manufacturer} ${ty.model}`]));
  const siblings = media.reviewState === "needs_review" ? await findUploadSiblings(db, actor.tenantId, media.id) : [];
  const scanned = siblings.some((x) => x.autoReason) || !!(d.evidence?.metadata as { autoViewReason?: string } | undefined)?.autoViewReason;

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
  const mainView = suggestedClass ?? media.primaryClassification;
  const autoReason = (evidence?.metadata as { autoViewReason?: string } | undefined)?.autoViewReason ?? (suggestedClass ? t("from the file name") : null);
  const allOrgs = await db.select().from(organisations).where(eq(organisations.tenantId, actor.tenantId)).orderBy(asc(organisations.canonicalName));
  const catalogueRows = await getCatalogue(db, actor.tenantId);
  const aircraftOptions = catalogueRows.map((r) => ({ id: r.aircraftId, label: `${r.tail ?? t("no tail yet")} — ${r.aircraft}` }));
  const operatorDefault = opMatches.length === 1 ? opMatches[0].id : opMatches.length === 0 && operatorText ? "new" : "";
  const typeDefault = typeMatches.length === 1 ? typeMatches[0].id : "";
  // Default aircraft: the one tail match, else the operator's only aircraft of that type (so a second photo joins it), else a new one.
  const sameTypeAndOperator = opMatches.length === 1 && typeMatches.length === 1 ? catalogueRows.filter((r) => r.operatorId === opMatches[0].id && r.aircraftTypeId === typeMatches[0].id) : [];
  const aircraftDefault = tailMatches.length === 1 ? tailMatches[0] : sameTypeAndOperator.length === 1 ? sameTypeAndOperator[0].aircraftId : association?.aircraftId ?? (parsed ? "new" : "none");
  const typeGroups = [...AIRCRAFT_CATEGORIES, "none" as const]
    .map((k) => ({
      key: k,
      label: k === "none" ? t("No category") : t(AIRCRAFT_CATEGORY_LABEL[k]),
      items: types.filter((ty) => (k === "none" ? !ty.category || !(AIRCRAFT_CATEGORIES as readonly string[]).includes(ty.category) : ty.category === k)),
    }))
    .filter((g) => g.items.length > 0);

  const retired = media.lifecycleState === "retired";
  const canDecide = media.reviewState === "needs_review" && !retired;

  return (
    <>
      <p className="small"><Link href="/review">{t("← Review queue")}</Link></p>
      <h1>{t("Review photo")}</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="grid g2">
        <div>
          <div className="card">
            <h3>{t("Photo")} {versions.length > 1 && <span className="muted small">{t("(version {n} of {total})", { n: current.versionNumber, total: versions.length })}</span>}</h3>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="preview" src={`/api/media/${current.id}`} alt={t("Aircraft media")} />
            <p className="muted small">{current.width}×{current.height}px · {current.mimeType} · {current.isDerivative ? t("derivative (cropped)") : t("original")} · {t("state:")} <b>{media.reviewState.replace(/_/g, " ")}</b> · {media.lifecycleState}{media.rejectionReason ? ` · ${t("rejected: {reason}", { reason: media.rejectionReason })}` : ""}</p>
          </div>
          <div className="card">
            <h3>{t("Source evidence")}</h3>
            <p className="small">{t("File:")} {evidence?.originalFilename ?? "–"} · {t("received {date}", { date: evidence?.receivedAt.toISOString().slice(0, 16).replace("T", " ") ?? "" })} · {evidence?.sourceKind}</p>
            {evidence?.originalText && <pre className="cardtext">{evidence.originalText}</pre>}
</div>
          {versions.length > 1 && (
            <div className="card">
              <h3>{t("Versions")}</h3>
              <p className="muted small">{t("Every crop is kept. Switching back (undo) does not delete anything.")}</p>
              <table><tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>{/* eslint-disable-next-line @next/next/no-img-element */}<a href={`/api/media/${v.id}`} target="_blank"><img src={`/api/media/${v.id}`} alt="" style={{ width: 80, height: 56, objectFit: "cover", borderRadius: 4 }} /></a></td>
                    <td>v{v.versionNumber}<br /><span className="small muted">{v.width}×{v.height} · {v.isDerivative ? t("cropped") : t("original")}</span></td>
                    <td>
                      {v.id === current.id ? <b className="small">{t("Current")}</b> : (
                        <form action={useVersionAction}>
                          <Key /><input type="hidden" name="mediaId" value={media.id} /><input type="hidden" name="expectedVersion" value={media.version} /><input type="hidden" name="contentVersionId" value={v.id} />
                          <button className="secondary" type="submit" disabled={retired}>{v.id === current.parentContentVersionId ? t("Undo crop (use this)") : t("Use this version")}</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}
          <div className="card">
            <h3>{t("Crop / separate photos")}</h3>
            <p className="muted small">{t("“Replace” adds a cropped version and keeps the earlier one, so it can be undone. “Separate” makes a new photo (for collages); this photo stays untouched.")}</p>
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
            <h3>{t("Assign this photo")}</h3>
            <p className="muted small">
              {t("Choose the operator and aircraft, and the details to save.")} {parsed ? t("I filled in what I read from this photo's card text.") : t("No card text was sent with this photo.")} {t("Nothing is saved until you press the button.")}
            </p>
            {(parsed?.assumed ?? []).map((a, i) => <p key={`a${i}`} className="small muted" style={{ margin: "2px 0" }}>{t("Assumed: {text}", { text: a })}</p>)}
            {[...(parsed?.problems ?? []), ...leftover.map((u) => t("Not recognised: {text}", { text: u }))].map((p, i) => <p key={i} className="small" style={{ color: "var(--warn)", margin: "2px 0" }}>{p}</p>)}
            <Key /><input type="hidden" name="mediaId" value={media.id} />
            <fieldset className="siblings views">
              <legend>{siblings.length ? t("{n} photos sent together", { n: siblings.length + 1 }) : t("View")}</legend>
              <p className="muted small">
                {scanned ? `${t("I scanned them first: floor plans are found by how they're drawn, and file names like “ext” or “cabin” are read.")} ` : ""}
                {siblings.length ? t("Check each view, and untick any photo that doesn't belong. The operator, aircraft and details below apply to all ticked photos.") : t("Check each view.")}
              </p>
              <div className="sibling">
                <span className="sib-check" aria-hidden>✓</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${current.id}`} alt="" />
                <span className="small sib-name">{t("This photo")}{autoReason ? <span className="muted"> · {autoReason}</span> : null}</span>
                <ViewChoice name="classification" value={mainView} label={t("View of this photo")} group="upload" />
              </div>
              {siblings.map((sib) => (
                <div key={sib.mediaId} className="sibling">
                  <input type="checkbox" name="also" value={sib.mediaId} defaultChecked aria-label={t("Include {name}", { name: sib.filename ?? t("photo") })} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {sib.contentVersionId ? <img src={`/api/media/${sib.contentVersionId}`} alt="" /> : <span />}
                  <span className="small sib-name">{sib.filename ?? t("Photo")}{sib.autoReason ? <span className="muted"> · {sib.autoReason}</span> : null}</span>
                  <ViewChoice name={`cls_${sib.mediaId}`} value={sib.classification} label={t("View of {name}", { name: sib.filename ?? t("photo") })} group="upload" />
                </div>
              ))}
              {siblings.length > 0 && <p style={{ margin: "6px 0 0" }}><SetRest group="upload" to="cabin" label={t("Set the rest to Cabin")} /></p>}
            </fieldset>
            <AircraftPicker
              operators={allOrgs.filter((o) => o.active).map((o) => ({ id: o.id, name: o.canonicalName }))}
              aircraft={catalogueRows.map((r) => ({ id: r.aircraftId, label: `${r.tail ?? t("no tail yet")} — ${r.aircraft}${r.operator ? ` — ${r.operator}` : ""}`, aircraftTypeId: r.aircraftTypeId, typeLabel: typeLabel.get(r.aircraftTypeId) ?? r.aircraft, operatorId: r.operatorId }))}
              typeGroups={typeGroups.map((g) => ({ key: g.key, label: g.label, items: g.items.map((ty) => ({ id: ty.id, label: `${ty.manufacturer} ${ty.model}` })) }))}
              newOperatorName={operatorText && opMatches.length === 0 ? operatorText : ""}
              defaults={{ operator: operatorDefault, aircraft: aircraftDefault, type: typeDefault }}
            />
            <label>{t("Tail number")}</label><input name="tail" defaultValue={parsed?.tail ?? ""} placeholder={t("Optional")} />
            <div className="row">
              <div><label>YOM</label><input name="yom" type="number" inputMode="numeric" defaultValue={parsed?.yom ?? ""} /></div>
              <div><label>YOR</label><input name="yor" type="number" inputMode="numeric" defaultValue={parsed?.yor ?? ""} /></div>
              <div><label>{t("Capacity")}</label><input name="capacity" type="number" inputMode="numeric" defaultValue={parsed?.capacity ?? ""} /></div>
            </div>
            <label>WIFI</label>
            <Choice name="wifiStatus" defaultValue={parsed?.wifi ?? "unknown"} options={WIFI_CHOICES} ariaLabel="WIFI" />
            <label>{t("WIFI details")}</label><input name="wifiDetail" defaultValue={parsed?.wifiDetail ?? ""} placeholder={t("e.g. complimentary")} />
            <div className="row">
              <div><label>{t("Smoking")}</label><Choice name="smoking" defaultValue={parsed?.smoking ?? "unknown"} options={YES_NO_CHOICES} ariaLabel={t("Smoking")} /></div>
              <div><label>{t("Pets")}</label><Choice name="pets" defaultValue={parsed?.pets ?? "unknown"} options={YES_NO_CHOICES} ariaLabel={t("Pets")} /></div>
            </div>
            <label>{t("Notes")}</label><input name="notes" defaultValue={parsed?.notes ?? ""} />
            <input type="hidden" name="baseMode" value={parsed?.base?.mode ?? ""} /><input type="hidden" name="baseLocations" value={parsed?.base?.locations.join(", ") ?? ""} />
            <p className="muted small">{t("Details are saved on a new aircraft, or added to the existing aircraft you choose (only the fields you fill in). Each photo is approved when it has a view and an aircraft or type.")}</p>
            <p><button type="submit" disabled={retired}>{siblings.length ? t("Assign and approve {n} photos", { n: siblings.length + 1 }) : t("Assign and approve")}</button></p>
          </form>

          <div className="card">
            <h3>{t("Classification, order and rights")}</h3>
            <form action={mediaMetadataAction}>
              <Key /><input type="hidden" name="mediaId" value={media.id} /><input type="hidden" name="expectedVersion" value={media.version} />
              <label>{t("View")}</label>
              <Choice name="classification" defaultValue={suggestedClass ?? media.primaryClassification} ariaLabel={t("View")}
                options={CLASSIFICATIONS.map((c) => ({ value: c, label: CLASSIFICATION_LABEL[c] }))} />
              <label>{t("Rights")}</label>
              <Choice name="rightsStatus" defaultValue={media.rightsStatus} ariaLabel={t("Rights")}
                options={[{ value: "permitted", label: "Permitted" }, { value: "restricted", label: "Restricted" }, { value: "unknown", label: "Unknown" }]} />
              <label>{t("Library order")}</label><input name="displayOrder" type="number" inputMode="numeric" min={0} defaultValue={media.displayOrder} style={{ maxWidth: 120 }} />
              {suggestedClass && <p className="small muted">{t("Suggested “{view}” from the file name “{file}”. Click Save to accept it.", { view: t(CLASSIFICATION_LABEL[suggestedClass]), file: evidence?.originalFilename ?? "" })}</p>}
              <p><button type="submit" className="secondary">{t("Save")}</button></p>
            </form>
          </div>

          <details className="card collapse">
            <summary>{t("Advanced: change what this photo shows")} <span className="badge">{media.associationStatus.replace(/_/g, " ")}</span></summary>
            <p className="muted small">{t("Only needed to correct a photo after it was assigned. For an actual aircraft the type comes from the aircraft; the type is only used for a representative photo.")}</p>
            <form action={mediaAssociationAction}>
              <Key /><input type="hidden" name="mediaId" value={media.id} /><input type="hidden" name="expectedVersion" value={media.version} />
              <label>{t("Status")}</label>
              <Choice name="status" defaultValue={media.associationStatus} ariaLabel={t("Status")}
                options={[{ value: "actual_aircraft", label: "This exact aircraft" }, { value: "representative_type", label: "The aircraft type" }, { value: "unresolved", label: "Unresolved" }]} />
              <label>{t("Aircraft (for this exact aircraft)")}</label>
              <SearchSelect name="aircraftId" defaultValue={association?.aircraftId ?? tailMatches[0] ?? ""} emptyLabel="—" placeholder={t("Type a tail or model")}
                options={aircraftOptions.map((o) => ({ value: o.id, label: o.label }))} />
              <label>{t("Aircraft type (for a photo of the type)")}</label>
              <SearchSelect name="aircraftTypeId" defaultValue={association?.aircraftTypeId ?? ""} emptyLabel="—" placeholder={t("Type a model")}
                options={types.map((ty) => ({ value: ty.id, label: `${ty.manufacturer} ${ty.model}` }))} />
              <p><button type="submit" className="secondary">{t("Save association")}</button></p>
            </form>
          </details>

          <div className="card">
            <h3>{t("Decision")}</h3>
            {canDecide && (
              <div className="row">
                <form action={approveAction}>
                  <input type="hidden" name="mediaId" value={media.id} /><input type="hidden" name="contentVersionId" value={current.id} /><input type="hidden" name="expectedVersion" value={media.version} />
                  <button type="submit">{t("Approve")}</button>
                </form>
                <form action={rejectAction} style={{ flex: 3 }}>
                  <Key /><input type="hidden" name="mediaId" value={media.id} /><input type="hidden" name="expectedVersion" value={media.version} />
                  <div className="row"><div><input name="reason" placeholder={t("Reason (optional)")} /></div><div style={{ flex: "0 0 auto" }}><button type="submit" className="danger">{t("Reject")}</button></div></div>
                </form>
              </div>
            )}
            {media.reviewState === "rejected" && (
              <form action={reopenAction}><Key /><input type="hidden" name="mediaId" value={media.id} /><input type="hidden" name="expectedVersion" value={media.version} /><button className="secondary" type="submit">{t("Reopen for review")}</button></form>
            )}
            {media.reviewState === "approved" && !retired && <p className="muted">{t("Approved. Changing the classification, association or crop returns it to review.")}</p>}
            <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "12px 0" }} />
            {retired ? (
              <form action={restoreAction}><Key /><input type="hidden" name="mediaId" value={media.id} /><button className="secondary" type="submit">{t("Restore (retired)")}</button></form>
            ) : (
              <form action={retireAction}><Key /><input type="hidden" name="mediaId" value={media.id} /><button className="secondary" type="submit">{t("Retire (hide from retrieval; history kept)")}</button></form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
