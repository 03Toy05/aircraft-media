import Link from "next/link";
import type { Metadata } from "next";
import { serverT } from "@/lib/uiLang";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Privacy · Aircraft Media") };
}

/** Public: what Aircraft Media keeps about the people who use it, and why. */
export default async function PrivacyPage() {
  const t = await serverT();
  return (
    <main className="legal">
      <p className="small"><Link href="/login">← Aircraft Media</Link></p>
      <h1>{t("Privacy policy")}</h1>
      <p className="muted small">{t("Last updated 24 November 2026")}</p>

      <p>
        {t("Aircraft Media is a workspace for private-aviation charter brokers: they keep aircraft details and photos, and prepare quotes for their clients. Only people the Aircraft Media admin has invited can use it.")}
      </p>

      <h2>{t("What we keep")}</h2>
      <ul>
        <li><b>{t("Your account:")}</b> {t("your email address, your name, and your settings (such as your language). If you set a password, we keep only a scrambled form of it (a hash), never the password itself.")}</li>
        <li><b>{t("Signing in with Google:")}</b> {t("we receive your name and email address from Google to confirm who you are. We do not see your Google password, and we don't read your Gmail, contacts or other Google data.")}</li>
        <li><b>{t("Your work:")}</b> {t("the operators, aircraft, photos, quotes and contacts you add.")}</li>
        <li><b>{t("Technical records:")}</b> {t("sign-in and activity records needed to keep the service running and secure.")}</li>
      </ul>

      <h2>{t("Where it is kept")}</h2>
      <ul>
        <li>{t("Account and aircraft details are kept in our database.")}</li>
        <li>{t("Photos are stored in a Google Drive that belongs to Aircraft Media. The app's access to Google Drive is used only to store and show those photos.")}</li>
        <li>{t("Emails from the app (for example, setting a password) are sent through our email provider, Resend.")}</li>
        <li>{t("The website runs on Render.")}</li>
      </ul>

      <h2>{t("What we don't do")}</h2>
      <ul>
        <li>{t("We don't sell your information or use it for advertising.")}</li>
        <li>{t("We don't share your workspace with other users, unless the admin shares library content with them or you send a quote or card yourself.")}</li>
      </ul>

      <h2>{t("Google user data")}</h2>
      <p>
        {t("Aircraft Media's use of information received from Google APIs follows the")}{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">{t("Google API Services User Data Policy")}</a>
        {t(", including its Limited Use requirements.")}
      </p>

      <h2>{t("Your choices")}</h2>
      <p>
        {t("You can ask the Aircraft Media admin to correct or delete your account and what you added. When an account is turned off, it can no longer sign in.")}
      </p>

      <h2>{t("Contact")}</h2>
      <p>{t("For questions about this policy, contact the Aircraft Media admin who invited you.")}</p>

      <p className="small"><Link href="/terms">{t("Terms of service")}</Link></p>
    </main>
  );
}
