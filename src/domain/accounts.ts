import { randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import { DomainError } from "./errors";

/** How long a new user may add and change things before their workspace becomes read-only. */
export const TRIAL_DAYS = 14;
const DAY = 86_400_000;

export type Plan = "trial" | "full";
export type AccountRow = typeof users.$inferSelect;

export interface AccessState {
  /** true when the user may look and share but not add or change anything */
  readOnly: boolean;
  /** days left in the trial, rounded up (1 on the last day, 0 once ended); null for full accounts and trials not started */
  daysLeft: number | null;
  expired: boolean;
}

/** Pure: what a user may do at `now`. */
export function accessFor(u: Pick<AccountRow, "plan" | "trialEndsAt" | "status">, now = new Date()): AccessState {
  if (u.status === "blocked") return { readOnly: true, daysLeft: null, expired: false };
  if (u.plan !== "trial" || !u.trialEndsAt) return { readOnly: false, daysLeft: null, expired: false };
  const ms = u.trialEndsAt.getTime() - now.getTime();
  if (ms <= 0) return { readOnly: true, daysLeft: 0, expired: true };
  return { readOnly: false, daysLeft: Math.ceil(ms / DAY), expired: false };
}

export function normalizeEmail(email: string): string | null {
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Admin: invite someone by their Google email. They get their own empty workspace; the trial starts at first sign-in. */
export async function inviteUser(db: Db, adminId: string, input: { email: string; plan: Plan; name?: string | null }) {
  const email = normalizeEmail(input.email);
  if (!email) throw new DomainError("BAD_EMAIL", "That doesn't look like an email address.");
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) throw new DomainError("ALREADY_INVITED", "{email} already has access.", undefined, { email });
  const [row] = await db
    .insert(users)
    .values({
      tenantId: randomUUID(),
      email,
      displayName: input.name?.trim() || email.split("@")[0],
      role: "owner",
      status: "invited",
      plan: input.plan,
      invitedBy: adminId,
    })
    .returning();
  return row;
}

/** First sign-in starts the trial clock; later sign-ins only record the time. */
export async function recordSignIn(db: Db, u: AccountRow, now = new Date()): Promise<AccountRow> {
  const first = u.status === "invited" || !u.firstSignInAt;
  const set: Partial<AccountRow> = { lastSignInAt: now, updatedAt: now };
  if (first) {
    set.firstSignInAt = u.firstSignInAt ?? now;
    if (u.status === "invited") set.status = "active";
    if (u.plan === "trial" && !u.trialEndsAt) set.trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * DAY);
  }
  const [row] = await db.update(users).set(set).where(eq(users.id, u.id)).returning();
  return row;
}

async function otherUser(db: Db, userId: string, adminEmail: string) {
  const [u] = await db.select().from(users).where(and(eq(users.id, userId), ne(users.email, adminEmail.toLowerCase())));
  if (!u) throw new DomainError("NOT_FOUND", "That user was not found.");
  return u;
}

/** Admin: add days to a trial (from today if it already ended), or start the clock now for someone not signed in yet. */
export async function extendTrial(db: Db, adminEmail: string, userId: string, days: number, now = new Date()) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new DomainError("BAD_DAYS", "Choose between 1 and 365 days.");
  const u = await otherUser(db, userId, adminEmail);
  const from = u.trialEndsAt && u.trialEndsAt > now ? u.trialEndsAt : now;
  await db.update(users).set({ plan: "trial", trialEndsAt: new Date(from.getTime() + days * DAY), updatedAt: now }).where(eq(users.id, u.id));
}

export async function setPlan(db: Db, adminEmail: string, userId: string, plan: Plan, now = new Date()) {
  const u = await otherUser(db, userId, adminEmail);
  const trialEndsAt = plan === "full" ? u.trialEndsAt : u.firstSignInAt ? new Date(now.getTime() + TRIAL_DAYS * DAY) : null;
  await db.update(users).set({ plan, trialEndsAt, updatedAt: now }).where(eq(users.id, u.id));
}

export async function setBlocked(db: Db, adminEmail: string, userId: string, blocked: boolean) {
  const u = await otherUser(db, userId, adminEmail);
  const status = blocked ? "blocked" : u.firstSignInAt ? "active" : "invited";
  await db.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, u.id));
}

/** Admin: withdraw an invitation nobody has used yet (a user who signed in is blocked instead, so their work is kept). */
export async function withdrawInvite(db: Db, adminEmail: string, userId: string) {
  const u = await otherUser(db, userId, adminEmail);
  if (u.firstSignInAt) throw new DomainError("IN_USE", "This person has already signed in. Block them instead; their work is kept.");
  await db.delete(users).where(and(eq(users.id, u.id), sql`${users.firstSignInAt} is null`));
}
