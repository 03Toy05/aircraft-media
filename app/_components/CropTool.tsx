"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Rect = { x: number; y: number; w: number; h: number };
type Drag =
  | { kind: "draw"; ox: number; oy: number }
  | { kind: "move"; dx: number; dy: number }
  | { kind: "resize"; corner: "nw" | "ne" | "sw" | "se" };

const MIN = 8; // smallest crop side, in image pixels

/**
 * Draw, move and resize a crop box directly on the photo. Works in the image's real pixel
 * coordinates, so the numbers submitted are the same ones the server validates.
 */
export default function CropTool({
  src, width, height, action, mediaId, contentVersionId, disabled, submitKey,
}: {
  src: string; width: number; height: number;
  action: (fd: FormData) => void | Promise<void>;
  mediaId: string; contentVersionId: string; disabled: boolean; submitKey: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: width, h: height });
  const drag = useRef<Drag | null>(null);

  const clamp = useCallback((r: Rect): Rect => {
    const w = Math.max(MIN, Math.min(width, Math.round(r.w)));
    const h = Math.max(MIN, Math.min(height, Math.round(r.h)));
    return { w, h, x: Math.max(0, Math.min(width - w, Math.round(r.x))), y: Math.max(0, Math.min(height - h, Math.round(r.y))) };
  }, [width, height]);

  const toImage = (e: { clientX: number; clientY: number }) => {
    const b = box.current!.getBoundingClientRect();
    return { px: ((e.clientX - b.left) / b.width) * width, py: ((e.clientY - b.top) / b.height) * height };
  };

  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d || !box.current) return;
    const b = box.current.getBoundingClientRect();
    const px = Math.max(0, Math.min(width, ((e.clientX - b.left) / b.width) * width));
    const py = Math.max(0, Math.min(height, ((e.clientY - b.top) / b.height) * height));
    setRect((r) => {
      if (d.kind === "draw") return clamp({ x: Math.min(px, d.ox), y: Math.min(py, d.oy), w: Math.abs(px - d.ox), h: Math.abs(py - d.oy) });
      if (d.kind === "move") return clamp({ ...r, x: px - d.dx, y: py - d.dy });
      const right = r.x + r.w;
      const bottom = r.y + r.h;
      const x1 = d.corner.includes("w") ? Math.min(px, right - MIN) : r.x;
      const x2 = d.corner.includes("e") ? Math.max(px, r.x + MIN) : right;
      const y1 = d.corner.includes("n") ? Math.min(py, bottom - MIN) : r.y;
      const y2 = d.corner.includes("s") ? Math.max(py, r.y + MIN) : bottom;
      return clamp({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    });
  }, [clamp, width, height]);

  const onUp = useCallback(() => { drag.current = null; }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [onMove, onUp]);

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const num = (k: keyof Rect) => (e: React.ChangeEvent<HTMLInputElement>) => setRect((r) => clamp({ ...r, [k]: Number(e.target.value) || 0 }));
  const full = rect.x === 0 && rect.y === 0 && rect.w === width && rect.h === height;
  const handle = (corner: "nw" | "ne" | "sw" | "se") => ({
    onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); e.preventDefault(); drag.current = { kind: "resize", corner }; },
    style: {
      position: "absolute" as const, width: 18, height: 18, background: "#fff", border: "2px solid #1a73e8", borderRadius: 3, touchAction: "none" as const,
      cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
      left: corner.includes("w") ? -9 : undefined, right: corner.includes("e") ? -9 : undefined,
      top: corner.includes("n") ? -9 : undefined, bottom: corner.includes("s") ? -9 : undefined,
    },
  });

  return (
    <form action={action}>
      <input type="hidden" name="key" value={submitKey} />
      <input type="hidden" name="mediaId" value={mediaId} />
      <input type="hidden" name="contentVersionId" value={contentVersionId} />
      <p className="muted small">Drag on the photo to draw the area to keep. Drag the box to move it; drag a corner to resize.</p>
      <div
        ref={box}
        style={{ position: "relative", width: "100%", userSelect: "none", touchAction: "none", cursor: disabled ? "default" : "crosshair", lineHeight: 0 }}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          const { px, py } = toImage(e);
          drag.current = { kind: "draw", ox: px, oy: py };
          setRect(clamp({ x: px, y: py, w: MIN, h: MIN }));
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Photo to crop" draggable={false} style={{ width: "100%", height: "auto", display: "block" }} />
        {!full && (
          <div
            style={{
              position: "absolute", left: pct(rect.x, width), top: pct(rect.y, height), width: pct(rect.w, width), height: pct(rect.h, height),
              border: "2px solid #1a73e8", boxShadow: "0 0 0 9999px rgba(0,0,0,.45)", cursor: "move", boxSizing: "border-box",
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const { px, py } = toImage(e);
              drag.current = { kind: "move", dx: px - rect.x, dy: py - rect.y };
            }}
          >
            <span {...handle("nw")} /><span {...handle("ne")} /><span {...handle("sw")} /><span {...handle("se")} />
          </div>
        )}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <div><label>X</label><input name="x" type="number" value={rect.x} onChange={num("x")} min={0} required /></div>
        <div><label>Y</label><input name="y" type="number" value={rect.y} onChange={num("y")} min={0} required /></div>
        <div><label>Width</label><input name="width" type="number" value={rect.w} onChange={num("w")} min={1} required /></div>
        <div><label>Height</label><input name="height" type="number" value={rect.h} onChange={num("h")} min={1} required /></div>
      </div>
      <div className="row">
        <div><select name="mode"><option value="recrop">Replace with this crop (can be undone)</option><option value="separate">Separate as a new photo (collage)</option></select></div>
        <div style={{ flex: "0 0 auto" }}><button className="secondary" type="button" onClick={() => setRect({ x: 0, y: 0, w: width, h: height })} disabled={full}>Reset box</button></div>
        <div style={{ flex: "0 0 auto" }}><button type="submit" disabled={disabled || full}>Apply crop</button></div>
      </div>
    </form>
  );
}
