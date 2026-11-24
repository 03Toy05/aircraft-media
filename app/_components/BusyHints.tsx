"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Shows that something is happening, everywhere in the app, so nobody presses twice:
 * - a button that sends a form gets a spinner (button[data-busy]) and a second press is ignored until the
 *   reply has come back (or the page has moved on);
 * - a photo shows a soft shimmer until it has loaded (img without data-loaded).
 * Forms that show their own progress opt out with data-own-busy (the upload form).
 */
export default function BusyHints() {
  const path = usePathname();
  const search = useSearchParams();

  // A new page: whatever was sending is done.
  useEffect(() => { clearBusy(); }, [path, search]);

  useEffect(() => {
    // --- buttons
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (!(form instanceof HTMLFormElement) || form.hasAttribute("data-own-busy")) return;
      if (form.querySelector("[data-busy]")) {
        // Still sending the last press.
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      const btn = (e.submitter as HTMLElement | null) ?? form.querySelector<HTMLElement>('button[type="submit"], button:not([type])');
      if (!btn) return;
      btn.setAttribute("data-busy", "");
      btn.setAttribute("aria-busy", "true");
      // A form that runs a server action: if nothing went out after all (a page script stopped it), don't stay busy.
      // (Search forms load a new page instead, which clears it.)
      if (form.getAttribute("action")?.startsWith("javascript:")) setTimeout(() => { if (inFlight === 0) clearBusy(); }, 800);
    };
    document.addEventListener("submit", onSubmit, true);

    // Server actions are POSTs: when the last one has answered (and the page has had a moment to update), buttons are free.
    let inFlight = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const realFetch = window.fetch;
    const wrapped: typeof fetch = async (input, init) => {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method !== "POST") return realFetch(input, init);
      inFlight++;
      clearTimeout(timer);
      try { return await realFetch(input, init); }
      finally {
        inFlight--;
        if (inFlight === 0) timer = setTimeout(() => { if (inFlight === 0) clearBusy(); }, 1200);
      }
    };
    window.fetch = wrapped;

    // --- photos
    const mark = (img: HTMLImageElement) => img.setAttribute("data-loaded", "");
    const onLoad = (e: Event) => { if (e.target instanceof HTMLImageElement) mark(e.target); };
    document.addEventListener("load", onLoad, true);
    document.addEventListener("error", onLoad, true);
    const scan = (root: ParentNode) => root.querySelectorAll<HTMLImageElement>("main img:not([data-loaded])").forEach((img) => { if (img.complete) mark(img); });
    scan(document);
    // Photos that arrive already loaded (from the browser's cache) after the page changes.
    let queued = false;
    const seen = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; scan(document); });
    });
    seen.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("load", onLoad, true);
      document.removeEventListener("error", onLoad, true);
      seen.disconnect();
      if (window.fetch === wrapped) window.fetch = realFetch;
      clearTimeout(timer);
    };
  }, []);

  return null;
}

function clearBusy() {
  document.querySelectorAll("[data-busy]").forEach((b) => { b.removeAttribute("data-busy"); b.removeAttribute("aria-busy"); });
}
