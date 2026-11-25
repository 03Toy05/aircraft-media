"use client";

import { CONTACT_APPS } from "@/domain/messengers";
import { BRAND_LOGOS } from "./brandLogos";
import { useT } from "./uiLang";

/** One round button per messenger, showing its logo (the name is read out by screen readers and shown on hover). */
export function AppLogo({ id, size = 26 }: { id: string; size?: number }) {
  const logo = BRAND_LOGOS[id];
  if (!logo) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}>
      <path d={logo.path} fill={logo.hex} />
    </svg>
  );
}

export default function MessengerButtons({ onPick, onEmail, disabled }: { onPick: (appId: string, label: string) => void; onEmail?: () => void; disabled?: boolean }) {
  const t = useT();
  return (
    <div className="logo-apps">
      {CONTACT_APPS.map((a) => (
        <button key={a.id} type="button" className="logo-app" disabled={disabled} onClick={() => onPick(a.id, a.label)} aria-label={a.label} title={a.label}>
          <AppLogo id={a.id} />
        </button>
      ))}
      {onEmail && (
        <button type="button" className="logo-app" disabled={disabled} onClick={onEmail} aria-label={t("Email")} title={t("Email")}>
          <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
        </button>
      )}
    </div>
  );
}
