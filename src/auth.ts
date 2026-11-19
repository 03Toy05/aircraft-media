import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { eq } from "drizzle-orm";
import { isOwnerEmail } from "./lib/owner";
import { getDb } from "./db/client";
import { users } from "./db/schema";

// Reads AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  callbacks: {
    // Invite-only: the admin (OWNER_EMAIL) and anyone the admin invited, with a verified Google account.
    async signIn({ profile }) {
      if (profile?.email_verified !== true || !profile.email) return false;
      if (isOwnerEmail(profile.email)) return true;
      const [u] = await (await getDb()).select({ status: users.status }).from(users).where(eq(users.email, profile.email.trim().toLowerCase()));
      if (!u) return "/login?error=not_invited";
      if (u.status === "blocked") return "/login?error=blocked";
      return true;
    },
  },
});
