"use client";

import { useEffect, useId, useRef, useState } from "react";

interface Suggestion { value: string; detail: string }

/**
 * Type a city, airport code (HKG / VHHH), Chinese name or region, then pick it from the list. Base pickers take
 * several places (shown as chips); region pickers take one. Text that matches nothing is kept as typed, and the server
 * tidies whatever is saved, so "HK" and "Hong Kong" never become two different places.
 * The value is sent in a hidden field called `name`, places joined with ", ".
 */
export default function PlacePicker({ name, kind, defaultValue, multiple = false, placeholder, ariaLabel }: {
  name: string; kind: "base" | "region"; defaultValue?: string | null; multiple?: boolean; placeholder?: string; ariaLabel?: string;
}) {
  const split = (v: string) => v.split(/[,;]|\r?\n/).map((x) => x.trim()).filter(Boolean);
  const [chosen, setChosen] = useState<string[]>(() => (multiple ? split(defaultValue ?? "") : []));
  const [text, setText] = useState(multiple ? "" : defaultValue ?? "");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = text.trim();
    if (!open || (kind === "base" && !q)) { setItems([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/places?kind=${kind}&q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items: Suggestion[] }) => { setItems(d.items); setActive(0); })
        .catch(() => undefined);
    }, 150);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [text, open, kind]);

  // Close the list when tapping elsewhere.
  useEffect(() => {
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, []);

  const pick = (v: string) => {
    if (multiple) { setChosen((c) => (c.includes(v) ? c : [...c, v])); setText(""); }
    else setText(v);
    setItems([]);
    setOpen(multiple);
  };
  const commitTyped = () => { if (multiple && text.trim()) pick(text.trim()); };
  const value = multiple ? [...chosen, ...(text.trim() ? [text.trim()] : [])].join(", ") : text.trim();

  return (
    <div className="place-picker" ref={box}>
      <input type="hidden" name={name} value={value} />
      {multiple && chosen.length > 0 && (
        <div className="place-chips">
          {chosen.map((c) => (
            <span key={c} className="place-chip">{c}<button type="button" aria-label={`Remove ${c}`} onClick={() => setChosen((x) => x.filter((y) => y !== c))}>×</button></span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={text}
        placeholder={placeholder ?? (kind === "base" ? "City or airport code (e.g. HKG)" : "Region, country or city")}
        aria-label={ariaLabel ?? (kind === "base" ? "Base" : "Region")}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && open && items[active]) { e.preventDefault(); pick(items[active].value); }
          else if (e.key === "Enter" && multiple) { e.preventDefault(); commitTyped(); }
          else if (e.key === "," && multiple) { e.preventDefault(); commitTyped(); }
          // Backspace only edits the typing; a saved place is removed with its × only, so it is never lost by accident.
          else if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => setTimeout(commitTyped, 150)}
      />
      {open && items.length > 0 && (
        <ul className="place-list" id={listId} role="listbox">
          {items.map((s, i) => (
            <li key={s.value + i} role="option" aria-selected={i === active} className={i === active ? "on" : ""}
              onPointerDown={(e) => { e.preventDefault(); pick(s.value); }}>
              <b>{s.value}</b>{s.detail && <span className="muted"> {s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
