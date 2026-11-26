"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import Icon from "./Icon";
import { LangSwitch, useT } from "./uiLang";

/** The five things used every day; the rest sit under "More". */
const MAIN = [
  { href: "/", label: "Dashboard", match: (p: string) => p === "/" },
  { href: "/quote", label: "Quote", match: (p: string) => p.startsWith("/quote") },
  { href: "/requests", label: "Requests", match: (p: string) => p.startsWith("/requests") },
  { href: "/review", label: "Review", match: (p: string) => p.startsWith("/review") },
  { href: "/fleet", label: "Operators & aircraft", match: (p: string) => p.startsWith("/fleet") || p.startsWith("/aircraft") || p.startsWith("/organisations") },
] as const;

/**
 * The top bar on larger screens: Toy and the name, the daily five, a "More" menu, the trial badge, the language globe
 * and an account menu (email, Settings, Sign out). One row; the phone uses MobileNav at the bottom instead.
 */
export default function TopNav({ email, trial, signOut, isAdmin = false, library = false }: {
  email: string;
  trial: string | null;
  signOut: () => Promise<void>;
  isAdmin?: boolean;
  library?: boolean;
}) {
  const path = usePathname() ?? "/";
  const t = useT();
  const more = useRef<HTMLDetailsElement>(null);
  const account = useRef<HTMLDetailsElement>(null);

  // Menus close after going somewhere, and when clicking anywhere outside them.
  useEffect(() => { more.current?.removeAttribute("open"); account.current?.removeAttribute("open"); }, [path]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      for (const d of [more.current, account.current]) if (d?.open && !d.contains(e.target as Node)) d.removeAttribute("open");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const extras = [
    { href: "/contacts", label: "Contacts", show: true },
    { href: "/library", label: "Library", show: library },
    { href: "/guide", label: "Guide", show: true },
    { href: "/support", label: "Support", show: true },
    { href: "/settings", label: "Settings", show: true },
    { href: "/admin", label: "Users", show: isAdmin },
  ].filter((x) => x.show);
  const moreActive = extras.some((x) => path.startsWith(x.href));

  return (
    <nav className="top" aria-label={t("Main")}>
      <Link href="/" className="brand">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.svg" alt="" width={28} height={28} /><span className="brand-name">Aircraft Media</span></Link>
      <span className="nav-links">
        {MAIN.map((l) => (
          <Link key={l.href} href={l.href} aria-current={l.match(path) ? "page" : undefined}>{t(l.label)}</Link>
        ))}
        <details ref={more} className="nav-menu">
          <summary className={moreActive ? "is-current" : undefined}>{t("More")} <span aria-hidden="true">▾</span></summary>
          <div className="nav-menu-list">
            {extras.map((x) => <Link key={x.href} href={x.href} aria-current={path.startsWith(x.href) ? "page" : undefined}>{t(x.label)}</Link>)}
          </div>
        </details>
      </span>
      <span className="spacer" />
      {trial && <span className="nav-trial small">{trial}</span>}
      <LangSwitch className="nav-lang" />
      <details ref={account} className="nav-menu nav-account">
        <summary aria-label={t("Your account")} title={email}>{(email[0] ?? "?").toUpperCase()}</summary>
        <div className="nav-menu-list">
          <span className="nav-email">{email}</span>
          {trial && <span className="nav-menu-note">{trial}</span>}
          <Link href="/settings"><Icon name="settings" />{t("Settings")}</Link>
          <form action={signOut}><button type="submit"><Icon name="signout" />{t("Sign out")}</button></form>
        </div>
      </details>
    </nav>
  );
}
