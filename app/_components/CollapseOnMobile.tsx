"use client";

import { useEffect, useRef } from "react";
import Icon from "./Icon";

/**
 * A panel that is open on large screens and folded on phones (so a long set of filters does not push the
 * list off the screen). It stays open when `keepOpen` is true, for example while a filter is applied.
 */
export default function CollapseOnMobile({ summary, keepOpen, plain, children }: { summary: string; keepOpen?: boolean; /** Without its own card, when it sits inside one. */ plain?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!keepOpen && window.matchMedia("(max-width: 720px)").matches && ref.current) ref.current.open = false;
    ref.current?.setAttribute("data-ready", ""); // until now phones keep it folded by CSS, so it never flashes open
  }, [keepOpen]);
  return (
    <details ref={ref} className={`${plain ? "collapse" : "card collapse"}${keepOpen ? " keep-open" : ""}`} open>
      <summary><Icon name="filter" />{summary}</summary>
      {children}
    </details>
  );
}
