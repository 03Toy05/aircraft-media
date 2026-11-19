import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { devBypassEnabled } from "@/lib/owner";

const ERRORS: Record<string, string> = {
  not_invited: "That Google account hasn't been invited yet. Ask the admin to add your email.",
  blocked: "Access for this account has been turned off. Contact the admin.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (devBypassEnabled()) redirect("/");
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 420, margin: "12vh auto", padding: 16 }}>
      <div className="card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={48} height={48} />
        <h1>Aircraft Media</h1>
        <p className="muted">Sign in with the Google account you were invited with.</p>
        {error && <div className="flash err">{ERRORS[error] ?? "That Google account is not authorised."}</div>}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button type="submit">Sign in with Google</button>
        </form>
      </div>
    </main>
  );
}
