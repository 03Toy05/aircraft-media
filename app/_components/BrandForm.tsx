"use client";

import { useState } from "react";
import { useT } from "./uiLang";

/** Logo and colour for the workspace's quotes, with a preview of the quote's top as the client will see it. */
export default function BrandForm({ action, name, color: saved, logo: savedLogo, versionFormat, formats }: {
  action: (fd: FormData) => void; name: string; color: string; logo: string | null; versionFormat: string; formats: string[];
}) {
  const t = useT();
  const [format, setFormat] = useState(versionFormat);
  const sample = (f: string) => f.replaceAll("{ref}", "AM-2611-003").replaceAll("{nn}", "02").replaceAll("{n}", "2");
  const formatOk = (f: string) => f.includes("{ref}") && /\{nn?\}/.test(f);
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
            <img src={shown} alt={t("Your logo")} />
          ) : (
            <div className="brand-name" style={{ color }}>{name}</div>
          )}
        </div>
        <div className="brand-ref"><b>{t("Your Charter Proposal")}</b><span>{formatOk(format) ? sample(format) : "AM-2611-003 | v2"}</span></div>
      </div>
      <div className="row" style={{ alignItems: "end", gap: 12 }}>
        <div>
          <label className="small" htmlFor="brand-logo">{t("Logo (PNG, JPG, WebP or SVG, up to 3 MB)")}</label>
          <input id="brand-logo" type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setRemove(false);
              if (f) setLogo(URL.createObjectURL(f));
            }} />
        </div>
        <div style={{ flex: "0 0 auto" }}>
          <label className="small" htmlFor="brand-color">{t("Colour")}</label>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input id="brand-color" type="color" name="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 48, height: 36, padding: 2 }} />
            <input type="text" value={color} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && setColor(e.target.value)} aria-label={t("Colour code")} style={{ width: 96 }} />
          </span>
        </div>
      </div>
      {logo && (
        <label className="small" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
          <input type="checkbox" name="removeLogo" value="1" checked={remove} onChange={(e) => setRemove(e.target.checked)} /> {t("Remove the logo (your name shows instead)")}
        </label>
      )}
      <div style={{ marginTop: 10 }}>
        <label className="small" htmlFor="brand-format">{t("Reference format on quotes")}</label>
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <div style={{ flex: "0 0 auto" }}>
            <select id="brand-format" value={formats.includes(format) ? format : "custom"} onChange={(e) => e.target.value !== "custom" && setFormat(e.target.value)}>
              {formats.map((f) => <option key={f} value={f}>{sample(f)}</option>)}
              <option value="custom">{t("Your own…")}</option>
            </select>
          </div>
          <div><input type="text" name="versionFormat" value={format} onChange={(e) => setFormat(e.target.value)} maxLength={60} aria-label={t("Reference format")} aria-invalid={!formatOk(format) || undefined} /></div>
        </div>
        <p className="small muted" style={{ margin: "4px 0 0" }}>{t("{ref} is the reference, {n} the version (or {nn} for 01, 02…).")} {formatOk(format) ? <>{t("Reads:")} <b>{sample(format)}</b></> : <b>{t("Include {ref} and {n}.")}</b>}</p>
      </div>
      <div style={{ marginTop: 10 }}><button type="submit" disabled={!formatOk(format)}>{t("Save branding")}</button></div>
    </form>
  );
}
