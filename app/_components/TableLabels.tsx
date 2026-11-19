"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * On phones, tables are shown as stacked rows (see `table.stackable` in globals.css). This copies each column's
 * heading onto its cells so every value keeps its name ("YOM 2013") without the header row.
 */
export default function TableLabels() {
  const path = usePathname();
  useEffect(() => {
    const label = () => {
      for (const t of document.querySelectorAll<HTMLTableElement>("main table")) {
        const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
        if (!heads.length) continue;
        t.classList.add("stackable");
        for (const tr of t.querySelectorAll("tbody tr"))
          [...tr.children].forEach((td, i) => { if (!td.hasAttribute("data-label")) td.setAttribute("data-label", heads[i] ?? ""); });
      }
    };
    label();
    // Tables that appear later (opened sections, server refreshes).
    const obs = new MutationObserver(label);
    const main = document.querySelector("main");
    if (main) obs.observe(main, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [path]);
  return null;
}
