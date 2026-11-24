import Link from "next/link";

export const metadata = { title: "Privacy · Aircraft Media" };

/** Public: what Aircraft Media keeps about the people who use it, and why. */
export default function PrivacyPage() {
  return (
    <main className="legal">
      <p className="small"><Link href="/login">← Aircraft Media</Link></p>
      <h1>Privacy policy</h1>
      <p className="muted small">Last updated 24 November 2026</p>

      <p>
        Aircraft Media is a workspace for private-aviation charter brokers: they keep aircraft details and photos, and
        prepare quotes for their clients. Only people the Aircraft Media admin has invited can use it.
      </p>

      <h2>What we keep</h2>
      <ul>
        <li><b>Your account:</b> your email address, your name, and your settings (such as your language). If you set a password, we keep only a scrambled form of it (a hash), never the password itself.</li>
        <li><b>Signing in with Google:</b> we receive your name and email address from Google to confirm who you are. We do not see your Google password, and we don't read your Gmail, contacts or other Google data.</li>
        <li><b>Your work:</b> the operators, aircraft, photos, quotes and contacts you add.</li>
        <li><b>Technical records:</b> sign-in and activity records needed to keep the service running and secure.</li>
      </ul>

      <h2>Where it is kept</h2>
      <ul>
        <li>Account and aircraft details are kept in our database.</li>
        <li>Photos are stored in a Google Drive that belongs to Aircraft Media. The app's access to Google Drive is used only to store and show those photos.</li>
        <li>Emails from the app (for example, setting a password) are sent through our email provider, Resend.</li>
        <li>The website runs on Render.</li>
      </ul>

      <h2>What we don't do</h2>
      <ul>
        <li>We don't sell your information or use it for advertising.</li>
        <li>We don't share your workspace with other users, unless the admin shares library content with them or you send a quote or card yourself.</li>
      </ul>

      <h2>Google user data</h2>
      <p>
        Aircraft Media's use of information received from Google APIs follows the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>,
        including its Limited Use requirements.
      </p>

      <h2>Your choices</h2>
      <p>
        You can ask the Aircraft Media admin to correct or delete your account and what you added. When an account is
        turned off, it can no longer sign in.
      </p>

      <h2>Contact</h2>
      <p>For questions about this policy, contact the Aircraft Media admin who invited you.</p>

      <p className="small"><Link href="/terms">Terms of service</Link></p>
    </main>
  );
}
