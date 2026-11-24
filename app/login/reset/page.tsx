import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { devBypassEnabled } from "@/lib/owner";
import { getDb } from "@/db/client";
import { consumeSignInLink, peekSignInLink } from "@/domain/signInLinks";
import { MIN_PASSWORD, passwordProblem, setPassword } from "@/domain/passwords";

/**
 * The page an emailed password link opens: choose a password, then straight into the app. Opening the page doesn't
 * use the link up (some mail systems open links to check them); saving the password does.
 */
async function setPasswordAction(fd: FormData) {
  "use server";
  const token = String(fd.get("token") ?? "");
  const pw = String(fd.get("password") ?? "");
  const back = (why: string) => redirect(`/login/reset?token=${encodeURIComponent(token)}&error=${why}`);
  if (pw !== String(fd.get("again") ?? "")) back("match");
  if (passwordProblem(pw)) back("weak");
  const db = await getDb();
  const email = await consumeSignInLink(db, token, "password");
  if (!email) redirect("/login?error=link");
  if (!(await setPassword(db, email, pw))) redirect("/login?error=not_invited");
  await signIn("password", { email, password: pw, redirectTo: "/" });
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  if (devBypassEnabled()) redirect("/");
  const { token, error } = await searchParams;
  const email = token ? await peekSignInLink(await getDb(), token, "password") : null;
  if (!token || !email) redirect("/login?error=link");
  return (
    <main style={{ maxWidth: 420, margin: "12vh auto", padding: 16 }}>
      <div className="card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={48} height={48} />
        <h1>Set your password</h1>
        <p className="muted">For <b>{email}</b>. At least {MIN_PASSWORD} characters.</p>
        {error === "match" && <div className="flash err">The two passwords aren&apos;t the same. Type them again.</div>}
        {error === "weak" && <div className="flash err">Use at least {MIN_PASSWORD} characters, without a space at the start or end.</div>}
        <form action={setPasswordAction} className="login-email">
          <input type="hidden" name="token" value={token} />
          {/* The email, for password managers to save with the new password. */}
          <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
          <label htmlFor="password" className="small">New password</label>
          <input id="password" name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" />
          <label htmlFor="again" className="small">Type it again</label>
          <input id="again" name="again" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" />
          <button type="submit" style={{ width: "100%" }}>Save password and sign in</button>
        </form>
        <p className="small" style={{ margin: "10px 0 0" }}><Link href="/login">Back to sign in</Link></p>
      </div>
    </main>
  );
}
