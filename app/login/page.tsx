import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { devBypassEnabled } from "@/lib/owner";
import { getDb } from "@/db/client";
import { LINK_MINUTES, createSignInLink } from "@/domain/signInLinks";
import { sendMail } from "@/lib/mail";

const ERRORS: Record<string, string> = {
  not_invited: "That account hasn't been invited yet. Ask the admin to add your email.",
  blocked: "Access for this account has been turned off. Contact the admin.",
  link: "That sign-in link has expired or was already used. Ask for a new one below.",
  mail: "The sign-in email couldn't be sent just now. Try again in a minute, or sign in with Google.",
};

async function emailLinkAction(fd: FormData) {
  "use server";
  const email = String(fd.get("email") ?? "");
  const token = await createSignInLink(await getDb(), email);
  if (token) {
    // The site's own address (Render sets RENDER_EXTERNAL_URL), never one taken from the request: a faked request
    // must not get a working link sent to someone pointing at another site.
    let site = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "";
    if (!site && process.env.NODE_ENV !== "production") { const h = await headers(); site = `http://${h.get("host")}`; }
    if (!site) { console.error("Set APP_URL to send sign-in links"); redirect("/login?error=mail"); }
    site = site.replace(/\/+$/, "");
    const link = `${site}/login/link?token=${encodeURIComponent(token)}`;
    try {
      await sendMail({
        to: email.trim(),
        subject: "Your Aircraft Media sign-in link",
        text: `Open this link to sign in to Aircraft Media:\n\n${link}\n\nIt works once, for ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
        html: `<p>Open this link to sign in to Aircraft Media:</p><p><a href="${link}">Sign in to Aircraft Media</a></p><p style="color:#666">It works once, for ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.</p>`,
      });
    } catch (e) {
      console.error("Sign-in email failed", e);
      redirect("/login?error=mail");
    }
  }
  // The same answer whether or not the email was invited, so the form doesn't tell strangers who is.
  redirect(`/login?sent=${encodeURIComponent(email.trim().toLowerCase())}`);
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  if (devBypassEnabled()) redirect("/");
  const { error, sent } = await searchParams;
  return (
    <main style={{ maxWidth: 420, margin: "12vh auto", padding: 16 }}>
      <div className="card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={48} height={48} />
        <h1>Aircraft Media</h1>
        <p className="muted">Sign in with the email you were invited with.</p>
        {error && <div className="flash err">{ERRORS[error] ?? "That account is not authorised."}</div>}
        {sent && <div className="flash ok">If <b>{sent}</b> has been invited, a sign-in link is on its way. Check your inbox (and junk folder). It works for {LINK_MINUTES} minutes.</div>}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button type="submit" style={{ width: "100%" }}>Sign in with Google</button>
        </form>
        <p className="small muted login-or">or, with any other email</p>
        <form action={emailLinkAction} className="login-email">
          <label htmlFor="email" className="small">Your email</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="name@company.com" defaultValue={sent ?? ""} />
          <button type="submit" className="secondary" style={{ width: "100%" }}>Email me a sign-in link</button>
        </form>
      </div>
    </main>
  );
}
