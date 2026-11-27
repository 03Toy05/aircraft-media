import NextAuth, { CredentialsSignin } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { getDb } from "./db/client";
import { mayUseApp } from "./domain/signInLinks";
import { checkPassword } from "./domain/passwords";
import { startTrialWithNotice } from "./lib/signupNotice";

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
    // The admin (OWNER_EMAIL), people the admin invited, and anyone who starts a free trial: with a verified Google
    // account (a new one starts its trial here) or a password (set from an emailed link after /start or an invite).
    async signIn({ account, profile, user }) {
      let email: string | null | undefined;
      if (account?.provider === "password") email = user.email;
      else if (profile?.email_verified === true) email = profile.email;
      if (!email) return false;
      const db = await getDb();
      let ok = await mayUseApp(db, email);
      if (ok === "not_invited" && account?.provider === "google") {
        await startTrialWithNotice(db, email, typeof profile?.name === "string" ? profile.name : null, "Google"); // an application, until approved
        ok = await mayUseApp(db, email);
      }
      return ok === "ok" ? true : `/login?error=${ok}`;
    },
  },
});
