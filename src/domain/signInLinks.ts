import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { signInLinks, users } from "../db/schema";
import { isOwnerEmail } from "../lib/owner";

/**
 * Sign-in by emailed link, for invited people who don't sign in with Google. The link holds a random secret; only
 * its hash is stored. A link works once, within LINK_MINUTES, and only for an email the admin invited (or the admin).
 */
export const LINK_MINUTES = 20;
/** At most this many links per email in a quarter of an hour (stops the form being used to flood someone's inbox). */
const MAX_LINKS = 3;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const cleanEmail = (email: string) => email.trim().toLowerCase();
const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

/** Whether this email may sign in at all: the admin, or someone invited and not turned off. */
export async function mayUseApp(db: Db, email: string): Promise<"ok" | "not_invited" | "blocked"> {
  const e = cleanEmail(email);
  if (isOwnerEmail(e)) return "ok";
  const [u] = await db.select({ status: users.status }).from(users).where(eq(users.email, e));
  if (!u) return "not_invited";
  return u.status === "blocked" ? "blocked" : "ok";
}

/**
 * Makes a sign-in link for this email, if it may sign in. Returns the secret to put in the link, or null (not
 * invited, turned off, not an email, or too many links lately). The caller always says the same thing either way,
 * so the form doesn't tell strangers who has been invited.
 */
export async function createSignInLink(db: Db, emailRaw: string, now = new Date()): Promise<string | null> {
  const email = cleanEmail(emailRaw);
  if (!looksLikeEmail(email) || (await mayUseApp(db, email)) !== "ok") return null;
  const recent = await db.select({ id: signInLinks.id }).from(signInLinks)
    .where(and(eq(signInLinks.email, email), gt(signInLinks.createdAt, new Date(now.getTime() - 15 * 60_000))));
  if (recent.length >= MAX_LINKS) return null;
  const token = randomBytes(32).toString("base64url");
  await db.insert(signInLinks).values({ email, tokenHash: hash(token), expiresAt: new Date(now.getTime() + LINK_MINUTES * 60_000), createdAt: now });
  return token;
}

/** Uses up a link: the email it was for, or null when it is unknown, used, expired, or the person was turned off since. */
export async function consumeSignInLink(db: Db, token: string, now = new Date()): Promise<string | null> {
  if (!token || token.length > 100) return null;
  const [used] = await db.update(signInLinks).set({ usedAt: now })
    .where(and(eq(signInLinks.tokenHash, hash(token)), isNull(signInLinks.usedAt), gt(signInLinks.expiresAt, now)))
    .returning({ email: signInLinks.email });
  if (!used) return null;
  return (await mayUseApp(db, used.email)) === "ok" ? used.email : null;
}
