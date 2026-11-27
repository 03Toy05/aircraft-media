"use client";
import { useEffect, useState } from "react";
import Toy from "../_components/Toy";
import type { TrySample } from "./siteMedia";
import { track } from "./track";

/** The hero's "Watch me at work" button: opens the phone's player with the short demo, if there is one (PhoneDemo listens for "toy:watch-demo"). */
export function WatchDemoButton({ label, sub }: { label: string; sub: string }) {
  return (
    <button type="button" className="hero-watch" onClick={() => window.dispatchEvent(new CustomEvent("toy:watch-demo", { detail: "short" }))}>
      <span className="hero-watch-icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 1.5 L12 7 L3 12.5 Z" fill="currentColor" /></svg>
      </span>
      <span><b>{label}</b><br /><span className="hero-watch-sub">{sub}</span></span>
    </button>
  );
}

type TryCopy = { headline: string; intro: string; chips: string[]; found: string; interior: string; rooms: string[]; quoteDone: string; quote: string; quoteWays: string; sample: string; soon: string; clientLink: string };

/**
 * "Let me try": three taps on sample data, answered at once (no fake waiting, TOY-04), with no real workspace behind it.
 * With a real sample (public/try-sample/, local preview only) it shows that aircraft and its photos; without one, placeholders.
 */
export function LetMeTry({ copy, lang, sample = null }: { copy: TryCopy; lang: string; sample?: TrySample | null }) {
  const chips = sample ? [sample.ask, ...copy.chips.slice(1)] : copy.chips;
  const [asked, setAsked] = useState<number[]>([]);
  const ask = (i: number) => setAsked((a) => [...a.filter((x) => x !== i), i]);
  // Counted once the visitor has tried all three.
  useEffect(() => { if (asked.length === 3) track("letmetry_complete", lang); }, [asked.length, lang]);
  return (
    <div className="try">
      <h2>{copy.headline}</h2>
      <p className="try-intro">{copy.intro}</p>
      <div className="try-chips">
        {chips.map((c, i) => (
          <button key={c} type="button" className="try-chip" onClick={() => ask(i)} aria-pressed={asked.includes(i)}>{c}</button>
        ))}
      </div>
      <div className="try-chat" aria-live="polite">
        {asked.map((i) => (
          <div key={i} className="try-turn">
            <p className="try-you">{chips[i]}</p>
            <div className="try-toy">
              <Toy state="completed" size={28} />
              <div className="try-answer">
                {i === 0 && <p>{sample?.found ?? copy.found}</p>}
                {i === 1 && (
                  <>
                    <p>{sample?.interior ?? copy.interior}</p>
                    <div className="try-photos">
                      {sample && sample.photos.length > 0
                        ? sample.photos.map((p) => (
                          <figure key={p.src} className="try-photo has-img">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.src} alt={p.label} loading="lazy" />
                            <figcaption>{p.label}</figcaption>
                          </figure>
                        ))
                        : copy.rooms.map((r) => <span key={r} className="try-photo">{r}</span>)}
                    </div>
                  </>
                )}
                {i === 2 && (
                  <>
                    <p>{copy.quoteDone}</p>
                    <pre className="try-quote">{sample?.quote ?? copy.quote}</pre>
                    <p className="try-ways">{copy.quoteWays}</p>
                    {/* The real thing: the client page a broker shares (a demo workspace's link), not a mock-up. */}
                    {sample?.clientLink && (
                      <a className="try-client" href={sample.clientLink} target="_blank" rel="noopener">{copy.clientLink} →</a>
                    )}
                  </>
                )}
                <span className="try-sample">{copy.sample}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type CalcCopy = { title: string; perDay: string; minutes: string; days: string; monthly: string; equiv: string; hours: string; workdays: string; note: string; closing: string };

/** "How much time could Toy give you back?": the visitor's own numbers, worked out in the browser; nothing is sent or saved. */
export function TimeCalculator({ copy }: { copy: CalcCopy }) {
  const [perDay, setPerDay] = useState(5);
  const [minutes, setMinutes] = useState(10);
  const [days, setDays] = useState(22);
  const num = (v: string, max: number) => Math.max(0, Math.min(max, Number(v) || 0));
  const hours = (perDay * minutes * days) / 60;
  const workdays = hours / 8;
  const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString();
  return (
    <section className="calc" aria-label={copy.title}>
      <h2>{copy.title}</h2>
      <div className="calc-inputs">
        <label>{copy.perDay}<input type="number" inputMode="numeric" min={0} max={100} value={perDay} onChange={(e) => setPerDay(num(e.target.value, 100))} /></label>
        <label>{copy.minutes}<input type="number" inputMode="numeric" min={0} max={120} value={minutes} onChange={(e) => setMinutes(num(e.target.value, 120))} /></label>
        <label>{copy.days}<input type="number" inputMode="numeric" min={0} max={31} value={days} onChange={(e) => setDays(num(e.target.value, 31))} /></label>
      </div>
      <div className="calc-result" aria-live="polite">
        <p><span>{copy.monthly}</span><b>{fmt(hours)} {copy.hours}</b></p>
        <p><span>{copy.equiv}</span><b>{fmt(workdays)} {copy.workdays}</b></p>
      </div>
      <p className="calc-note">{copy.note}</p>
      <p className="calc-closing">{copy.closing}</p>
    </section>
  );
}
