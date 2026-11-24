import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { getDb } from "./db/client";
import { mayUseApp, consumeSignInLink } from "./domain/signInLinks";

// Reads AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google,
    // An emailed sign-in link (for people who don't use Google): the link's secret is checked and used up here.
    Credentials({
      id: "email-link",
      credentials: { token: {} },
      async authorize(c) {
        const email = await consumeSignInLink(await getDb(), String(c?.token ?? ""));
        return email ? { id: email, email } : null;
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  callbacks: {
    // Invite-only: the admin (OWNER_EMAIL) and anyone the admin invited, with a verified Google account or an
    // emailed link (which proves the email, and was only sent to invited people).
    async signIn({ account, profile, user }) {
      let email: string | null | undefined;
      if (account?.provider === "email-link") email = user.email;
      else if (profile?.email_verified === true) email = profile.email;
      if (!email) return false;
      const ok = await mayUseApp(await getDb(), email);
      return ok === "ok" ? true : `/login?error=${ok}`;
    },
  },
});
