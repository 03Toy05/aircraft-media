"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Choice from "./Choice";
import { useT } from "./uiLang";

type Rect = { x: number; y: number; w: number; h: number };
type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type Drag =
  | { kind: "draw"; ox: number; oy: number }
  | { kind: "move"; dx: number; dy: number }
  | { kind: "resize"; handle: Handle; start: Rect };

const MIN = 8; // smallest side, in image pixels
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSOR: Record<Handle, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };

/**
 * Snipping-tool style crop: drag on the photo to select the area to keep; the rest is dimmed.
 * Move the selection by dragging inside it, resize from any edge or corner. All work during a drag is done
 * directly on the DOM (no React re-render per mouse move) and painted once per animation frame, so it stays smooth.
 * Coordinates are the image's real pixels, the same numbers the server validates.
 */
export default function CropTool({
  src, width, height, action, mediaId, contentVersionId, disabled, submitKey,
}: {
  src: string; width: number; height: number;
  action: (fd: FormData) => void | Promise<void>;
  mediaId: string; contentVersionId: string; disabled: boolean; submitKey: string;
}) {
  const t = useT();
  const wrap = useRef<HTMLDivElement>(null);
  const sel = useRef<HTMLDivElement>(null);
  const dim = { t: useRef<HTMLDivElement>(null), b: useRef<HTMLDivElement>(null), l: useRef<HTMLDivElement>(null), r: useRef<HTMLDivElement>(null) };
  const label = useRef<HTMLSpanElement>(null);
  const field = { x: useRef<HTMLInputElement>(null), y: useRef<HTMLInputElement>(null), w: useRef<HTMLInputElement>(null), h: useRef<HTMLInputElement>(null) };
  const rect = useRef<Rect | null>(null);
  const drag = useRef<Drag | null>(null);
  const bounds = useRef<DOMRect | null>(null);
  const frame = useRef<number | null>(null);
  const [selected, setSelected] = useState(false);

  const clamp = useCallback((r: Rect): Rect => {
    const w = Math.max(MIN, Math.min(width, Math.round(r.w)));
    const h = Math.max(MIN, Math.min(height, Math.round(r.h)));
    return { w, h, x: Math.max(0, Math.min(width - w, Math.round(r.x))), y: Math.max(0, Math.min(height - h, Math.round(r.y))) };
  }, [width, height]);

  const paint = useCallback(() => {
    frame.current = null;
    const r = rect.current;
    const pc = (v: number, of: number) => `${(v / of) * 100}%`;
    const show = !!r;
    if (sel.current) sel.current.style.display = show ? "block" : "none";
    for (const k of ["t", "b", "l", "r"] as const) if (dim[k].current) dim[k].current!.style.display = show ? "block" : "none";
    if (!r) return;
    const s = sel.current!.style;
    s.left = pc(r.x, width); s.top = pc(r.y, height); s.width = pc(r.w, width); s.height = pc(r.h, height);
    const ts = dim.t.current!.style; ts.left = "0"; ts.top = "0"; ts.width = "100%"; ts.height = pc(r.y, height);
    const b = dim.b.current!.style; b.left = "0"; b.top = pc(r.y + r.h, height); b.width = "100%"; b.height = pc(height - r.y - r.h, height);
    const l = dim.l.current!.style; l.left = "0"; l.top = pc(r.y, height); l.width = pc(r.x, width); l.height = pc(r.h, height);
    const rr = dim.r.current!.style; rr.left = pc(r.x + r.w, width); rr.top = pc(r.y, height); rr.width = pc(width - r.x - r.w, width); rr.height = pc(r.h, height);
    if (label.current) label.current.textContent = `${r.w} × ${r.h}`;
    if (field.x.current) field.x.current.value = String(r.x);
    if (field.y.current) field.y.current.value = String(r.y);
    if (field.w.current) field.w.current.value = String(r.w);
    if (field.h.current) field.h.current.value = String(r.h);
  }, [width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  const schedule = useCallback(() => { if (frame.current == null) frame.current = requestAnimationFrame(paint); }, [paint]);
  useEffect(() => () => { if (frame.current != null) cancelAnimationFrame(frame.current); }, []);

  const point = (e: { clientX: number; clientY: number }) => {
    const b = bounds.current!;
    return {
      px: Math.max(0, Math.min(width, ((e.clientX - b.left) / b.width) * width)),
      py: Math.max(0, Math.min(height, ((e.clientY - b.top) / b.height) * height)),
    };
  };

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    bounds.current = wrap.current!.getBoundingClientRect();
    wrap.current!.setPointerCapture(e.pointerId);
    const { px, py } = point(e);
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined;
    const inside = rect.current && px >= rect.current.x && px <= rect.current.x + rect.current.w && py >= rect.current.y && py <= rect.current.y + rect.current.h;
    if (handle && rect.current) drag.current = { kind: "resize", handle, start: { ...rect.current } };
    else if (inside && rect.current) drag.current = { kind: "move", dx: px - rect.current.x, dy: py - rect.current.y };
    else { drag.current = { kind: "draw", ox: px, oy: py }; rect.current = clamp({ x: px, y: py, w: MIN, h: MIN }); schedule(); }
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !bounds.current) return;
    const { px, py } = point(e);
    if (d.kind === "draw") {
      rect.current = clamp({ x: Math.min(px, d.ox), y: Math.min(py, d.oy), w: Math.abs(px - d.ox), h: Math.abs(py - d.oy) });
    } else if (d.kind === "move" && rect.current) {
      rect.current = clamp({ ...rect.current, x: px - d.dx, y: py - d.dy });
    } else if (d.kind === "resize") {
      const s = d.start;
      let x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
      if (d.handle.includes("w")) x1 = Math.min(px, x2 - MIN);
      if (d.handle.includes("e")) x2 = Math.max(px, x1 + MIN);
      if (d.handle.includes("n")) y1 = Math.min(py, y2 - MIN);
      if (d.handle.includes("s")) y2 = Math.max(py, y1 + MIN);
      rect.current = clamp({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    }
    schedule();
  };

  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    if (rect.current && rect.current.w <= MIN && rect.current.h <= MIN) rect.current = null; // a plain click clears the selection
    paint();
    setSelected(!!rect.current);
  };

  const clear = () => { rect.current = null; paint(); setSelected(false); };

  const typed = (k: keyof Rect) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const base = rect.current ?? { x: 0, y: 0, w: width, h: height };
    rect.current = clamp({ ...base, [k]: Number(e.target.value) || 0 });
    paint();
    setSelected(true);
  };

  const dimStyle: React.CSSProperties = { position: "absolute", background: "rgba(0,0,0,.5)", pointerEvents: "none", display: "none" };

  return (
    <form action={action}>
      <input type="hidden" name="key" value={submitKey} />
      <input type="hidden" name="mediaId" value={mediaId} />
      <input type="hidden" name="contentVersionId" value={contentVersionId} />
      <p className="muted small">{t("Drag on the photo to select the area to keep, like the Snipping Tool. Drag inside the selection to move it; drag an edge or corner to resize. Click outside to start again.")}</p>
      <div
        ref={wrap}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={(e) => { if (e.key === "Escape") clear(); }}
        tabIndex={0}
        style={{ position: "relative", width: "100%", userSelect: "none", touchAction: "none", cursor: disabled ? "default" : "crosshair", lineHeight: 0, outline: "none" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={t("Photo to crop")} draggable={false} style={{ width: "100%", height: "auto", display: "block", pointerEvents: "none" }} />
        <div ref={dim.t} style={dimStyle} /><div ref={dim.b} style={dimStyle} /><div ref={dim.l} style={dimStyle} /><div ref={dim.r} style={dimStyle} />
        <div ref={sel} style={{ position: "absolute", display: "none", boxSizing: "border-box", border: "2px dashed #fff", outline: "1px solid rgba(0,0,0,.6)", cursor: "move" }}>
          <span ref={label} style={{ position: "absolute", left: 0, top: -24, background: "rgba(0,0,0,.75)", color: "#fff", font: "12px system-ui", padding: "2px 6px", borderRadius: 3, whiteSpace: "nowrap", lineHeight: 1.4 }} />
          {HANDLES.map((h) => (
            <span
              key={h}
              data-handle={h}
              style={{
                position: "absolute", width: 14, height: 14, background: "#fff", border: "2px solid #1a73e8", borderRadius: 3, boxSizing: "border-box", cursor: CURSOR[h],
                left: h.includes("w") ? -8 : h.includes("e") ? undefined : "calc(50% - 7px)", right: h.includes("e") ? -8 : undefined,
                top: h.includes("n") ? -8 : h.includes("s") ? undefined : "calc(50% - 7px)", bottom: h.includes("s") ? -8 : undefined,
              }}
            />
          ))}
        </div>
      </div>

      <details style={{ marginTop: 8 }}>
        <summary className="small muted">{t("Exact numbers (pixels)")}</summary>
        <div className="row" style={{ marginTop: 6 }}>
          <div><label>X</label><input ref={field.x} name="x" type="number" min={0} defaultValue={0} onChange={typed("x")} required /></div>
          <div><label>Y</label><input ref={field.y} name="y" type="number" min={0} defaultValue={0} onChange={typed("y")} required /></div>
          <div><label>{t("Width")}</label><input ref={field.w} name="width" type="number" min={1} defaultValue={width} onChange={typed("w")} required /></div>
          <div><label>{t("Height")}</label><input ref={field.h} name="height" type="number" min={1} defaultValue={height} onChange={typed("h")} required /></div>
        </div>
      </details>
      <div className="row" style={{ marginTop: 8 }}>
        <div><Choice name="mode" defaultValue="recrop" ariaLabel={t("Crop")} options={[{ value: "recrop", label: "Replace (can be undone)" }, { value: "separate", label: "Separate as a new photo" }]} /></div>
        <div style={{ flex: "0 0 auto" }}><button className="secondary" type="button" onClick={clear} disabled={!selected}>{t("Clear")}</button></div>
        <div style={{ flex: "0 0 auto" }}><button type="submit" disabled={disabled || !selected}>{t("Apply crop")}</button></div>
      </div>
    </form>
  );
}
