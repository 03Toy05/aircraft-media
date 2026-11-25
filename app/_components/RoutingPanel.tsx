"use client";

import { useEffect, useId, useRef, useState } from "react";
import { airportCode, legTimes, type AirportInfo, type Airports, type Leg } from "@/domain/routing";
import { hhmm, parseDuration } from "@/domain/flightTime";
import { offsetLabel, utcFromLocal } from "@/domain/zoneTime";

export const emptyLeg = (from = "", pax: number | null = null): Leg => ({ from, to: "", date: null, time: null, flight: null, flightEst: false, pax });

/**
 * The client's routing at the top of the quote: per leg the airports (ICAO, IATA or city), date, local departure time,
 * flight time (estimated from the chosen aircraft until typed) and passengers, with the arrival and UTC times worked out.
 * Once a version is saved the airports and dates are fixed (another routing is another request).
 */
export default function RoutingPanel({ legs, airports, onChange, onAirport, locked, estimateFrom, onNewRequest }: {
  legs: Leg[]; airports: Airports; onChange: (legs: Leg[]) => void; onAirport: (a: AirportInfo) => void;
  locked: boolean; estimateFrom: string | null; onNewRequest?: () => void;
}) {
  const set = (i: number, patch: Partial<Leg>) => onChange(legs.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const last = legs[legs.length - 1];
  return (
    <div className="routing">
      {legs.map((l, i) => {
        const t = legTimes(l, airports);
        const a = airports[l.from], b = airports[l.to];
        const zone = (code: string, info: AirportInfo | undefined) => info && l.date && l.time ? offsetLabel(utcFromLocal(l.date, l.time, info.tz), info.tz) : null;
        return (
          <div key={i} className="leg">
            <div className="leg-head small"><b>Leg {i + 1}</b>
              {!locked && legs.length > 1 && <button type="button" className="linkish" onClick={() => onChange(legs.filter((_, j) => j !== i))} aria-label={`Remove leg ${i + 1}`}>Remove</button>}
            </div>
            <div className="leg-grid">
              {locked ? (
                <>
                  <div className="small leg-place"><span className="muted">From</span><br /><b>{a ? `${a.city || a.name} (${airportCode(l.from, airports)})` : l.from}</b></div>
                  <div className="small leg-place"><span className="muted">To</span><br /><b>{b ? `${b.city || b.name} (${airportCode(l.to, airports)})` : l.to}</b></div>
                  <div className="small"><span className="muted">Date</span><br /><b>{l.date ?? "–"}</b></div>
                </>
              ) : (
                <>
                  <AirportField label="From" code={l.from} airports={airports} onPick={(x) => { onAirport(x); set(i, { from: x.icao }); }} onClear={() => set(i, { from: "" })} />
                  <AirportField label="To" code={l.to} airports={airports} onPick={(x) => { onAirport(x); set(i, { to: x.icao }); }} onClear={() => set(i, { to: "" })} />
                  <label className="small">Date<input type="date" value={l.date ?? ""} onChange={(e) => set(i, { date: e.target.value || null })} /></label>
                </>
              )}
              <label className="small">Departs (local)<input type="time" value={l.time ?? ""} onChange={(e) => set(i, { time: e.target.value || null })} /></label>
              <FlightField minutes={l.flight ?? null} est={!!l.flightEst} estimateFrom={estimateFrom} onChange={(m) => set(i, { flight: m, flightEst: false })} />
              <label className="small">Passengers<input type="number" inputMode="numeric" min={1} max={500} value={l.pax ?? ""} onChange={(e) => set(i, { pax: e.target.value === "" ? null : Number(e.target.value) })} /></label>
            </div>
            {(t.depUtc || t.arrLocal) && (
              <p className="small muted leg-times">
                {t.arrLocal && <>Arrives <b>{t.arrLocal.time}</b> local{t.arrDays ? ` (${t.arrDays > 0 ? "+" : ""}${t.arrDays} day)` : ""} on {t.arrLocal.date} · </>}
                {t.depUtc && <>UTC: departs {t.depUtc.time}{t.arrUtc ? `, arrives ${t.arrUtc.time}` : ""}</>}
                {zone(l.from, a) && <> · {airportCode(l.from, airports)} {zone(l.from, a)}{b ? ` → ${airportCode(l.to, airports)} ${zone(l.to, b)}` : ""}</>}
              </p>
            )}
          </div>
        );
      })}
      {!locked ? (
        <div className="row" style={{ gap: 6 }}>
          <div style={{ flex: "0 0 auto" }}><button type="button" className="secondary small-btn" onClick={() => onChange([...legs, emptyLeg(last?.to ?? "", last?.pax ?? null)])}>+ Add leg</button></div>
          <div style={{ flex: "0 0 auto" }}><button type="button" className="secondary small-btn" disabled={!legs[0]?.from || !last?.to}
            onClick={() => onChange([...legs, { ...emptyLeg(last.to, last.pax ?? null), to: legs[0].from, flight: last.flight ?? null, flightEst: !!last.flightEst }])}>+ Add return</button></div>
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Airports and dates are fixed for this request; times, flight times and passengers can change.
          {onNewRequest && <> Different airports or dates? <button type="button" className="linkish" onClick={onNewRequest}>Make it a new request</button>.</>}
        </p>
      )}
    </div>
  );
}

/** Flight time as h:mm. Shows the estimate (≈) until the broker types the operator's figure. */
function FlightField({ minutes, est, estimateFrom, onChange }: { minutes: number | null; est: boolean; estimateFrom: string | null; onChange: (m: number | null) => void }) {
  const [text, setText] = useState(minutes != null ? hhmm(minutes) : "");
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(minutes != null ? hhmm(minutes) : ""); setBad(false); }, [minutes]);
  return (
    <label className="small">Flight time{est && <span className="muted" title={estimateFrom ? `Estimated for the ${estimateFrom}; type the operator's figure to replace it` : "Estimated"}> ≈ est.</span>}
      <input type="text" inputMode="numeric" placeholder="h:mm" value={text} aria-invalid={bad || undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { const m = parseDuration(text); if (text.trim() && m == null) { setBad(true); return; } setBad(false); if (m !== minutes) onChange(m); }} />
    </label>
  );
}

