"use client";

import { useEffect, useRef, useState } from "react";

export interface PickerOperator { id: string; name: string }
export interface PickerAircraft { id: string; label: string; aircraftTypeId: string; typeLabel: string; operatorId: string | null }
export interface PickerTypeGroup { key: string; label: string; items: { id: string; label: string }[] }

/**
 * Operator, aircraft and aircraft type for the Assign form. Picking an existing aircraft fills in its type at once
 * (an aircraft has one type, so it is not asked again) and its operator when none is chosen yet.
 * The type is only asked for a new aircraft, or for a photo that represents a type.
 */
export default function AircraftPicker({
  operators, aircraft, typeGroups, newOperatorName, defaults, idPrefix = "pick",
}: {
  operators: PickerOperator[];
  aircraft: PickerAircraft[];
  typeGroups: PickerTypeGroup[];
  newOperatorName: string;
  defaults: { operator: string; aircraft: string; type: string };
  /** Keeps element ids unique when several pickers share a page. */
  idPrefix?: string;
}) {
  const [operator, setOperator] = useState(defaults.operator);
  const [ac, setAc] = useState(defaults.aircraft);
  const [type, setType] = useState(defaults.type);
  // When the page refreshes after another group was saved (e.g. that save created this operator), follow the new
  // suggestions for anything the broker hasn't changed by hand.
  const touched = useRef({ operator: false, aircraft: false, type: false });
  useEffect(() => {
    if (!touched.current.operator) setOperator(defaults.operator);
    if (!touched.current.aircraft) setAc(defaults.aircraft);
    if (!touched.current.type) setType(defaults.type);
  }, [defaults.operator, defaults.aircraft, defaults.type]);
  const chosen = aircraft.find((a) => a.id === ac) ?? null;
  const id = (s: string) => `${idPrefix}-${s}`;

  const pickAircraft = (id: string) => {
    touched.current.aircraft = true;
    setAc(id);
    const a = aircraft.find((x) => x.id === id);
    if (a) {
      setType(a.aircraftTypeId);
      if (!operator && a.operatorId) setOperator(a.operatorId);
    }
  };
  // The operator's aircraft first, so the right one is quick to find.
  const sorted = operator && operator !== "new" ? [...aircraft].sort((x, y) => Number(y.operatorId === operator) - Number(x.operatorId === operator)) : aircraft;

  return (
    <>
      <label htmlFor={id("operator")}>Operator</label>
      <select id={id("operator")} name="operator" value={operator} onChange={(e) => { touched.current.operator = true; setOperator(e.target.value); }}>
        <option value="">No operator</option>
        {newOperatorName && <option value="new">Create new operator: {newOperatorName}</option>}
        {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <input type="hidden" name="newOperatorName" value={newOperatorName} />
      <label htmlFor={id("aircraft")}>Aircraft</label>
      <select id={id("aircraft")} name="aircraft" value={ac} onChange={(e) => pickAircraft(e.target.value)}>
        <option value="new">Create a new aircraft</option>
        {sorted.map((a) => <option key={a.id} value={a.id}>Use existing: {a.label}</option>)}
        <option value="none">No aircraft (photo represents the aircraft type)</option>
      </select>
      <label htmlFor={id("type")}>Aircraft type</label>
      {chosen ? (
        <>
          <input type="hidden" name="aircraftTypeId" value={chosen.aircraftTypeId} />
          <p id={id("type")} className="type-fixed">{chosen.typeLabel} <span className="muted small">(this aircraft&apos;s type)</span></p>
        </>
      ) : (
        <select id={id("type")} name="aircraftTypeId" value={type} onChange={(e) => { touched.current.type = true; setType(e.target.value); }}>
          <option value="">Not chosen</option>
          {typeGroups.map((g) => (
            <optgroup key={g.key} label={g.label}>{g.items.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>
          ))}
        </select>
      )}
    </>
  );
}
