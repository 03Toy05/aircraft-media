"use client";

import { useState } from "react";

export interface PickerOperator { id: string; name: string }
export interface PickerAircraft { id: string; label: string; aircraftTypeId: string; typeLabel: string; operatorId: string | null }
export interface PickerTypeGroup { key: string; label: string; items: { id: string; label: string }[] }

/**
 * Operator, aircraft and aircraft type for the Assign form. Picking an existing aircraft fills in its type at once
 * (an aircraft has one type, so it is not asked again) and its operator when none is chosen yet.
 * The type is only asked for a new aircraft, or for a photo that represents a type.
 */
export default function AircraftPicker({
  operators, aircraft, typeGroups, newOperatorName, defaults,
}: {
  operators: PickerOperator[];
  aircraft: PickerAircraft[];
  typeGroups: PickerTypeGroup[];
  newOperatorName: string;
  defaults: { operator: string; aircraft: string; type: string };
}) {
  const [operator, setOperator] = useState(defaults.operator);
  const [ac, setAc] = useState(defaults.aircraft);
  const [type, setType] = useState(defaults.type);
  const chosen = aircraft.find((a) => a.id === ac) ?? null;

  const pickAircraft = (id: string) => {
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
      <label htmlFor="pick-operator">Operator</label>
      <select id="pick-operator" name="operator" value={operator} onChange={(e) => setOperator(e.target.value)}>
        <option value="">No operator</option>
        {newOperatorName && <option value="new">Create new operator: {newOperatorName}</option>}
        {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <input type="hidden" name="newOperatorName" value={newOperatorName} />
      <label htmlFor="pick-aircraft">Aircraft</label>
      <select id="pick-aircraft" name="aircraft" value={ac} onChange={(e) => pickAircraft(e.target.value)}>
        <option value="new">Create a new aircraft</option>
        {sorted.map((a) => <option key={a.id} value={a.id}>Use existing: {a.label}</option>)}
        <option value="none">No aircraft (photo represents the aircraft type)</option>
      </select>
      <label htmlFor="pick-type">Aircraft type</label>
      {chosen ? (
        <>
          <input type="hidden" name="aircraftTypeId" value={chosen.aircraftTypeId} />
          <p id="pick-type" className="type-fixed">{chosen.typeLabel} <span className="muted small">(this aircraft&apos;s type)</span></p>
        </>
      ) : (
        <select id="pick-type" name="aircraftTypeId" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Not chosen</option>
          {typeGroups.map((g) => (
            <optgroup key={g.key} label={g.label}>{g.items.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>
          ))}
        </select>
      )}
    </>
  );
}