/** An airport by ICAO, IATA, city or name; picking one stores its ICAO code. */
function AirportField({ label, code, airports, onPick, onClear }: { label: string; code: string; airports: Airports; onPick: (a: AirportInfo) => void; onClear: () => void }) {
  const known = code ? airports[code] : undefined;
  const shown = known ? `${known.iata || known.icao} · ${known.city || known.name}` : code;
  const [text, setText] = useState(shown);
  const [items, setItems] = useState<AirportInfo[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => { setText(shown); }, [shown]);
  useEffect(() => {
    const q = text.trim();
    if (!open || q.length < 2 || q === shown) { setItems([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/airports?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((j: { items: AirportInfo[] }) => setItems(j.items))
        .catch(() => {});
    }, 150);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [text, open, shown]);
  useEffect(() => {
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, []);
  const pick = (a: AirportInfo) => { onPick(a); setOpen(false); };
  return (
    <div className="place-picker" ref={box}>
      <label className="small" htmlFor={id}>{label}</label>
      <input id={id} type="text" value={text} autoComplete="off" placeholder="ICAO, IATA or city" aria-label={label}
        onFocus={(e) => { setOpen(true); e.currentTarget.select(); }}
        onChange={(e) => { setText(e.target.value); setOpen(true); if (!e.target.value.trim()) onClear(); }}
        onKeyDown={(e) => {
          // Enter takes the exact code typed (VHHH / HKG), or the first suggestion.
          if (e.key === "Enter" && items.length) {
            e.preventDefault();
            const up = text.trim().toUpperCase();
            pick(items.find((a) => a.icao === up || a.iata === up) ?? items[0]);
          }
        }}
        onBlur={() => {
          const up = text.trim().toUpperCase();
          const exact = items.find((a) => a.icao === up || a.iata === up);
          if (exact) pick(exact);
          else if (!open) setText(shown);
        }} />
      {open && items.length > 0 && (
        <ul className="place-list" role="listbox">
          {items.map((a) => (
            <li key={a.icao} role="option" aria-selected={a.icao === code} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(a)}>
              <b>{a.iata ? `${a.iata} / ${a.icao}` : a.icao}</b> <span className="muted">{a.name}{a.city && !a.name.includes(a.city) ? `, ${a.city}` : ""} · {a.cc}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
