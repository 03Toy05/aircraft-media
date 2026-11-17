import Link from "next/link";
import { requireOwner } from "@/lib/session";
import { signOutAction } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { email } = await requireOwner(); // redirects to /login unless the owner is signed in
  return (
    <>
      <nav className="top">
        <span className="brand" style={{ display: "flex", alignItems: "center", gap: 8 }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.svg" alt="" width={26} height={26} />Aircraft Media</span>
        <Link href="/">Dashboard</Link>
        <Link href="/catalogue">Catalogue</Link>
        <Link href="/intake">Intake</Link>
        <Link href="/review">Review</Link>
        <Link href="/aircraft">Aircraft</Link>
        <Link href="/organisations">Organisations</Link>
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
