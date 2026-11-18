"use client";

import Icon from "./Icon";

/**
 * Opens a folded section on the same page without reloading it, so whatever has been typed in the other
 * forms stays where it is. Both forms can be open and filled in at the same time.
 */
export default function OpenSection({ target, icon, children }: { target: string; icon: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => {
        const el = document.getElementById(target) as HTMLDetailsElement | null;
        if (!el) return;
        el.open = true;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.querySelector<HTMLElement>("input,select")?.focus({ preventScroll: true });
      }}
    >
      <Icon name={icon} />{children}
    </button>
  );
}
