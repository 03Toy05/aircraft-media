import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { announcements, users } from "../db/schema";
import { TRIAL_DAYS, accessFor } from "./accounts";
import type { Mail } from "../lib/mail";

/**
 * Emails from Aircraft Media to its users: a welcome when someone starts their own trial, a reminder 3 days before the
 * trial ends, a note the day it ends, and announcements the admin writes. Trial emails go to everyone on a trial;
 * announcements skip people who asked not to get them. Each automatic email is sent once (its time is kept on the user).
 */

export type Send = (m: Mail) => Promise<void>;
const DAY = 86_400_000;
export const REMINDER_DAYS = 3;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Hong_Kong" }).format(d);

/** A plain email: paragraphs, one optional button, a small footer. */
function mail(to: string, subject: string, paras: string[], button?: { label: string; href: string }, footer?: string): Mail {
  const text = [...paras, button ? `${button.label}: ${button.href}` : "", footer ?? ""].filter(Boolean).join("\n\n");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1a1f2b;max-width:560px">` +
    paras.map((p) => `<p style="margin:0 0 14px;white-space:pre-wrap">${esc(p)}</p>`).join("") +
    (button ? `<p style="margin:20px 0"><a href="${esc(button.href)}" style="background:#1f3a5f;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${esc(button.label)}</a></p>` : "") +
    (footer ? `<p style="margin:24px 0 0;font-size:12px;color:#6b7280;white-space:pre-wrap">${esc(footer)}</p>` : "") +
    `</div>`;
  return { to, subject, text, html, replyTo: process.env.OWNER_EMAIL || undefined };
}

const hello = (name: string) => `Hi ${name.trim() || "there"},`;
/** Where to pay once the trial ends: the Stripe payment link, when set (PAYMENT_LINK). */
const payLink = () => process.env.PAYMENT_LINK?.trim() || null;

export function welcomeMail(site: string, u: { email: string; displayName: string }): Mail {
  return mail(u.email, "Welcome to Aircraft Media: your 14-day trial has started", [
    hello(u.displayName),
    `Thanks for trying Aircraft Media. Your free trial runs for ${TRIAL_DAYS} days from today, with your own workspace and the shared aircraft library.`,
    "To get going:\n1. Ask Toy for a quote, e.g. “G650 Hong Kong to Tokyo 12 Dec, 4 pax”.\n2. Tick the aircraft and photos, then copy the message, share the client link, or download the PDF.\n3. In Settings, add your logo and colour, or upload one of your past quotes so PDFs come out in your own layout.",
    "Questions or ideas? Just reply to this email, or use Support in the app.",
  ], { label: "Open Aircraft Media", href: site });
}

export function trialEndingMail(site: string, u: { email: string; displayName: string; trialEndsAt: Date }, daysLeft: number): Mail {
  const pay = payLink();
  return mail(u.email, daysLeft <= 1 ? "Your Aircraft Media trial ends tomorrow" : `Your Aircraft Media trial ends in ${daysLeft} days`, [
    hello(u.displayName),
    `Your free trial ends on ${fmt(u.trialEndsAt)}. After that you can still open your workspace and share what you have, but not add or change anything.`,
    pay ? "To keep everything working, choose a plan before then." : "To keep everything working, reply to this email and we'll set you up.",
  ], pay ? { label: "Choose a plan", href: pay } : { label: "Open Aircraft Media", href: site });
}

export function trialEndedMail(site: string, u: { email: string; displayName: string }): Mail {
  const pay = payLink();
  return mail(u.email, "Your Aircraft Media trial has ended", [
    hello(u.displayName),
    "Your free trial has ended. Your aircraft, photos and quotes are kept, and you can still look at them and share them.",
    pay ? "To add and change things again, choose a plan." : "To add and change things again, reply to this email and we'll set you up.",
  ], pay ? { label: "Choose a plan", href: pay } : { label: "Open Aircraft Media", href: site });
}

// ---------------------------------------------------------------- unsubscribing from announcements

const secret = () => process.env.AUTH_SECRET || "dev-secret";
export const unsubscribeSig = (userId: string) => createHmac("sha256", secret()).update(`unsub:${userId}`).digest("base64url").slice(0, 32);
export function checkUnsubscribe(userId: string, sig: string): boolean {
  const want = Buffer.from(unsubscribeSig(userId)), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
export async function setEmailOptOut(db: Db, userId: string, out: boolean) {
  await db.update(users).set({ emailOptOut: out, updatedAt: new Date() }).where(eq(users.id, userId));
}

export function announcementMail(site: string, u: { id: string; email: string; displayName: string }, subject: string, body: string): Mail {
  const unsub = `${site}/unsubscribe?u=${u.id}&s=${unsubscribeSig(u.id)}`;
  return mail(u.email, subject, [hello(u.displayName), ...body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)], { label: "Open Aircraft Media", href: site },
    `You get this because you use Aircraft Media. Don't want these updates? ${unsub}`);
}

