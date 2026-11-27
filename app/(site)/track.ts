"use client";
import { useEffect } from "react";

/**
 * Website counts (POST /api/track, see AM Development): no cookies, no visitor ID; the server only adds one to a
 * daily count per event and language. Each event is sent at most once per visit (until the page is reloaded),
 * so the counts mean visitors, not clicks. If the endpoint isn't there, the beacon simply fails; nothing breaks.
 */
export type TrackEvent = "front_interaction" | "demo_play" | "demo_complete" | "letmetry_complete" | "pricing_view" | "make_toy_yours_click";
const sent = new Set<TrackEvent>();

export function track(event: TrackEvent, lang: string) {
  if (sent.has(event) || typeof navigator === "undefined") return;
  sent.add(event);
  const body = JSON.stringify({ event, lang });
  try {
    if (!navigator.sendBeacon?.("/api/track", body)) {
      fetch("/api/track", { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch { /* counting must never get in the visitor's way */ }
}

/** Page-wide events: the first click, key or scroll; any "Make Toy yours" link (/start); opening "How much?". */
export function SiteTracker({ lang, pricing }: { lang: string; pricing: boolean }) {
  useEffect(() => { if (pricing) track("pricing_view", lang); }, [lang, pricing]);
  useEffect(() => {
    const first = () => track("front_interaction", lang);
    const click = (e: MouseEvent) => {
      first();
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (a && new URL((a as HTMLAnchorElement).href, location.href).pathname === "/start") track("make_toy_yours_click", lang);
    };
    document.addEventListener("click", click, true);
    window.addEventListener("keydown", first, { once: true });
    window.addEventListener("scroll", first, { once: true, passive: true });
    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("keydown", first);
      window.removeEventListener("scroll", first);
    };
  }, [lang]);
  return null;
}
