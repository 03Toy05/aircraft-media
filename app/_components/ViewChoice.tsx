"use client";

import type { Classification } from "@/domain/constants";

const VIEWS: { value: Classification; label: string }[] = [
  { value: "exterior", label: "Exterior" },
  { value: "interior", label: "Interior" },
  { value: "floor_plan", label: "Floor plan" },
];

/** Three big buttons for a photo's view (radio buttons underneath, so the form works as usual). */
export function ViewChoice({ name, value, label, group }: { name: string; value: Classification; label: string; group?: string }) {
  return (
    <span className="view-choice" role="radiogroup" aria-label={label} data-group={group}>
      {VIEWS.map((v) => (
        <label key={v.value} className="view-btn">
          <input type="radio" name={name} value={v.value} defaultChecked={value === v.value} />
          <span>{v.label}</span>
        </label>
      ))}
    </span>
  );
}

/** Sets every photo in the group that has no view yet to the chosen one (usually the rest are interior). */
export function SetRest({ group, to, label }: { group: string; to: Classification; label: string }) {
  return (
    <button
      type="button"
      className="secondary small-btn"
      onClick={(e) => {
        const form = (e.currentTarget as HTMLButtonElement).form;
        form?.querySelectorAll<HTMLElement>(`.view-choice[data-group="${group}"]`).forEach((g) => {
          if (!g.querySelector("input:checked")) g.querySelector<HTMLInputElement>(`input[value="${to}"]`)!.checked = true;
        });
      }}
    >
      {label}
    </button>
  );
}
