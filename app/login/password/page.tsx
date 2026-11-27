import Link from "next/link";
import { redirect } from "next/navigation";
import { devBypassEnabled } from "@/lib/owner";
import { getDb } from "@/db/client";
import { LINK_MINUTES, createSignInLink, looksLikeEmail, mayUseApp } from "@/domain/signInLinks";
import { startTrialWithNotice } from "@/lib/signupNotice";
import { sendMail } from "@/lib/mail";
import { siteAddress } from "@/lib/site";
import { serverT } from "@/lib/uiLang";
import SignInShell from "../SignInShell";

async function sendPasswordLinkAction(fd: FormData) {
  "use server";
  const email = String(fd.get("email") ?? "").trim();
  const db = await getDb();
  // Someone new (not on the list): this sends their application for a free trial, as the trial page does.
  if (looksLikeEmail(email.toLowerCase()) && (await mayUseApp(db, email)) === "not_invited") await startTrialWithNotice(db, email, null, "the sign-in page");
  // An application waiting for approval gets no link yet: say so.
  if ((await mayUseApp(db, email)) === "pending") redirect(`/login/password?applied=${encodeURIComponent(email.toLowerCase())}`);
  const token = await createSignInLink(db, email, "password");
  if (token) {
    const site = await siteAddress();
    if (!site) { console.error("Set APP_URL to send password links"); redirect("/login/password?error=mail"); }
    const link = `${site}/login/reset?token=${encodeURIComponent(token)}`;
    try {
      await sendMail({
        to: email,
        subject: "Set your Aircraft Media password",
        text: `Open this link to set your Aircraft Media password:\n\n${link}\n\nIt works once, for ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email; your password stays as it is.`,
        html: `<p>Open this link to set your Aircraft Media password:</p><p><a href="${link}">Set my password</a></p><p style="color:#666">It works once, for ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email; your password stays as it is.</p>`,
      });
    } catch (e) {
      console.error("Password email failed", e);
      redirect("/login/password?error=mail");
    }
  }
  // The same answer for everyone (a link is on its way), so the form doesn't tell strangers who has an account.
  redirect(`/login/password?sent=${encodeURIComponent(email.toLowerCase())}`);
}

export default async function PasswordLinkPage({ searchParams }: { searchParams: Promise<{ email?: string; sent?: string; error?: string; applied?: string }> }) {
  if (devBypassEnabled()) redirect("/");
  const { email, sent, error, applied } = await searchParams;
  const t = await serverT();
  return (
    <SignInShell
      title={t("Set your password")}
      intro={t("First time here, or forgot your password? We'll email you a link to set one.")}
      footer={{ privacy: t("Privacy"), terms: t("Terms") }}
    >
      {applied && <div className="flash ok">{t("Thanks for signing up! Your application is being reviewed; we'll email {email} as soon as it's approved.", { email: applied })}</div>}
      {error === "mail" && <div className="flash err">{t("The email couldn't be sent just now. Try again in a minute.")}</div>}
      {sent && <div className="flash ok">{t("The email to {email} is on its way. Check your inbox (and junk folder). The link works for {n} minutes.", { email: sent, n: LINK_MINUTES })}</div>}
      <form action={sendPasswordLinkAction} className="signin-form login-email">
        <label htmlFor="email">{t("Your email")}</label>
        <input id="email" name="email" type="email" required autoComplete="email" placeholder="name@company.com" defaultValue={sent ?? email ?? ""} />
        <button type="submit" className="signin-btn is-ink">{t("Email me a link")}</button>
      </form>
      <p className="signin-links"><Link href="/login">{t("Back to sign in")}</Link></p>
    </SignInShell>
  );
}
