import Link from "next/link";
import { requireOwner } from "@/lib/session";
import { getDb } from "@/db/client";
import { loadStandardAircraftTypes } from "@/domain/directory";
import { STANDARD_LIST_VERSION } from "@/domain/standardTypes";
import { signOutAction } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { email, actor } = await requireOwner(); // redirects to /login unless the owner is signed in
  // The standard aircraft types are loaded once per list version (a recorded no-op afterwards); a failure here must not block the app.
  try {
    await loadStandardAircraftTypes(await getDb(), actor, `auto:${STANDARD_LIST_VERSION}`);
  } catch (e) {
    console.error("Could not load standard aircraft types", e);
  }
  return (
    <>
      <nav className="top">
        <span className="brand" style={{ display: "flex", alignItems: "center", gap: 8 }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.svg" alt="" width={26} height={26} />Aircraft Media</span>
        <Link href="/">Dashboard</Link>
        <Link href="/catalogue">Catalogue</Link>
        <Link href="/chat">Chocks</Link>
        <Link href="/intake">Intake</Link>
        <Link href="/review">Review</Link>
        <Link href="/aircraft">Aircraft</Link>
        <Link href="/organisations">Operators</Link>
        <Link href="/settings">Settings</Link>
        <span className="spacer" />
        <span className="muted small">{email}</span>
        <form action={signOutAction}>
          <button className="secondary" type="submit">Sign out</button>
        </form>
      </nav>
      <main>{children}</main>
    </>
  );
}
