import Link from "next/link";
import { redirect } from "next/navigation";
import { devBypassEnabled } from "@/lib/owner";
import { getDb } from "@/db/client";
import { LINK_MINUTES, createSignInLink } from "@/domain/signInLinks";
import { sendMail } from "@/lib/mail";
import { siteAddress } from "@/lib/site";

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
  return (
    <main style={{ maxWidth: 420, margin: "12vh auto", padding: 16 }}>
      <div className="card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={48} height={48} />
        <h1>Set your password</h1>
        <p className="muted">First time here, or forgot your password? We&apos;ll email you a link to set one.</p>
        {error === "mail" && <div className="flash err">The email couldn&apos;t be sent just now. Try again in a minute.</div>}
        {sent && <div className="flash ok">If <b>{sent}</b> has been invited, the email is on its way. Check your inbox (and junk folder). The link works for {LINK_MINUTES} minutes.</div>}
        <form action={sendPasswordLinkAction} className="login-email">
          <label htmlFor="email" className="small">Your email</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="name@company.com" defaultValue={sent ?? email ?? ""} />
          <button type="submit" style={{ width: "100%" }}>Email me a link</button>
        </form>
        <p className="small" style={{ margin: "10px 0 0" }}><Link href="/login">Back to sign in</Link></p>
      </div>
    </main>
  );
}
