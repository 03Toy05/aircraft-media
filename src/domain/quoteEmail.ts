import { and, count, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { quoteShares } from "../db/schema";
import { parseStyled } from "./textStyle";
export { QUOTE_SUBJECT } from "./quote";

/** A quote email goes to a few people at most (it is a message to a client, not a mailing). */
export const MAX_RECIPIENTS = 5;
/** Quote emails one person may send in 24 hours. */
export const MAX_EMAILS_PER_DAY = 40;
export const MAX_PHOTOS = 30;
/** Attached photos in all (Resend takes up to 40 MB once encoded). */
export const MAX_ATTACH_BYTES = 25 * 1024 * 1024;

const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/** "a@x.com, b@y.com" -> the addresses, or a plain message saying what is wrong. */
export function parseRecipients(raw: string): { emails: string[] } | { error: string } {
  const parts = raw.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const emails = [...new Set(parts)];
  if (!emails.length) return { error: "Type the client's email address." };
  const bad = emails.find((e) => !EMAIL.test(e) || e.length > 200);
  if (bad) return { error: `“${bad}” doesn't look like an email address.` };
  if (emails.length > MAX_RECIPIENTS) return { error: `Send to ${MAX_RECIPIENTS} people at most in one email.` };
  return { emails };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The quote text (with WhatsApp-style *bold* _italic_ ~strike~) as an email: an HTML part with the styles, and plain text without the markers. */
export function quoteEmailBody(text: string, opts: { rtl?: boolean } = {}): { html: string; text: string } {
  const spans = parseStyled(text);
  const plain = spans.map((s) => s.text).join("");
  const inner = spans.map((s) => {
    let h = esc(s.text).replace(/\n/g, "<br>");
    if (s.bold) h = `<b>${h}</b>`;
    if (s.italic) h = `<i>${h}</i>`;
    if (s.strike) h = `<s>${h}</s>`;
    if (s.underline) h = `<u>${h}</u>`;
    return h;
  }).join("");
  const html = `<!doctype html><html><body style="margin:0;padding:0"><div${opts.rtl ? ' dir="rtl"' : ""} style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:640px;padding:16px">${inner}</div></body></html>`;
  return { html, text: plain };
}

/** "Wallace via Aircraft Media <quotes@aircraftmedia.my>": the broker's name, on the site's own verified domain. */
export function quoteFrom(brokerName: string, env: Record<string, string | undefined> = process.env): string | undefined {
  const base = env.EMAIL_FROM ?? "";
  const addr = env.QUOTE_EMAIL_FROM || (base.match(/@([^>\s]+)>?\s*$/) ? `quotes@${base.match(/@([^>\s]+)>?\s*$/)![1]}` : "");
  if (!addr) return undefined;
  const name = brokerName.replace(/["<>\r\n\\]/g, "").trim().slice(0, 60);
  return `"${name ? `${name} via ` : ""}Aircraft Media" <${addr.replace(/^.*<|>.*$/g, "")}>`;
}

/** A photo's file name for the attachment: letters, digits and a few signs, with the right extension. */
export function attachmentName(name: string, mimeType: string): string {
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const base = name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[^\p{L}\p{N} ._()+-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 100) || "photo";
  return `${base}.${ext}`;
}

/** How many quote emails this person sent in the last 24 hours. */
export async function emailsToday(db: Db, userId: string, now = new Date()): Promise<number> {
  const [r] = await db.select({ n: count() }).from(quoteShares)
    .where(and(eq(quoteShares.userId, userId), eq(quoteShares.how, "email"), gte(quoteShares.createdAt, new Date(now.getTime() - 864e5))));
  return Number(r?.n ?? 0);
}
