import Link from "next/link";
import { redirect } from "next/navigation";
import { devBypassEnabled } from "@/lib/owner";
import { getDb } from "@/db/client";
import { LINK_MINUTES, createSignInLink } from "@/domain/signInLinks";
import { sendMail } from "@/lib/mail";
import { siteAddress } from "@/lib/site";
import { serverT } from "@/lib/uiLang";
import SignInShell from "../SignInShell";

async function sendPasswordLinkAction(fd: FormData) {
  "use server";
  const email = String(fd.get("email") ?? "").trim();
  const token = await createSignInLink(await getDb(), email, "password");
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
  // The same answer whether or not the email was invited, so the form doesn't tell strangers who is.
  redirect(`/login/password?sent=${encodeURIComponent(email.toLowerCase())}`);
}

export default async function PasswordLinkPage({ searchParams }: { searchParams: Promise<{ email?: string; sent?: string; error?: string }> }) {
  if (devBypassEnabled()) redirect("/");
  const { email, sent, error } = await searchParams;
  const t = await serverT();
  return (
    <SignInShell
      title={t("Set your password")}
      intro={t("First time here, or forgot your password? We'll email you a link to set one.")}
      footer={{ privacy: t("Privacy"), terms: t("Terms") }}
    >
      {error === "mail" && <div className="flash err">{t("The email couldn't be sent just now. Try again in a minute.")}</div>}
      {sent && <div className="flash ok">{t("If {email} has been invited, the email is on its way. Check your inbox (and junk folder). The link works for {n} minutes.", { email: sent, n: LINK_MINUTES })}</div>}
      <form action={sendPasswordLinkAction} className="signin-form login-email">
        <label htmlFor="email">{t("Your email")}</label>
        <input id="email" name="email" type="email" required autoComplete="email" placeholder="name@company.com" defaultValue={sent ?? email ?? ""} />
        <button type="submit" className="signin-btn is-ink">{t("Email me a link")}</button>
      </form>
      <p className="signin-links"><Link href="/login">{t("Back to sign in")}</Link></p>
    </SignInShell>
  );
}
