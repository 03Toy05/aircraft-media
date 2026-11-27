"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireUser } from "@/lib/session";
import { serverT } from "@/lib/uiLang";
import { sendMail } from "@/lib/mail";
import { supportEmail } from "@/lib/owner";

/** What a broker can write to us about; the English name goes into the email subject. */
const SUPPORT_TOPICS = ["Problem", "Question", "Idea or feedback", "Billing"] as const;
const MAX = 5000;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Support page: emails the broker's message to the platform's address (SUPPORT_EMAIL, toy@aircraftmedia.my), with a reply-to of the broker's email. Nothing is stored. */
export async function sendSupportAction(fd: FormData) {
  const s = await requireUser();
  const t = await serverT();
  const topicIn = String(fd.get("topic") ?? "");
  const topic = (SUPPORT_TOPICS as readonly string[]).includes(topicIn) ? topicIn : "Question";
  const message = String(fd.get("message") ?? "").trim();
  const page = String(fd.get("page") ?? "").trim().slice(0, 300);
  const back = (q: string) => redirect(`/support?${q}`);
  if (!message) back(`error=${encodeURIComponent(t("Write your message first."))}`);
  if (message.length > MAX) back(`error=${encodeURIComponent(t("That message is too long (at most {n} characters).", { n: MAX }))}`);
  const to = supportEmail();
  if (!to) back(`error=${encodeURIComponent(t("Support email is not set up yet. Please try again later."))}`);
  const from = s.viewingAs ? `${s.email} (viewing ${s.viewingAs.email})` : s.email;
  const agent = (await headers()).get("user-agent") ?? "";
  const lines: string[] = [`From: ${from}`, `Topic: ${topic}`];
  if (page) lines.push(`Page: ${page}`);
  lines.push(`Sent: ${new Date().toISOString()}`);
  if (agent) lines.push(`Browser: ${agent.slice(0, 200)}`);
  lines.push("", message);
  try {
    await sendMail({
      to: to!,
      replyTo: s.email,
      subject: `[Aircraft Media support] ${topic}: ${message.split("\n")[0].slice(0, 60)}`,
      text: lines.join("\n"),
      html: `<div style="font-family:sans-serif;white-space:pre-wrap">${esc(lines.join("\n"))}</div>`,
    });
  } catch (e) {
    console.error("Support email not sent", e);
    back(`error=${encodeURIComponent(t("Your message couldn't be sent. Try again in a minute."))}`);
  }
  back(`ok=${encodeURIComponent(t("Thanks, your message was sent. We'll reply to {email}.", { email: s.email }))}`);
}
