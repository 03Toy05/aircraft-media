import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import { cleanEmail, mayUseApp } from "./signInLinks";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const MIN_PASSWORD = 8;
/** Wrong passwords in a row before the account waits LOCK_MINUTES (stops guessing). */
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

/** Why a new password can't be used, or null when it's fine. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 200) return "That password is too long.";
  if (/^\s|\s$/.test(pw)) return "A password can't start or end with a space.";
  return null;
}

/** "scrypt$<salt>$<hash>", both base64. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function passwordMatches(pw: string, stored: string): Promise<boolean> {
  const [kind, salt, key] = stored.split("$");
  if (kind !== "scrypt" || !salt || !key) return false;
  const want = Buffer.from(key, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Sets (or replaces) someone's password and clears any lock. False when there is no such person or it isn't allowed. */
export async function setPassword(db: Db, emailRaw: string, pw: string): Promise<boolean> {
  if (passwordProblem(pw)) return false;
  const email = cleanEmail(emailRaw);
  const done = await db.update(users).set({ passwordHash: await hashPassword(pw), passwordFailures: 0, passwordLockedUntil: null, updatedAt: new Date() })
    .where(eq(users.email, email)).returning({ id: users.id });
  return done.length > 0;
}

/**
 * Checks an email and password. "ok" with the email; "locked" after too many wrong tries (for LOCK_MINUTES);
 * otherwise "wrong" (also for unknown emails, people turned off, or no password set, so nothing is given away).
 */
export async function checkPassword(db: Db, emailRaw: string, pw: string, now = new Date()): Promise<{ result: "ok"; email: string } | { result: "wrong" | "locked" }> {
  const email = cleanEmail(emailRaw);
  if (!email || !pw || pw.length > 200) return { result: "wrong" };
  const [u] = await db.select({ id: users.id, hash: users.passwordHash, failures: users.passwordFailures, lockedUntil: users.passwordLockedUntil })
    .from(users).where(eq(users.email, email));
  if (!u?.hash) {
    // Same time as a real check, so unknown emails can't be told apart by how fast the answer comes.
    await scrypt(pw, randomBytes(16), 64);
    return { result: "wrong" };
  }
  if (u.lockedUntil && u.lockedUntil > now) return { result: "locked" };
  if (!(await passwordMatches(pw, u.hash))) {
    const failures = u.failures + 1;
    await db.update(users).set(failures >= MAX_FAILURES
      ? { passwordFailures: 0, passwordLockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) }
      : { passwordFailures: failures }).where(eq(users.id, u.id));
    return { result: failures >= MAX_FAILURES ? "locked" : "wrong" };
  }
  if (u.failures || u.lockedUntil) await db.update(users).set({ passwordFailures: 0, passwordLockedUntil: null }).where(eq(users.id, u.id));
  if ((await mayUseApp(db, email)) !== "ok") return { result: "wrong" };
  return { result: "ok", email };
}

/** Whether this person has a password yet (the Settings page offers "Set" or "Change"). */
export async function hasPassword(db: Db, emailRaw: string): Promise<boolean> {
  const [u] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.email, cleanEmail(emailRaw)));
  return !!u?.hash;
}
