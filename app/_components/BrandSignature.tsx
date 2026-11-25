"use client";
import { useEffect, useRef } from "react";
import "./brand-signature.css";

const NS = "http://www.w3.org/2000/svg";
/** The tiny gold airplane, nose up (TOY-14); the resting punctuation is the same shape tilted 40° in /brand/airplane.svg. */
const PLANE = "M-1.8 -11 H1.8 L2.8 -3 L11 3 V6 L2.8 3 L2 9 L5 12 V14 L0 12 L-5 14 V12 L-2 9 L-2.8 3 L-11 6 V3 L-2.8 -3 Z";
const DURATION_MS = 2600;

/**
 * The brand signature (TOY-14): a line whose final period is a tiny gold airplane. With `takeoff`, the plane flies once
 * along a curve from where the period sits, leaving round sage dots behind it that stay when it lands. No loop; with
 * reduced motion the plane simply stays as punctuation. Screen readers get `plain`, the line with its real period.
 *
 * `lead` is the text before the last word; `tail` is the last word, kept on one line with the plane.
 */
export default function BrandSignature({ lead, tail, plain, as: Tag = "h2", takeoff = false, className }: {
  lead: string;
  tail: string;
  plain: string;
  as?: "h1" | "h2" | "p";
  takeoff?: boolean;
  className?: string;
}) {
  const stageRef = useRef<HTMLSpanElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const restRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const stage = stageRef.current, anchor = anchorRef.current, rest = restRef.current, overlay = overlayRef.current;
    if (!stage || !anchor || !rest || !overlay) return;
    const path = overlay.querySelector<SVGPathElement>("path[data-motion]")!;
    const dots = overlay.querySelector<SVGGElement>("[data-dots]")!;
    const plane = overlay.querySelector<SVGGElement>("[data-plane]")!;
    let raf = 0;

    const reset = () => {
      cancelAnimationFrame(raf);
      dots.replaceChildren();
      plane.setAttribute("visibility", "hidden");
      rest.style.visibility = "visible";
    };
    const play = () => {
      reset();
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      const b = stage.getBoundingClientRect(), a = anchor.getBoundingClientRect();
      if (!a.width) return;
      const x = a.left - b.left + a.width / 2, y = a.top - b.top + a.height / 2;
      const endX = Math.min(b.width - 10, x + 65), endY = Math.max(10, y - 85);
      path.setAttribute("d", `M${x} ${y} C${Math.min(x + 12, endX)} ${y - 14},${endX} ${y - 25},${endX} ${endY}`);
      const len = path.getTotalLength();
      let start: number | null = null, next = 0;
      rest.style.visibility = "hidden";
      plane.setAttribute("visibility", "visible");
      plane.querySelector("path")!.setAttribute("transform", `scale(${a.width / 28})`);
      const frame = (t: number) => {
        if (start === null) start = t;
        const p = Math.min((t - start) / DURATION_MS, 1), distance = len * p;
        const pt = path.getPointAtLength(distance);
        const ahead = path.getPointAtLength(Math.min(len, distance + 0.5)), behind = path.getPointAtLength(Math.max(0, distance - 0.5));
        const angle = (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI + 90;
        plane.setAttribute("transform", `translate(${pt.x} ${pt.y}) rotate(${angle})`);
        while (next < distance - 8) {
          const q = path.getPointAtLength(next), c = document.createElementNS(NS, "circle");
          c.setAttribute("cx", String(q.x)); c.setAttribute("cy", String(q.y)); c.setAttribute("r", "1.4"); c.setAttribute("fill", "#ADC5B8");
          dots.appendChild(c);
          next += 6;
        }
        if (p < 1) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };

    // The first size report comes as soon as we start watching: that is when the line is laid out, so take off then
    // (once). A later resize (rotating the phone, zoom) puts the plane back as punctuation rather than leave a trail in
    // the wrong place.
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) { first = false; if (takeoff) play(); return; }
      reset();
    });
    observer.observe(stage);
    return () => { observer.disconnect(); reset(); };
  }, [takeoff, lead, tail]);

  return (
    <Tag className={["brand-signature", className].filter(Boolean).join(" ")}>
      <span className="brand-stage" ref={stageRef}>
        <span className="brand-sr">{plain}</span>
        <span aria-hidden="true">
          {lead}
          <span className="brand-end">
            {tail}
            <span className="brand-anchor" ref={anchorRef}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={restRef} src="/brand/airplane.svg" alt="" />
            </span>
          </span>
        </span>
        <svg className="brand-overlay" ref={overlayRef} aria-hidden="true" focusable="false">
          <path data-motion="" fill="none" stroke="none" />
          <g data-dots="" />
          <g data-plane="" visibility="hidden"><path d={PLANE} fill="#C2934D" /></g>
        </svg>
      </span>
    </Tag>
  );
}
