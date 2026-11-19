"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Classification } from "@/domain/constants";
import { assignGroupAction } from "../actions";
import AircraftPicker, { type PickerAircraft, type PickerOperator, type PickerTypeGroup } from "./AircraftPicker";
import { SetRest, ViewChoice } from "./ViewChoice";
import Choice, { WIFI_CHOICES } from "./Choice";

export interface SheetPhoto { mediaId: string; src: string | null; filename: string | null; classification: Classification; autoReason: string | null }
export interface SheetGroup {
  key: string;
  receivedAt: string;
  label: string | null;
  photos: SheetPhoto[];
  cardText: string | null;
  notes: { text: string; warn: boolean }[];
  defaults: {
    operator: string; newOperatorName: string; aircraft: string; type: string;
    tail: string; yom: string; yor: string; capacity: string; wifi: string; notes: string; baseMode: string; baseLocations: string;
  };
}

/**
 * The Review worksheet: every set of waiting photos on one page, each with its own operator, aircraft, details and
 * views, saved one at a time without leaving the page. Saved sets drop off; anything not approved stays with a reason.
 */
export default function ReviewSheet({
  groups, operators, aircraft, typeGroups, readOnly,
}: {
  groups: SheetGroup[];
  operators: PickerOperator[];
  aircraft: PickerAircraft[];
  typeGroups: PickerTypeGroup[];
  readOnly: boolean;
}) {
  const [saved, setSaved] = useState<{ key: string; message: string }[]>([]);
  return (
    <>
      {saved.length > 0 && (
        <div className="card saved-list" aria-live="polite">
          <h3>Saved on this page ({saved.length})</h3>
          <ul className="small">{saved.map((s) => <li key={s.key}>{s.message}</li>)}</ul>
        </div>
      )}
      {groups.map((g) => (
        <GroupCard key={g.key} g={g} operators={operators} aircraft={aircraft} typeGroups={typeGroups} readOnly={readOnly}
          onSaved={(message) => setSaved((s) => [{ key: `${g.key}:${s.length}`, message }, ...s])} />
      ))}
    </>
  );
}

function GroupCard({
  g, operators, aircraft, typeGroups, readOnly, onSaved,
}: {
  g: SheetGroup; operators: PickerOperator[]; aircraft: PickerAircraft[]; typeGroups: PickerTypeGroup[]; readOnly: boolean;
  onSaved: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const group = `g-${g.key}`;
  const d = g.defaults;
  const n = g.photos.length;

  return (
    <form
      className="card sheet-group"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("key", crypto.randomUUID()); // a fresh key per save, so a corrected retry is a new request
        start(async () => {
          const r = await assignGroupAction(fd);
          setResult(r);
          if (r.approvedIds.length) {
            onSaved(r.message);
            router.refresh(); // saved photos leave the list; new operators and aircraft appear in the other sets
          }
        });
      }}
    >
      <div className="sheet-head">
        <h3>{g.label ?? `${n} photo${n === 1 ? "" : "s"}`} <span className="muted small">{g.label ? `${n} photo${n === 1 ? "" : "s"} · ` : ""}received {g.receivedAt}</span></h3>
        <Link className="small" href={`/review/${g.photos[0].mediaId}`}>Open full page (crop, reject)</Link>
      </div>
      {g.cardText && <pre className="cardtext small">{g.cardText}</pre>}
      {g.notes.map((x, i) => <p key={i} className="small" style={{ margin: "2px 0", color: x.warn ? "var(--warn)" : undefined }}>{x.text}</p>)}
      <div className="sheet-body">
        <fieldset className="siblings views">
          <legend>Views</legend>
          {g.photos.map((p) => (
            <div key={p.mediaId} className="sibling">
              <input type="checkbox" name="also" value={p.mediaId} defaultChecked aria-label={`Include ${p.filename ?? "photo"}`} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.src ? <a href={p.src} target="_blank" rel="noreferrer"><img src={p.src} alt="" /></a> : <span />}
              <span className="small sib-name">{p.filename ?? "Photo"}{p.autoReason ? <span className="muted"> · {p.autoReason}</span> : null}</span>
              <ViewChoice name={`cls_${p.mediaId}`} value={p.classification} label={`View of ${p.filename ?? "photo"}`} group={group} />
            </div>
          ))}
          {n > 1 && <p style={{ margin: "6px 0 0" }}><SetRest group={group} to="cabin" label="Set the rest to Cabin" /></p>}
        </fieldset>
        <div className="sheet-fields">
          <AircraftPicker idPrefix={group} operators={operators} aircraft={aircraft} typeGroups={typeGroups} newOperatorName={d.newOperatorName}
            defaults={{ operator: d.operator, aircraft: d.aircraft, type: d.type }} />
          <label htmlFor={`${group}-tail`}>Tail number</label><input id={`${group}-tail`} name="tail" defaultValue={d.tail} placeholder="Optional" />
          <label>WIFI</label>
          <Choice name="wifiStatus" defaultValue={d.wifi} options={WIFI_CHOICES} ariaLabel="WIFI" />
          <div className="row">
            <div><label htmlFor={`${group}-yom`}>YOM</label><input id={`${group}-yom`} name="yom" type="number" inputMode="numeric" defaultValue={d.yom} /></div>
            <div><label htmlFor={`${group}-yor`}>YOR</label><input id={`${group}-yor`} name="yor" type="number" inputMode="numeric" defaultValue={d.yor} /></div>
            <div><label htmlFor={`${group}-cap`}>Seats</label><input id={`${group}-cap`} name="capacity" type="number" inputMode="numeric" defaultValue={d.capacity} /></div>
          </div>
          <label htmlFor={`${group}-notes`}>Notes</label><input id={`${group}-notes`} name="notes" defaultValue={d.notes} />
          <input type="hidden" name="baseMode" value={d.baseMode} /><input type="hidden" name="baseLocations" value={d.baseLocations} />
        </div>
      </div>
      {result && <div className={`flash ${result.ok ? "ok" : "err"}`} role="status">{result.message}</div>}
      <div className="sheet-save">
        <button type="submit" disabled={pending || readOnly}>{pending ? "Saving…" : `Save and approve${n > 1 ? ` ${n} photos` : ""}`}</button>
      </div>
    </form>
  );
}
