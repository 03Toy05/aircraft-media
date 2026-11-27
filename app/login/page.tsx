import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError, CredentialsSignin } from "next-auth";
import { signIn } from "@/auth";
import { devBypassEnabled } from "@/lib/owner";
import { serverT } from "@/lib/uiLang";
import SignInShell from "./SignInShell";

const ERRORS: Record<string, string> = {
  not_invited: "That account hasn't been invited yet. Ask the admin to add your email.",
  blocked: "Access for this account has been turned off. Contact the admin.",
  pending: "Thanks for signing up! Your application is being reviewed; we'll email you as soon as it's approved.",
  wrong: "That email and password don't match. Check them, or set a new password below.",
  locked: "Too many wrong tries. Wait 15 minutes, or set a new password below.",
  link: "That link has expired or was already used. Ask for a new one.",
};

async function passwordSignInAction(fd: FormData) {
  "use server";
  const email = String(fd.get("email") ?? "").trim();
  try {
    await signIn("password", { email, password: String(fd.get("password") ?? ""), redirectTo: "/" });
  } catch (e) {
    if (e instanceof AuthError) {
      const why = e instanceof CredentialsSignin && e.code === "locked" ? "locked" : "wrong";
      redirect(`/login?error=${why}&email=${encodeURIComponent(email)}`);
    }
    throw e; // the redirect into the app
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; email?: string; ok?: string }> }) {
  if (devBypassEnabled()) redirect("/");
  const { error, email, ok } = await searchParams;
  const t = await serverT();
  return (
    <SignInShell
      toy="greeting"
      title={t("Welcome back")}
      intro={<>{t("Sign in to your workspace.")} <Link href="/start">{t("New here? Start your 14-day free trial")}</Link></>}
      footer={{ privacy: t("Privacy"), terms: t("Terms") }}
    >
      {ok === "deleted" && <div className="flash ok">{t("Your account and workspace have been deleted. Thank you for trying Aircraft Media.")}</div>}
      {error && <div className="flash err">{t(ERRORS[error] ?? "That account is not authorised.")}</div>}
      <form
        className="signin-form"
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button type="submit" className="signin-btn is-ink">
          <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z" /><path fill="currentColor" opacity=".85" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" /><path fill="currentColor" opacity=".7" d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9.1L6.4 14Z" /><path fill="currentColor" opacity=".55" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5L6.4 10C7.2 7.7 9.4 6 12 6Z" /></svg>
          {t("Sign in with Google")}
        </button>
      </form>
      <p className="signin-or">{t("or")}</p>
      <form action={passwordSignInAction} className="signin-form login-email">
        <label htmlFor="email">{t("Email")}</label>
        <input id="email" name="email" type="email" required autoComplete="email" placeholder="name@company.com" defaultValue={email ?? ""} />
        <label htmlFor="password">{t("Password")}</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" />
        <button type="submit" className="signin-btn is-outline">{t("Sign in")}</button>
      </form>
      <p className="signin-links">
        <Link href={`/login/password${email ? `?email=${encodeURIComponent(email)}` : ""}`}>{t("First time here, or forgot your password?")}</Link>
      </p>
    </SignInShell>
  );
}
