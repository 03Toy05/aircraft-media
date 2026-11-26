import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import { normalizeEmail, type AccountRow } from "./accounts";

/**
 * Self sign-up for the free trial: anyone can start one with their email (then sets a password from an emailed link)
 * or their Google account. They get their own empty workspace, the shared library, and the 14-day clock starts at
 * their first sign-in (accounts.recordSignIn). No card. At the end it becomes look-only, as for invited trials.
 */
export async function startTrial(db: Db, emailRaw: string, name?: string | null, now = new Date()): Promise<{ user: AccountRow; created: boolean } | null> {
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
      status: "invited",
      plan: "trial",
      libraryAccess: true,
      signedUpAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return { user: row, created: true };
  const [again] = await db.select().from(users).where(eq(users.email, email));
  return again ? { user: again, created: false } : null;
}
