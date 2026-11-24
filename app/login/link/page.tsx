import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";

/**
 * The page an emailed sign-in link opens. Signing in needs a press of the button: some mail systems open links
 * to check them, and that alone must not use the link up.
 */
async function finishSignInAction(fd: FormData) {
  "use server";
  try {
    await signIn("email-link", { token: String(fd.get("token") ?? ""), redirectTo: "/" });
  } catch (e) {
    if (e instanceof AuthError) redirect("/login?error=link");
    throw e; // the redirect into the app
  }
}

export default async function SignInLinkPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect("/login");
  return (
    <main style={{ maxWidth: 420, margin: "12vh auto", padding: 16 }}>
      <div className="card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={48} height={48} />
        <h1>Aircraft Media</h1>
        <p className="muted">Press the button to finish signing in.</p>
        <form action={finishSignInAction}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" style={{ width: "100%" }}>Sign in</button>
        </form>
      </div>
    </main>
  );
}
