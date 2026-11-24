import NextAuth, { CredentialsSignin } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { getDb } from "./db/client";
import { mayUseApp } from "./domain/signInLinks";
import { checkPassword } from "./domain/passwords";

/** Too many wrong passwords: the sign-in page says to wait (or reset it). */
class LockedSignin extends CredentialsSignin { code = "locked"; }

// Reads AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google,
    // Email and password, for people who don't sign in with Google (set by an emailed link, see /login/password).
    Credentials({
      id: "password",
      credentials: { email: {}, password: {} },
      async authorize(c) {
        const r = await checkPassword(await getDb(), String(c?.email ?? ""), String(c?.password ?? ""));
        if (r.result === "locked") throw new LockedSignin();
        return r.result === "ok" ? { id: r.email, email: r.email } : null;
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  callbacks: {
    // Invite-only: the admin (OWNER_EMAIL) and anyone the admin invited, with a verified Google account or their
    // password (only invited people can set one).
    async signIn({ account, profile, user }) {
      let email: string | null | undefined;
      if (account?.provider === "password") email = user.email;
      else if (profile?.email_verified === true) email = profile.email;
      if (!email) return false;
      const ok = await mayUseApp(await getDb(), email);
      return ok === "ok" ? true : `/login?error=${ok}`;
    },
  },
});
