"use client";

import { useState } from "react";

/** Logo and colour for the workspace's quotes, with a preview of the quote's top as the client will see it. */
export default function BrandForm({ action, name, color: saved, logo: savedLogo }: { action: (fd: FormData) => void; name: string; color: string; logo: string | null }) {
  const [color, setColor] = useState(saved);
  const [logo, setLogo] = useState<string | null>(savedLogo);
  const [remove, setRemove] = useState(false);
  const shown = remove ? null : logo;
  return (
    <form action={action} className="brand-form">
      <div className="brand-preview" style={{ borderBottomColor: color }}>
        <div>
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="Your logo" />
          ) : (
            <div className="brand-name" style={{ color }}>{name}</div>
          )}
        </div>
        <div className="brand-ref"><b>Aircraft options</b><span>AM-2611-001 · v1</span></div>
      </div>
      <div className="row" style={{ alignItems: "end", gap: 12 }}>
        <div>
          <label className="small" htmlFor="brand-logo">Logo (PNG, JPG, WebP or SVG, up to 3 MB)</label>
          <input id="brand-logo" type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setRemove(false);
              if (f) setLogo(URL.createObjectURL(f));
            }} />
        </div>
        <div style={{ flex: "0 0 auto" }}>
          <label className="small" htmlFor="brand-color">Colour</label>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input id="brand-color" type="color" name="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 48, height: 36, padding: 2 }} />
            <input type="text" value={color} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && setColor(e.target.value)} aria-label="Colour code" style={{ width: 96 }} />
          </span>
        </div>
      </div>
      {logo && (
        <label className="small" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
          <input type="checkbox" name="removeLogo" value="1" checked={remove} onChange={(e) => setRemove(e.target.checked)} /> Remove the logo (your name shows instead)
        </label>
      )}
      <div style={{ marginTop: 8 }}><button type="submit">Save branding</button></div>
    </form>
  );
}
