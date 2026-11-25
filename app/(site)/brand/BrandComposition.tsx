"use client";
import { useState } from "react";
import Toy from "../../_components/Toy";
import BrandSignature from "../../_components/BrandSignature";

/**
 * The centred brand composition (TOY-14), drawn with the master Toy. Scene and underline geometry are the locked values
 * from the rulebook; everything scales together with the width. Play/Reset replay the signature takeoff on request.
 */
export default function BrandComposition() {
  const [run, setRun] = useState({ n: 0, takeoff: false });
  return (
    <div className="brand-comp">
      <div className="brand-scene">
        <svg viewBox="0 0 340 175" aria-hidden="true" focusable="false">
          {/* Dotted flight path, shadow, solid ground and dashed runway: locked geometry (TOY-14). */}
          <path d="M5 130 C70 155 95 55 160 90 S270 85 325 20" stroke="#ADC5B8" strokeWidth="2.5" strokeDasharray="1 6" strokeLinecap="round" fill="none" />
          <ellipse cx="170" cy="148" rx="32" ry="4" fill="#E3DFD4" />
          <path d="M90 160 H250" stroke="#D8D8CE" strokeWidth="1.5" />
          <path d="M95 168 H245" stroke="#D8D8CE" strokeWidth="2" strokeDasharray="16 10" />
        </svg>
        {/* The master Toy in flight, its block centred at x170 (block = 100 scene units wide, as in the reference). */}
        <div className="brand-scene-toy"><Toy state="working" size={125} /></div>
      </div>

      <BrandSignature
        key={run.n}
        as="h1"
        className="brand-comp-statement"
        lead={<>Everything<br />begins as a </>}
        tail="Toy"
        plain="Everything begins as a Toy."
        takeoff={run.takeoff}
      />

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="brand-comp-underline" src="/brand/brand-underline.svg" alt="" />
      <p className="brand-comp-vision">Small beginning.<br />Useful and reliable product.<br />Bigger possibilities.</p>
      <p className="brand-comp-wordmark">aircraftmedia.my</p>

      <div className="brand-comp-controls">
        <button type="button" className="site-btn site-btn-ink" onClick={() => setRun((r) => ({ n: r.n + 1, takeoff: true }))}>Play takeoff</button>
        <button type="button" className="site-btn" onClick={() => setRun((r) => ({ n: r.n + 1, takeoff: false }))}>Reset</button>
      </div>
    </div>
  );
}
