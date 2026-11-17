import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { FIXED_TENANT_ID } from "@/domain/constants";
import type { Actor } from "@/domain/action";
import { devBypassEnabled, isOwnerEmail } from "./owner";

/**
 * Every page and server action starts here: authenticate, resolve tenant scope, confirm owner.
 * Returns the actor recorded as actor_id on every mutation.
 */
export async function requireOwner(): Promise<{ actor: Actor; email: string }> {
  let email: string | null | undefined;
  if (devBypassEnabled()) {
    email = process.env.OWNER_EMAIL || "owner@localhost";
  } else {
    const session = await auth();
    email = session?.user?.email;
    if (!isOwnerEmail(email)) redirect("/login");
  }
  const db = await getDb();
  const e = email!.toLowerCase();
  const [existing] = await db.select().from(users).where(and(eq(users.tenantId, FIXED_TENANT_ID), eq(users.email, e)));
  let id = existing?.id;
  if (!id) {
    const [row] = await db
      .insert(users)
      .values({ tenantId: FIXED_TENANT_ID, email: e, displayName: e.split("@")[0], role: "owner" })
      .onConflictDoNothing()
      .returning({ id: users.id });
    id = row?.id ?? (await db.select().from(users).where(and(eq(users.tenantId, FIXED_TENANT_ID), eq(users.email, e))))[0].id;
  }
  return { actor: { id, tenantId: FIXED_TENANT_ID }, email: e };
}
