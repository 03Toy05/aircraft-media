import { requireUser } from "@/lib/session";
import { getDb } from "@/db/client";
import { loadStandardAircraftTypes } from "@/domain/directory";
import { hasLibraryAccess } from "@/domain/library";
import { STANDARD_LIST_VERSION } from "@/domain/standardTypes";
import { signOutAction, stopViewingAction } from "../actions";
import MobileNav from "../_components/MobileNav";
import TopNav from "../_components/TopNav";
import { Suspense } from "react";
import { SpeedTracker } from "../_components/SpeedTracker";
import VoiceCommand from "../_components/VoiceCommand";
import TableLabels from "../_components/TableLabels";
import BusyHints from "../_components/BusyHints";
import { serverT } from "@/lib/uiLang";
import { after } from "next/server";
import { maybeSendDueEmails } from "@/domain/userEmails";
import { maybeRecheckUnavailable } from "@/domain/media";
import { getFileStore } from "@/storage";
import { sendMail } from "@/lib/mail";
import { siteAddress } from "@/lib/site";

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
  // Welcome and trial-ending emails go out from ordinary page loads (at most every 15 minutes), after the page is sent.
  const site = await siteAddress().catch(() => null);
  after(async () => maybeSendDueEmails(await getDb(), site, sendMail));
  // Photos whose file couldn't be read (storage was down for a while) are read again, so they come back by themselves.
  after(async () => maybeRecheckUnavailable(await getDb(), getFileStore()));
  let libraryOn = s.isAdmin;
  try { libraryOn = await hasLibraryAccess(await getDb(), s); } catch { /* the menu must not fail */ }
  return (
    <>
      <TopNav
        email={email}
        signOut={signOutAction}
        isAdmin={s.isAdmin}
        library={libraryOn}
        trial={!s.viewingAs && !s.trialEnded && s.daysLeft !== null ? (s.daysLeft <= 1 ? t("Trial: last day") : t("Trial: {n} days left", { n: s.daysLeft })) : null}
      />
      {s.viewingAs ? (
        <div className="account-bar view">
          <span>{t("Looking at the workspace of")} <b>{s.viewingAs.email}</b> {t("(read-only)")}</span>
          <form action={stopViewingAction}><button type="submit" className="small-btn">{t("Back to my workspace")}</button></form>
        </div>
      ) : s.cancelled ? (
        <div className="account-bar ended">{t("Your account is cancelled, so your workspace is read-only.")} <a href="/settings#account">{t("Reopen it")}</a></div>
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
