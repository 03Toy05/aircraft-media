import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getDb } from "@/db/client";
import { loadStandardAircraftTypes } from "@/domain/directory";
import { hasLibraryAccess } from "@/domain/library";
import { STANDARD_LIST_VERSION } from "@/domain/standardTypes";
import { signOutAction, stopViewingAction } from "../actions";
import Icon from "../_components/Icon";
import MobileNav from "../_components/MobileNav";
import { Suspense } from "react";
import { SpeedTracker } from "../_components/SpeedTracker";
import VoiceCommand from "../_components/VoiceCommand";
import TableLabels from "../_components/TableLabels";
import BusyHints from "../_components/BusyHints";
import { LangSwitch } from "../_components/uiLang";
import { serverT } from "@/lib/uiLang";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireUser(); // redirects to /login unless an invited user (or the admin) is signed in
  const { email, actor } = s;
  // The standard aircraft types are loaded once per workspace and list version (a recorded no-op afterwards); a failure here must not block the app.
  if (!s.readOnly) {
    try {
      await loadStandardAircraftTypes(await getDb(), actor, `auto:${STANDARD_LIST_VERSION}`);
    } catch (e) {
      console.error("Could not load standard aircraft types", e);
    }
  }
  const t = await serverT();
  let libraryOn = s.isAdmin;
  try { libraryOn = await hasLibraryAccess(await getDb(), s); } catch { /* the menu must not fail */ }
  return (
    <>
      <nav className="top">
        <span className="brand" style={{ display: "flex", alignItems: "center", gap: 8 }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.svg" alt="" width={26} height={26} />Aircraft Media</span>
        <Link href="/"><Icon name="home" />{t("Dashboard")}</Link>
        <Link href="/review"><Icon name="review" />{t("Review")}</Link>
        <Link href="/fleet"><Icon name="plane" />{t("Operators & aircraft")}</Link>
        <Link href="/quote"><Icon name="quote" />{t("Quote")}</Link>
        <Link href="/requests"><Icon name="list" />{t("Requests")}</Link>
        <Link href="/contacts"><Icon name="contacts" />{t("Contacts")}</Link>
        <Link href="/settings"><Icon name="settings" />{t("Settings")}</Link>
        <Link href="/support"><Icon name="send" />{t("Support")}</Link>
        {libraryOn && <Link href="/library"><Icon name="plane" />{t("Library")}</Link>}
        {s.isAdmin && <Link href="/admin"><Icon name="contacts" />{t("Users")}</Link>}
        <span className="spacer" />
        {!s.viewingAs && !s.trialEnded && s.daysLeft !== null && (
          <span className="nav-trial small">{s.daysLeft <= 1 ? t("Trial: last day") : t("Trial: {n} days left", { n: s.daysLeft })}</span>
        )}
        <LangSwitch className="nav-lang" />
        <span className="muted small">{email}</span>
        <form action={signOutAction}>
          <button className="secondary" type="submit"><Icon name="signout" />{t("Sign out")}</button>
        </form>
      </nav>
      {s.viewingAs ? (
        <div className="account-bar view">
          <span>{t("Looking at the workspace of")} <b>{s.viewingAs.email}</b> {t("(read-only)")}</span>
          <form action={stopViewingAction}><button type="submit" className="small-btn">{t("Back to my workspace")}</button></form>
        </div>
      ) : s.trialEnded ? (
        <div className="account-bar ended">{t("Your 14-day trial has ended. You can still look and share, but not add or change anything. Ask the admin to extend it.")}</div>
      ) : null}
      <Suspense fallback={null}><SpeedTracker /><BusyHints /></Suspense>
      <main>{children}</main>
      <VoiceCommand />
      <TableLabels />
      <MobileNav email={email} signOut={signOutAction} isAdmin={s.isAdmin} library={libraryOn} />
    </>
  );
}
