"use client";

import { UI_LANG_COOKIE, parseUiLang, ui, type UiParams } from "@/domain/uiText";

/** A label in the screen language chosen on this browser (these helpers run outside any component). */
const t = (en: string, params?: UiParams) => {
  const lang = typeof document === "undefined" ? "en" : parseUiLang(document.cookie.split(/;\s*/).find((c) => c.startsWith(`${UI_LANG_COOKIE}=`))?.slice(UI_LANG_COOKIE.length + 1));
  return ui(lang, en, params);
};

/**
 * Download one photo for sharing. Tries twice (a dropped connection or the server restarting usually clears in a
 * moment), then fails with a message that names the photo.
 */
export async function fetchPhoto(url: string, name: string): Promise<Blob> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.blob();
    } catch { /* network dropped: try again */ }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error(t("Could not download {name}. The connection dropped or the site was restarting. Wait a few seconds and tap the button again.", { name }));
}

/**
 * Copy text to the clipboard as reliably as phones allow.
 * The old-style copy (a hidden text box + execCommand) runs first and synchronously, while the tap still counts as
 * the user's gesture; some phone browsers refuse the modern clipboard API once the page starts switching to another
 * app. The modern API is then tried as well. Returns true when either worked.
 */
export async function copyText(text: string): Promise<boolean> {
  let ok = false;
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.top = "0";
    box.style.left = "0";
    box.style.opacity = "0";
    box.style.fontSize = "16px"; // stops iPhones zooming in
    document.body.appendChild(box);
    box.focus();
    box.select();
    box.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
    document.body.removeChild(box);
  } catch {
    // fall through to the clipboard API
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch {
    // keep the result of the old-style copy
  }
  return ok;
}

/**
 * Hand text to the phone's share sheet (WeChat, LINE, Telegram, Signal… all appear there and receive the text
 * already filled in). Returns "shared", "cancelled" (the owner closed the sheet) or "unsupported" (desktop browsers).
 */
export async function shareText(text: string): Promise<"shared" | "cancelled" | "unsupported"> {
  if (typeof navigator === "undefined" || !navigator.share) return "unsupported";
  try {
    await navigator.share({ text });
    return "shared";
  } catch (e) {
    return (e as Error).name === "AbortError" ? "cancelled" : "unsupported";
  }
}

/**
 * Open another app after copying. Waits a moment so the clipboard is saved before the phone switches apps
 * (WeChat and others open too fast otherwise and the copy is lost).
 */
export function openAfterCopy(url: string, newTab: boolean, delayMs = 400) {
  setTimeout(() => {
    if (newTab) window.open(url, "_blank");
    else window.location.href = url;
  }, delayMs);
}
