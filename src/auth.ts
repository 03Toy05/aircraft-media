import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isOwnerEmail } from "./lib/owner";

// Reads AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  callbacks: {
    // Private app: only the configured owner's verified Google account may sign in.
    signIn({ profile }) {
      return profile?.email_verified === true && isOwnerEmail(profile.email);
    },
  },
});
