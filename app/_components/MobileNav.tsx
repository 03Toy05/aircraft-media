"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Icon from "./Icon";

const TABS = [
  { href: "/", label: "Chocks", icon: "home", match: (p: string) => p === "/" },
  { href: "/review", label: "Review", icon: "review", match: (p: string) => p.startsWith("/review") },
  { href: "/fleet", label: "Fleet", icon: "plane", match: (p: string) => p.startsWith("/fleet") || p.startsWith("/aircraft") || p.startsWith("/organisations") },
  { href: "/quote", label: "Quote", icon: "quote", match: (p: string) => p.startsWith("/quote") },
] as const;

/**
 * Phone navigation: a bar along the bottom with the four things used most, and a "More" sheet for the rest.
 * Shown only on narrow screens (see globals.css); the top bar's links are used on larger ones.
 */
export default function MobileNav({ email, signOut }: { email: string; signOut: () => Promise<void> }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]); // close the sheet after going somewhere
  const moreActive = path.startsWith("/contacts") || path.startsWith("/settings") || path.startsWith("/photos") || path.startsWith("/intake");

  return (
    <>
      {open && <button type="button" className="sheet-backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />}
      {open && (
        <div className="sheet" role="dialog" aria-label="More">
          <Link href="/contacts"><Icon name="contacts" />Contacts</Link>
          <Link href="/photos"><Icon name="photos" />Approved photos</Link>
          <Link href="/intake"><Icon name="upload" />Upload photos</Link>
          <Link href="/settings"><Icon name="settings" />Settings</Link>
          <p className="small muted" style={{ margin: "6px 0" }}>{email}</p>
          <form action={signOut}><button type="submit" className="secondary"><Icon name="signout" />Sign out</button></form>
        </div>
      )}
      <nav className="bottom-nav" aria-label="Main">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={t.match(path) ? "on" : undefined} aria-current={t.match(path) ? "page" : undefined}>
            <Icon name={t.icon} size={22} /><span>{t.label}</span>
          </Link>
        ))}
        <button type="button" className={`${open || moreActive ? "on" : ""}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Icon name="menu" size={22} /><span>More</span>
        </button>
      </nav>
    </>
  );
}
