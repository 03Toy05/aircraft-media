import { invalid } from "./errors";

/**
 * What each messenger can do from a link:
 *  - "chat+text": a link can open the chat with this person AND pre-fill the card (WhatsApp by number, SMS/iMessage by number).
 *  - "chat": a link can open the chat but not pre-fill text, so the card is copied first and pasted.
 *  - "app": the app can only be opened; the owner finds the person and pastes the card.
 * No messenger lets a link attach photos, so photos always go through the phone's Share sheet.
 */
export interface ContactApp { id: string; label: string; colour: string; mark: string; handleLabel: string; mode: "chat+text" | "chat" | "app" }

export const CONTACT_APPS: ContactApp[] = [
  { id: "whatsapp", label: "WhatsApp", colour: "#25d366", mark: "W", handleLabel: "Phone number with country code", mode: "chat+text" },
  { id: "imessage", label: "iMessage / SMS", colour: "#34c759", mark: "M", handleLabel: "Phone number with country code", mode: "chat+text" },
  { id: "telegram", label: "Telegram", colour: "#27a7e7", mark: "T", handleLabel: "Telegram username (no @)", mode: "chat" },
  { id: "viber", label: "Viber", colour: "#7360f2", mark: "V", handleLabel: "Phone number with country code", mode: "chat" },
  { id: "line", label: "LINE", colour: "#06c755", mark: "L", handleLabel: "LINE ID (optional)", mode: "app" },
  { id: "wechat", label: "WeChat", colour: "#07c160", mark: "W", handleLabel: "WeChat ID (optional)", mode: "app" },
  { id: "kakaotalk", label: "KakaoTalk", colour: "#d9b800", mark: "K", handleLabel: "KakaoTalk ID (optional)", mode: "app" },
  { id: "signal", label: "Signal", colour: "#3a76f0", mark: "S", handleLabel: "Phone number (optional)", mode: "app" },
];

export const contactApp = (id: string) => CONTACT_APPS.find((a) => a.id === id);

/** The link to open for one contact. `copyFirst` means the card must be copied to the clipboard before opening. */
export function contactLink(appId: string, handle: string | null | undefined, text: string): { url: string; copyFirst: boolean; newTab: boolean } {
  const t = encodeURIComponent(text);
  const digits = (handle ?? "").replace(/[^\d]/g, "");
  const user = (handle ?? "").replace(/^@/, "").trim();
  switch (appId) {
    case "whatsapp": return { url: digits ? `https://wa.me/${digits}?text=${t}` : `https://wa.me/?text=${t}`, copyFirst: false, newTab: true };
    case "imessage": return { url: `sms:${digits ? "+" + digits : ""}&body=${t}`, copyFirst: false, newTab: false };
    case "telegram": return user ? { url: `https://t.me/${encodeURIComponent(user)}`, copyFirst: true, newTab: true } : { url: `https://t.me/share/url?url=%20&text=${t}`, copyFirst: false, newTab: true };
    case "viber": return digits ? { url: `viber://chat?number=%2B${digits}`, copyFirst: true, newTab: false } : { url: `viber://forward?text=${t}`, copyFirst: false, newTab: false };
    case "line": return { url: "line://", copyFirst: true, newTab: false };
    case "wechat": return { url: "weixin://", copyFirst: true, newTab: false };
    case "kakaotalk": return { url: "kakaotalk://", copyFirst: true, newTab: false };
    case "signal": return { url: "sgnl://", copyFirst: true, newTab: false };
    default: throw invalid('Unknown messenger "{app}"', undefined, { app: String(appId) });
  }
}
