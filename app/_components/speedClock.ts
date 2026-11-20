/**
 * The browser side of the Speed page: notes when a page change or a button press starts, and reports how long the
 * person waited until the result was on screen. Reports go out in small batches.
 */
type Event = { kind: "page" | "action" | "toy"; name: string; ms: number; serverMs?: number | null };

const queue: Event[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let navStart: { t: number } | null = null;
let press: { name: string; t: number } | null = null;

function flush() {
  timer = null;
  if (!queue.length) return;
  const body = JSON.stringify({ events: queue.splice(0, queue.length) });
  try {
    if (!navigator.sendBeacon?.("/api/timing", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/timing", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true });
    }
  } catch { /* timing is best effort */ }
}

export function report(e: Event) {
  queue.push(e);
  if (queue.length >= 20) flush();
  else if (!timer) timer = setTimeout(flush, 10_000);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  // A form button: remember which one, so the wait until the next page shows is put down to it.
  document.addEventListener("submit", (e) => {
    const b = (e as SubmitEvent).submitter as HTMLElement | null;
    const label = (b?.textContent || b?.getAttribute("aria-label") || (e.target as HTMLElement | null)?.getAttribute("aria-label") || "form").trim();
    press = { name: label, t: performance.now() };
  }, true);
}

export function navigationStarted() {
  navStart = { t: performance.now() };
}

/** Called once the new page is on screen. */
export function pageShown(path: string) {
  const now = performance.now();
  if (press && now - press.t < 120_000) report({ kind: "action", name: press.name, ms: now - press.t });
  else if (navStart && now - navStart.t < 120_000) report({ kind: "page", name: path, ms: now - navStart.t });
  press = null;
  navStart = null;
}
