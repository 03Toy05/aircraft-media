import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { devBypassEnabled } from "@/lib/owner";
import { getDb } from "@/db/client";
import { TRIAL_DAYS } from "@/domain/accounts";
import { startTrialWithNotice } from "@/lib/signupNotice";
import { LINK_MINUTES, createSignInLink } from "@/domain/signInLinks";
import { sendMail } from "@/lib/mail";
import { siteAddress } from "@/lib/site";
import { serverT } from "@/lib/uiLang";
import { LangSwitch } from "../_components/uiLang";

/** Email sign-up: makes the trial account (if new) and emails a link to set a password. Same answer either way. */
async function startWithEmailAction(fd: FormData) {
  "use server";
  if (String(fd.get("website") ?? "")) redirect("/start?sent=1"); // a bot filled the hidden field
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const db = await getDb();
  const r = await startTrialWithNotice(db, email, String(fd.get("name") ?? ""), "the free trial page");
  if (!r) redirect("/start?error=email");
  // A new application (or one still waiting): nothing to sign in with until an admin approves it.
  if (r.user.status === "applied") redirect(`/start?applied=${encodeURIComponent(email)}`);
  const token = r.user.status === "blocked" ? null : await createSignInLink(db, email, "password");
  if (token) {
    const site = await siteAddress();
    if (!site) { console.error("Set APP_URL to send sign-up links"); redirect("/start?error=mail"); }
    const link = `${site}/login/reset?token=${encodeURIComponent(token)}`;
    const intro = r.created ? `Welcome to Aircraft Media. Your ${TRIAL_DAYS}-day free trial starts when you first sign in.` : "You already have an Aircraft Media account.";
    try {
      await sendMail({
        to: email,
        subject: r.created ? "Start your Aircraft Media trial: set your password" : "Sign in to Aircraft Media",
        text: `${intro}\n\nOpen this link to set your password and sign in:\n\n${link}\n\nIt works once, for ${LINK_MINUTES} minutes. If you didn't ask for this, ignore this email.`,
        html: `<p>${intro}</p><p>Open this link to set your password and sign in:</p><p><a href="${link}">Set my password</a></p><p style="color:#666">It works once, for ${LINK_MINUTES} minutes. If you didn't ask for this, ignore this email.</p>`,
      });
    } catch (e) {
      console.error("Sign-up email failed", e);
      redirect("/start?error=mail");
    }
  }
  redirect(`/start?sent=${encodeURIComponent(email)}`);
}

async function startWithGoogleAction() {
  "use server";
  await signIn("google", { redirectTo: "/" });
}

/** "Start your 14-day free trial": open to anyone, no card. */
export default async function StartPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string; applied?: string }> }) {
  if (devBypassEnabled()) redirect("/");
  const { sent, error, applied } = await searchParams;
  const t = await serverT();
  return (
    <main style={{ maxWidth: 440, margin: "10vh auto", padding: 16 }}>
      <div className="card">
        <div style={{ float: "right" }}><LangSwitch /></div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={48} height={48} />
        <h1>{t("Start your {n}-day free trial", { n: TRIAL_DAYS })}</h1>
        <p className="muted">{t("Your own workspace and the shared aircraft library, free for {n} days. No card needed. Afterwards you can still look at and share everything you made.", { n: TRIAL_DAYS })}</p>
        {applied && <div className="flash ok">{t("Thanks for signing up! Your application is being reviewed; we'll email {email} as soon as it's approved.", { email: applied })}</div>}
        {error === "email" && <div className="flash err">{t("That doesn't look like an email address.")}</div>}
        {error === "mail" && <div className="flash err">{t("The email couldn't be sent just now. Try again in a minute.")}</div>}
        {sent && sent !== "1" && <div className="flash ok">{t("Check {email} for a link to set your password (and your junk folder). It works for {n} minutes.", { email: sent, n: LINK_MINUTES })}</div>}
        {sent === "1" && <div className="flash ok">{t("Check your email for a link to set your password.")}</div>}
        <form action={startWithGoogleAction}>
          <button type="submit" style={{ width: "100%" }}>{t("Start with Google")}</button>
        </form>
        <p className="small muted login-or">{t("or with your email")}</p>
        <form action={startWithEmailAction} className="login-email">
          <label htmlFor="name" className="small">{t("Your name")}</label>
          <input id="name" name="name" autoComplete="name" maxLength={80} />
          <label htmlFor="email" className="small">{t("Your work email")}</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="name@company.com" defaultValue={sent && sent !== "1" ? sent : ""} />
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }} />
          <button type="submit" className="secondary" style={{ width: "100%" }}>{t("Email me a link")}</button>
        </form>
        <p className="small muted" style={{ marginTop: 12 }}>
          {t("By starting a trial you agree to the")} <Link href="/terms">{t("Terms")}</Link> {t("and the")} <Link href="/privacy">{t("Privacy")}</Link> {t("notice.")}
        </p>
        <p className="small" style={{ margin: "6px 0 0" }}>{t("Already have an account?")} <Link href="/login">{t("Sign in")}</Link></p>
      </div>
    </main>
  );
}
