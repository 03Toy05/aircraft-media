"use client";

import { useEffect, useRef } from "react";
import Icon from "./Icon";

/**
 * A panel that is open on large screens and folded on phones (so a long set of filters does not push the
 * list off the screen). It stays open when `keepOpen` is true, for example while a filter is applied.
 */
export default function CollapseOnMobile({ summary, keepOpen, children }: { summary: string; keepOpen?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!keepOpen && window.matchMedia("(max-width: 720px)").matches && ref.current) ref.current.open = false;
  }, [keepOpen]);
  return (
    <details ref={ref} className="card collapse" open>
      <summary><Icon name="filter" />{summary}</summary>
      {children}
    </details>
  );
}
