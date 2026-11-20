"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { pageShown, report } from "./speedClock";

/** Reports page changes and button presses once their result is drawn; the first load of the app, too. */
export function SpeedTracker() {
  const path = usePathname();
  const search = useSearchParams();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (nav) report({ kind: "page", name: `${path} (opened)`, ms: nav.domContentLoadedEventEnd || nav.responseEnd });
      return;
    }
    // Two frames: the new page has been painted.
    requestAnimationFrame(() => requestAnimationFrame(() => pageShown(path)));
  }, [path, search]);
  return null;
}