// ---------------------------------------------------------------- the automatic emails

/**
 * Sends the welcome, "ends in 3 days" and "has ended" emails that are due. Each user is claimed first (its time set),
 * so two servers never send the same email; a failed send is released to try again next time.
 */
export async function sendDueEmails(db: Db, site: string, send: Send, now = new Date()): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;
  const run = async (col: "welcomedAt" | "trialReminderAt" | "trialEndedMailAt", where: ReturnType<typeof and>, make: (u: typeof users.$inferSelect) => Mail | null) => {
    const due = await db.select().from(users).where(and(where, isNull(users[col]), ne(users.status, "blocked")));
    for (const u of due.slice(0, 50)) {
      const [claimed] = await db.update(users).set({ [col]: now }).where(and(eq(users.id, u.id), isNull(users[col]))).returning({ id: users.id });
      if (!claimed) continue;
      const m = make(u);
      if (!m) continue;
      try {
        await send(m);
        sent++;
      } catch (e) {
        console.error(`Email (${col}) to ${u.email} failed`, e);
        await db.update(users).set({ [col]: null }).where(eq(users.id, u.id));
        failed++;
      }
    }
  };
  // Welcome: people who started their own trial, once they have signed in.
  await run("welcomedAt", and(isNotNull(users.signedUpAt), isNotNull(users.firstSignInAt))!, (u) => welcomeMail(site, u));
  // A few days before the end.
  await run("trialReminderAt", and(eq(users.plan, "trial"), gt(users.trialEndsAt, now), lte(users.trialEndsAt, new Date(now.getTime() + REMINDER_DAYS * DAY)))!, (u) => {
    const a = accessFor(u, now);
    return u.trialEndsAt && a.daysLeft ? trialEndingMail(site, { ...u, trialEndsAt: u.trialEndsAt }, a.daysLeft) : null;
  });
  // On the day it ended (not for trials that ended long before this email existed).
  await run("trialEndedMailAt", and(eq(users.plan, "trial"), lte(users.trialEndsAt, now), gt(users.trialEndsAt, new Date(now.getTime() - 3 * DAY)))!, (u) => trialEndedMail(site, u));
  return { sent, failed };
}

let lastRun = 0;
/** At most every 15 minutes per server, from page loads (there is no scheduler): sends what is due, never throws. */
export async function maybeSendDueEmails(db: Db, site: string | null, send: Send, now = Date.now()) {
  if (!site || now - lastRun < 15 * 60_000) return;
  lastRun = now;
  try {
    await sendDueEmails(db, site, send, new Date(now));
  } catch (e) {
    console.error("Automatic emails failed", e);
  }
}

// ---------------------------------------------------------------- announcements

export const AUDIENCES = ["all", "trial", "full", "active"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Who an announcement goes to: signed-in users, not turned off, not opted out, not the admin. */
export async function audienceOf(db: Db, audience: Audience, adminEmail: string, now = new Date()) {
  const rows = await db.select().from(users).where(and(ne(users.status, "blocked"), eq(users.emailOptOut, false), isNotNull(users.firstSignInAt), sql`lower(${users.email}) <> ${adminEmail.toLowerCase()}`));
  return rows.filter((u) =>
    audience === "all" ? true
    : audience === "trial" ? u.plan === "trial"
    : audience === "full" ? u.plan === "full"
    : !!u.lastSignInAt && now.getTime() - u.lastSignInAt.getTime() <= 30 * DAY);
}

/** Records the announcement and sends it, one email per person (a short pause between, to stay under the mail service's limit). */
export async function sendAnnouncement(db: Db, site: string, send: Send, input: { subject: string; body: string; audience: Audience; adminId: string; adminEmail: string }, pause = 600): Promise<string> {
  const people = await audienceOf(db, input.audience, input.adminEmail);
  const [a] = await db.insert(announcements).values({ subject: input.subject, body: input.body, audience: input.audience, recipients: people.length, createdBy: input.adminId }).returning({ id: announcements.id });
  let sent = 0, failed = 0;
  for (const u of people) {
    try {
      await send(announcementMail(site, u, input.subject, input.body));
      sent++;
    } catch (e) {
      console.error(`Announcement to ${u.email} failed`, e);
      failed++;
    }
    await db.update(announcements).set({ sent, failed }).where(eq(announcements.id, a.id));
    if (pause) await new Promise((r) => setTimeout(r, pause));
  }
  await db.update(announcements).set({ sent, failed, finishedAt: new Date() }).where(eq(announcements.id, a.id));
  return a.id;
}
