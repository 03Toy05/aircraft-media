import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getDb } from "@/db/client";
import { loadStandardAircraftTypes } from "@/domain/directory";
import { STANDARD_LIST_VERSION } from "@/domain/standardTypes";
import { signOutAction, stopViewingAction } from "../actions";
import Icon from "../_components/Icon";
import MobileNav from "../_components/MobileNav";
import VoiceCommand from "../_components/VoiceCommand";
import TableLabels from "../_components/TableLabels";

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
  return (
    <>
      <nav className="top">
        <span className="brand" style={{ display: "flex", alignItems: "center", gap: 8 }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.svg" alt="" width={26} height={26} />Aircraft Media</span>
        <Link href="/"><Icon name="home" />Dashboard</Link>
        <Link href="/review"><Icon name="review" />Review</Link>
        <Link href="/fleet"><Icon name="plane" />Operators &amp; aircraft</Link>
        <Link href="/quote"><Icon name="quote" />Quote</Link>
        <Link href="/contacts"><Icon name="contacts" />Contacts</Link>
        <Link href="/settings"><Icon name="settings" />Settings</Link>
        {s.isAdmin && <Link href="/library"><Icon name="plane" />Library</Link>}
        {s.isAdmin && <Link href="/admin"><Icon name="contacts" />Users</Link>}
        <span className="spacer" />
        <span className="muted small">{email}</span>
        <form action={signOutAction}>
          <button className="secondary" type="submit"><Icon name="signout" />Sign out</button>
        </form>
      </nav>
      {s.viewingAs ? (
        <div className="account-bar view">
          <span>Looking at <b>{s.viewingAs.email}</b>&apos;s workspace (read-only)</span>
          <form action={stopViewingAction}><button type="submit" className="small-btn">Back to my workspace</button></form>
        </div>
      ) : s.trialEnded ? (
        <div className="account-bar ended">Your 14-day trial has ended. You can still look and share, but not add or change anything. Ask the admin to extend it.</div>
      ) : s.daysLeft !== null ? (
        <div className="account-bar">Trial: {s.daysLeft <= 1 ? "last day" : `${s.daysLeft} days left`}</div>
      ) : null}
      <main>{children}</main>
      <VoiceCommand />
      <TableLabels />
      <MobileNav email={email} signOut={signOutAction} isAdmin={s.isAdmin} />
    </>
  );
}
