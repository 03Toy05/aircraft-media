import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError, CredentialsSignin } from "next-auth";
import { signIn } from "@/auth";
import { devBypassEnabled } from "@/lib/owner";

const ERRORS: Record<string, string> = {
  not_invited: "That account hasn't been invited yet. Ask the admin to add your email.",
  blocked: "Access for this account has been turned off. Contact the admin.",
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

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; email?: string }> }) {
  if (devBypassEnabled()) redirect("/");
  const { error, email } = await searchParams;
  return (
    <main style={{ maxWidth: 420, margin: "12vh auto", padding: 16 }}>
      <div className="card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={48} height={48} />
        <h1>Aircraft Media</h1>
        <p className="muted">Sign in with the email you were invited with.</p>
        {error && <div className="flash err">{ERRORS[error] ?? "That account is not authorised."}</div>}
        <form action={passwordSignInAction} className="login-email">
          <label htmlFor="email" className="small">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="name@company.com" defaultValue={email ?? ""} />
          <label htmlFor="password" className="small">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" />
          <button type="submit" style={{ width: "100%" }}>Sign in</button>
        </form>
        <p className="small" style={{ margin: "10px 0 0" }}>
          <Link href={`/login/password${email ? `?email=${encodeURIComponent(email)}` : ""}`}>First time here, or forgot your password?</Link>
        </p>
        <p className="small muted login-or">or</p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button type="submit" className="secondary" style={{ width: "100%" }}>Sign in with Google</button>
        </form>
      </div>
    </main>
  );
}
