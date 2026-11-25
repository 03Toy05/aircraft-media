import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { FIXED_TENANT_ID } from "@/domain/constants";
import { accessFor, recordSignIn } from "@/domain/accounts";
import { DomainError } from "@/domain/errors";
import type { Actor } from "@/domain/action";
import { devBypassEnabled, isOwnerEmail } from "./owner";

/** Cookie the admin sets to look at another user's workspace (read-only). */
export const VIEW_AS_COOKIE = "am_view_as";
/** Local development only: act as this email instead of the owner (see devBypassEnabled). */
export const DEV_AS_COOKIE = "am_dev_as";

export interface Session {
  actor: Actor;
  email: string;
  /** The platform admin (OWNER_EMAIL). */
  isAdmin: boolean;
  /** true when the trial has ended, or the admin is looking at someone else's workspace */
  readOnly: boolean;
  /** Days left in a trial, else null. */
  daysLeft: number | null;
  trialEnded: boolean;
  /** Set while the admin looks at another user's workspace. */
  viewingAs: { userId: string; email: string } | null;
}

async function signedInEmail(): Promise<string | null> {
  if (devBypassEnabled()) {
    const as = (await cookies()).get(DEV_AS_COOKIE)?.value;
    return (as || process.env.OWNER_EMAIL || "owner@localhost").toLowerCase();
  }
  const session = await auth();
  return session?.user?.email?.toLowerCase() ?? null;
}

/**
 * Every page and server action starts here: authenticate, find the user's own workspace (tenant), and work out
 * whether they may change things. Redirects to /login when nobody (or nobody allowed) is signed in.
 * Cached per request, so pages and the layout share one lookup.
 */
export const requireUser = cache(async (): Promise<Session> => {
  const email = await signedInEmail();
  if (!email) redirect("/login");
  const db = await getDb();
  const isAdmin = isOwnerEmail(email) || (devBypassEnabled() && email === (process.env.OWNER_EMAIL || "owner@localhost").toLowerCase());

  let [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u && isAdmin) {
    // The admin's workspace is the original one, so everything added before accounts existed stays theirs.
    [u] = await db
      .insert(users)
      .values({ tenantId: FIXED_TENANT_ID, email, displayName: email.split("@")[0], role: "owner", plan: "full" })
      .onConflictDoNothing()
      .returning();
    u ??= (await db.select().from(users).where(eq(users.email, email)))[0];
  }
  if (!u) redirect("/login?error=not_invited");
  if (u.status === "blocked" && !isAdmin) redirect("/login?error=blocked");
  if (u.status === "invited" || !u.lastSignInAt || Date.now() - u.lastSignInAt.getTime() > 3_600_000) u = await recordSignIn(db, u);

  const access = isAdmin ? { readOnly: false, daysLeft: null, expired: false } : accessFor(u);
  let session: Session = {
    actor: { id: u.id, tenantId: u.tenantId },
    email,
    isAdmin,
    readOnly: access.readOnly,
    daysLeft: access.daysLeft,
    trialEnded: access.expired,
    viewingAs: null,
  };
  if (isAdmin) {
    const viewId = (await cookies()).get(VIEW_AS_COOKIE)?.value;
    if (viewId && /^[0-9a-f-]{36}$/.test(viewId) && viewId !== u.id) {
      const [other] = await db.select().from(users).where(and(eq(users.id, viewId)));
      if (other) session = { ...session, actor: { id: u.id, tenantId: other.tenantId }, readOnly: true, viewingAs: { userId: other.id, email: other.email } };
    }
  }
  return session;
});

/** Kept for the existing pages: each signed-in user owns their own workspace. */
export async function requireOwner(): Promise<Session> {
  return requireUser();
}

/** For anything that adds or changes data. */
export async function requireWriter(): Promise<Session> {
  const s = await requireUser();
  if (s.viewingAs) throw new DomainError("READ_ONLY", "You are looking at {email}'s workspace. Go back to your own to make changes.", undefined, { email: s.viewingAs.email });
  if (s.readOnly) throw new DomainError("TRIAL_ENDED", "Your 14-day trial has ended, so you can look and share but not add or change anything. Ask the admin to extend it.");
  return s;
}

/** Platform admin only. */
export async function requireAdmin(): Promise<Session> {
  const s = await requireUser();
  if (!s.isAdmin) redirect("/");
  return s;
}
