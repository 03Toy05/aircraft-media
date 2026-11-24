import Link from "next/link";

export const metadata = { title: "Terms · Aircraft Media" };

/** Public: the terms for using Aircraft Media. */
export default function TermsPage() {
  return (
    <main className="legal">
      <p className="small"><Link href="/login">← Aircraft Media</Link></p>
      <h1>Terms of service</h1>
      <p className="muted small">Last updated 24 November 2026</p>

      <h2>Who can use it</h2>
      <p>
        Aircraft Media is for charter brokers invited by the Aircraft Media admin. Keep your sign-in to yourself; you
        are responsible for what is done with your account.
      </p>

      <h2>Your content</h2>
      <ul>
        <li>What you add stays yours. You let Aircraft Media store it and show it to you and to the people you choose to send it to.</li>
        <li>Only add photos and information you are allowed to use and share.</li>
      </ul>

      <h2>The library</h2>
      <p>
        Aircraft details and photos in the shared library are given for convenience. Check availability, specifications and
        prices with the operator before you confirm anything to a client.
      </p>

      <h2>The service</h2>
      <ul>
        <li>We work to keep Aircraft Media running and your data safe, but the service is provided as it is, without guarantees.</li>
        <li>Trial access ends on its end date unless extended. The admin can turn off an account that misuses the service.</li>
        <li>These terms may change; the date above shows the latest version.</li>
      </ul>

      <h2>Contact</h2>
      <p>For questions about these terms, contact the Aircraft Media admin who invited you.</p>

      <p className="small"><Link href="/privacy">Privacy policy</Link></p>
    </main>
  );
}
