"use client";

import { useEffect } from "react";

const STORE = "fleetFilters";

/**
 * Remembers a page's filters and view on this device, so it opens the way it was left.
 *  - Opening the page with no address options brings the saved ones back.
 *  - Opening it with filters saves them.
 *  - "?reset=1" (the Clear link) forgets them.
 * Kept in this browser only; nothing is sent anywhere.
 */
export default function RememberFilters({ keys }: { keys: string[] }) {
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const p = url.searchParams;
      if (p.has("reset")) {
        localStorage.removeItem(STORE);
        p.delete("reset");
        window.history.replaceState(null, "", `${url.pathname}${p.size ? `?${p}` : ""}`);
        const keep = new URLSearchParams();
        for (const k of keys) { const v = p.get(k); if (v) keep.set(k, v); }
        if (keep.size) localStorage.setItem(STORE, keep.toString());
        return;
      }
      if (p.size === 0) {
        // Only what this page remembers now (an older saved search is dropped, not brought back).
        const saved = new URLSearchParams(localStorage.getItem(STORE) ?? "");
        const back = new URLSearchParams();
        for (const k of keys) { const v = saved.get(k); if (v) back.set(k, v); }
        if (back.size) window.location.replace(`${url.pathname}?${back}`);
        else localStorage.removeItem(STORE);
        return;
      }
      const keep = new URLSearchParams();
      for (const k of keys) { const v = p.get(k); if (v) keep.set(k, v); }
      if (keep.size) localStorage.setItem(STORE, keep.toString());
    } catch { /* storage blocked: the page simply opens unfiltered */ }
  }, [keys]);
  return null;
}
