import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import { normalizeEmail, type AccountRow } from "./accounts";

/**
 * Self sign-up for the free trial: anyone can apply with their email or their Google account. The application waits
 * for an admin's approval (status "applied"); once approved they get their own empty workspace and the shared library,
 * and the 14-day clock starts at their first sign-in (accounts.recordSignIn). No card. People the admin invites skip this.
 */
export async function startTrial(db: Db, emailRaw: string, name?: string | null, now = new Date(), via: "google" | "email" = "email"): Promise<{ user: AccountRow; created: boolean } | null> {
  const email = normalizeEmail(emailRaw);
  if (!email) return null;
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return { user: existing, created: false };
  const [row] = await db
    .insert(users)
    .values({
      tenantId: randomUUID(),
      email,
      displayName: name?.trim().slice(0, 80) || email.split("@")[0],
      role: "owner",
      status: "applied",
      plan: "trial",
      libraryAccess: true,
      signedUpAt: now,
      signupVia: via,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return { user: row, created: true };
  const [again] = await db.select().from(users).where(eq(users.email, email));
  return again ? { user: again, created: false } : null;
}
