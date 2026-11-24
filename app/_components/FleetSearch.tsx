"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { matchesWords, searchWords } from "@/domain/searchMatch";
import Icon from "./Icon";

export interface FleetSuggestion {
  kind: "aircraft" | "operator";
  label: string;
  /** Shown after the label: the operator of an aircraft, or how many aircraft an operator has. */
  sub?: string;
  /** Everything the item can be found by (names, other names, tail, type). */
  keys: string;
  href: string;
  library?: boolean;
}

type In = "all" | "aircraft" | "operator";
const SCOPES: { id: In; label: string }[] = [{ id: "all", label: "All" }, { id: "aircraft", label: "Aircraft" }, { id: "operator", label: "Operator" }];

/**
 * The Fleet page's search: choose Aircraft or Operator to narrow it, and matches are listed while you type.
 * Tap one to open it; press Enter (or Apply) to filter the page instead. Sent as `q` and `in` with the filter form.
 */
export default function FleetSearch({ defaultQ, defaultIn, items, form }: { defaultQ: string; defaultIn: In; items: FleetSuggestion[]; /** The filter form's id, when the search sits outside it. */ form?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(defaultQ);
  const [scope, setScope] = useState<In>(defaultIn);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const matches = useMemo(() => {
    const words = searchWords(q);
    if (!words.length) return [];
    const hit = items.filter((i) => (scope === "all" || i.kind === scope) && matchesWords(i.keys, words));
    // Your own first, operators before aircraft when both are asked for.
    return hit.sort((a, b) => Number(!!a.library) - Number(!!b.library) || (scope === "all" ? Number(a.kind === "aircraft") - Number(b.kind === "aircraft") : 0)).slice(0, 12);
  }, [items, q, scope]);

  useEffect(() => {
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, []);

  const go = (s: FleetSuggestion) => { setOpen(false); router.push(s.href); };
  const submit = () => { setOpen(false); input.current?.form?.requestSubmit(); };

  return (
    <div className="fleet-search" ref={box}>
      <input type="hidden" form={form} name="in" value={scope === "all" ? "" : scope} />
      <div className="scope-switch" role="radiogroup" aria-label="Search in">
        {SCOPES.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={scope === s.id} className={scope === s.id ? "on" : ""}
            onClick={() => { setScope(s.id); setOpen(!!q.trim()); input.current?.focus(); }}>
            {s.id === "aircraft" && <Icon name="plane" />}{s.id === "operator" && <Icon name="operator" />}{s.label}
          </button>
        ))}
      </div>
      <div className="place-picker">
        <input
          ref={input}
          form={form}
          name="q"
          aria-label="Search"
          type="search"
          value={q}
          enterKeyHint="search"
          placeholder={scope === "aircraft" ? "Type, tail or operator" : scope === "operator" ? "Operator name" : "Operator, tail or aircraft"}
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls={listId}
          autoComplete="off"
          onFocus={() => setOpen(!!q.trim())}
          onChange={(e) => { setQ(e.target.value); setOpen(!!e.target.value.trim()); setActive(-1); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
            else if (e.key === "Enter") { e.preventDefault(); if (open && matches[active]) go(matches[active]); else submit(); }
            else if (e.key === "Escape") setOpen(false);
          }}
        />
        {open && q.trim() && (
          <ul className="place-list" id={listId} role="listbox">
            {matches.length === 0 && <li className="muted">Nothing matches “{q.trim()}”{scope !== "all" ? ` in ${scope === "aircraft" ? "aircraft" : "operators"}` : ""}.</li>}
            {matches.map((m, i) => (
              <li key={`${m.kind}:${m.href}:${m.label}`} role="option" aria-selected={i === active} className={i === active ? "on" : ""}
                onMouseDown={(e) => e.preventDefault()} onClick={() => go(m)}>
                <div className="sug-name"><Icon name={m.kind === "aircraft" ? "plane" : "operator"} /> <b>{m.label}</b></div>
                {(m.sub || m.library) && (
                  <div className="sug-sub">{m.library && <span className="tag">Library</span>}{m.sub && <span className="muted">{m.sub}</span>}</div>
                )}
              </li>
            ))}
            {matches.length > 0 && (
              <li className="muted" onMouseDown={(e) => e.preventDefault()} onClick={() => submit()}>
                <Icon name="search" /> Show every match for “{q.trim()}” on this page
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
