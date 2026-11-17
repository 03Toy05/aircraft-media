import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { devBypassEnabled } from "@/lib/owner";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (devBypassEnabled()) redirect("/");
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 420, margin: "12vh auto", padding: 16 }}>
      <div className="card">
        <h1>Aircraft Media</h1>
        <p className="muted">Private application. Sign in with the owner&apos;s Google account.</p>
        {error && <div className="flash err">That Google account is not authorised.</div>}
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
