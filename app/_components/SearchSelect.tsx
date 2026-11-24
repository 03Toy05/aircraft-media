"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface SearchOption { value: string; label: string; group?: string; hint?: string }

/**
 * A long list (aircraft types, operators) as a search box: type a few letters, tap the match. Replaces dropdowns
 * whose phone picker is long and hard to read. The chosen value is sent in a hidden field called `name`.
 * `emptyLabel` adds a "nothing chosen" answer at the top (for optional fields).
 */
export default function SearchSelect({ name, options, defaultValue, value: controlled, onChange, placeholder, emptyLabel, required, ariaLabel, id }: {
  name?: string;
  options: SearchOption[];
  defaultValue?: string | null;
  /** Controlled use: the page holds the value and hears every change. */
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  required?: boolean;
  ariaLabel?: string;
  id?: string;
}) {
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const [inner, setInner] = useState(defaultValue ?? "");
  const value = controlled ?? inner;
  const setValue = (v: string) => { setInner(v); onChange?.(v); };
  const [text, setText] = useState(byValue.get(value)?.label ?? (value === "" ? "" : value));
  // When the page changes the value (or the list changes), show its name.
  useEffect(() => { setText(byValue.get(value)?.label ?? ""); }, [value, byValue]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const hidden = useRef<HTMLInputElement>(null);

  const q = text.trim().toLowerCase();
  const typing = q !== (byValue.get(value)?.label ?? "").toLowerCase();
  const matches = useMemo(() => {
    const words = typing ? q.split(/\s+/).filter(Boolean) : [];
    const hay = (o: SearchOption) => `${o.label} ${o.group ?? ""} ${o.hint ?? ""}`.toLowerCase();
    return options.filter((o) => words.every((w) => hay(o).includes(w))).slice(0, 60);
  }, [options, q, typing]);
  const list = [...(emptyLabel && !typing ? [{ value: "", label: emptyLabel } as SearchOption] : []), ...matches];

  useEffect(() => {
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setText(byValue.get(value)?.label ?? ""); } };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [byValue, value]);

  const pick = (o: SearchOption) => { setValue(o.value); setText(o.value ? o.label : ""); setOpen(false); };

  return (
    <div className="place-picker search-select" ref={box}>
      {name && <input ref={hidden} type="hidden" name={name} value={value} />}
      <input
        id={id}
        type="text"
        value={text}
        placeholder={placeholder ?? (emptyLabel ? emptyLabel : "Type to search…")}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        required={required && !value}
        onFocus={(e) => { setOpen(true); e.currentTarget.select(); }}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, list.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && open && list[active]) { e.preventDefault(); pick(list[active]); }
          else if (e.key === "Escape") { setOpen(false); setText(byValue.get(value)?.label ?? ""); }
        }}
      />
      {open && (
        <ul className="place-list" id={listId} role="listbox">
          {list.length === 0 && <li className="muted">No match</li>}
          {list.map((o, i) => {
            const head = o.group && o.group !== list[i - 1]?.group ? o.group : null;
            return (
              <li key={o.value || "__empty"} role="option" aria-selected={o.value === value} className={i === active ? "on" : ""}
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}>
                {head && <span className="group-head">{head}</span>}
                {o.value === value && o.value ? "✓ " : ""}{o.label}{o.hint && <span className="muted"> {o.hint}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
