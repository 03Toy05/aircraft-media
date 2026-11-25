import Tr from "./Tr";

/**
 * A short list (up to about five answers) as a row of buttons instead of a dropdown: one tap, no picker sheet on the
 * phone, and the choice is visible at a glance. Radio buttons underneath, so it works in any form, with or without
 * JavaScript. The `name` field is sent with the chosen value.
 */
export default function Choice({ name, options, defaultValue, ariaLabel, required }: {
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string | null;
  ariaLabel?: string;
  required?: boolean;
}) {
  return (
    <span className="view-choice choice" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <label key={o.value} className="view-btn">
          <input type="radio" name={name} value={o.value} defaultChecked={(defaultValue ?? "") === o.value} required={required} />
          <span><Tr text={o.label} /></span>
        </label>
      ))}
    </span>
  );
}

export const YES_NO_CHOICES = [
  { value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unknown", label: "Unknown" },
] as const;

export const WIFI_CHOICES = [
  { value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "tbc", label: "TBC" }, { value: "unknown", label: "Unknown" },
] as const;
