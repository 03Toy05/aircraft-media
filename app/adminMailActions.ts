"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/session";
import { serverT } from "@/lib/uiLang";
import { sendMail } from "@/lib/mail";
import { siteAddress } from "@/lib/site";
import { AUDIENCES, announcementMail, audienceOf, sendAnnouncement, type Audience } from "@/domain/userEmails";

const back = (k: "error" | "ok", msg: string) => redirect(`/admin?${k}=${encodeURIComponent(msg)}#announce`);

/** Users page: email an announcement (new features, a notice) to a group of users, or a test copy to the admin. */
export async function sendAnnouncementAction(fd: FormData) {
  const me = await requireAdmin();
  const t = await serverT();
  const subject = String(fd.get("subject") ?? "").trim().slice(0, 150);
  const body = String(fd.get("body") ?? "").trim().slice(0, 10_000);
  const audienceIn = String(fd.get("audience") ?? "all");
  const audience: Audience = (AUDIENCES as readonly string[]).includes(audienceIn) ? (audienceIn as Audience) : "all";
  if (!subject || !body) back("error", t("Write a subject and a message first."));
  const site = await siteAddress();
  if (!site) back("error", t("The site's address isn't set (APP_URL), so the email can't link to the app."));
  const db = await getDb();
  if (fd.get("test") === "1") {
    try {
      await sendMail({ ...announcementMail(site!, { id: me.actor.id, email: me.email, displayName: "" }, `[Test] ${subject}`, body) });
    } catch (e) {
      console.error("Test announcement failed", e);
      back("error", t("The test email couldn't be sent. Try again in a minute."));
    }
    back("ok", t("Test sent to {email}.", { email: me.email }));
  }
  const n = (await audienceOf(db, audience, me.email)).length;
  if (!n) back("error", t("Nobody to send it to in that group."));
  // Sent one by one after this page answers; the list below shows how far it got.
  after(() => sendAnnouncement(db, site!, sendMail, { subject, body, audience, adminId: me.actor.id, adminEmail: me.email }).catch((e) => console.error("Announcement failed", e)));
  back("ok", t("Sending to {n} people. Refresh to see how far it got.", { n }));
}
