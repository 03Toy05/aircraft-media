"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { getRecognition } from "./voice";

const TABS = [
  { href: "/", label: "Toy", icon: "home", match: (p: string) => p === "/" },
  { href: "/fleet", label: "Fleet", icon: "plane", match: (p: string) => p.startsWith("/fleet") || p.startsWith("/aircraft") || p.startsWith("/organisations") },
  { href: "/quote", label: "Quote", icon: "quote", match: (p: string) => p.startsWith("/quote") },
] as const;

/**
 * Phone navigation: a bar along the bottom with the four things used most, and a "More" sheet for the rest.
 * Shown only on narrow screens (see globals.css); the top bar's links are used on larger ones.
 */
export default function MobileNav({ email, signOut, isAdmin = false }: { email: string; signOut: () => Promise<void>; isAdmin?: boolean }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]); // close the sheet after going somewhere
  const [canTalk, setCanTalk] = useState(false);
  const [talking, setTalking] = useState(false);
  useEffect(() => setCanTalk(!!getRecognition()), []);
  useEffect(() => {
    const on = (e: Event) => setTalking((e as CustomEvent<boolean>).detail);
    window.addEventListener("chocks:listening", on);
    return () => window.removeEventListener("chocks:listening", on);
  }, []);
  const moreActive = path.startsWith("/review") || path.startsWith("/contacts") || path.startsWith("/settings") || path.startsWith("/photos") || path.startsWith("/intake") || path.startsWith("/admin");

  return (
    <>
      {open && <button type="button" className="sheet-backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />}
      {open && (
        <div className="sheet" role="dialog" aria-label="More">
          <Link href="/review"><Icon name="review" />Review photos</Link>
          <Link href="/contacts"><Icon name="contacts" />Contacts</Link>
          <Link href="/photos"><Icon name="photos" />Approved photos</Link>
          <Link href="/intake"><Icon name="upload" />Upload photos</Link>
          <Link href="/settings"><Icon name="settings" />Settings</Link>
          {isAdmin && <Link href="/admin"><Icon name="contacts" />Users</Link>}
          <p className="small muted" style={{ margin: "6px 0" }}>{email}</p>
          <form action={signOut}><button type="submit" className="secondary"><Icon name="signout" />Sign out</button></form>
        </div>
      )}
      <nav className="bottom-nav" aria-label="Main">
        {TABS.map((t, i) => (
          <span key={t.href} style={{ display: "contents" }}>
            {i === 2 && (canTalk ? (
              // The Ask Toy microphone: VoiceCommand (or Toy's own message box on the Toy page) listens for this.
              <button type="button" className={`mic-tab${talking ? " on" : ""}`} onClick={() => window.dispatchEvent(new Event("chocks:mic"))} aria-label={talking ? "Stop listening" : "Ask Toy by voice"} aria-pressed={talking}>
                <span className="mic-dot"><Icon name="mic" size={22} /></span>
              </button>
            ) : (
              <Link href="/review" className={path.startsWith("/review") ? "on" : undefined}><Icon name="review" size={22} /><span>Review</span></Link>
            ))}
            <Link href={t.href} className={t.match(path) ? "on" : undefined} aria-current={t.match(path) ? "page" : undefined}>
              <Icon name={t.icon} size={22} /><span>{t.label}</span>
            </Link>
          </span>
        ))}
        <button type="button" className={`${open || moreActive ? "on" : ""}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Icon name="menu" size={22} /><span>More</span>
        </button>
      </nav>
    </>
  );
}
