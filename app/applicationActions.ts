"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/session";
import { serverT } from "@/lib/uiLang";
import { sendMail } from "@/lib/mail";
import { siteAddress } from "@/lib/site";
import { DomainError } from "@/domain/errors";
import { approveApplication, declineApplication } from "@/domain/accounts";
import { approvedMail } from "@/domain/userEmails";

const back = (k: "error" | "ok", msg: string) => redirect(`/admin?${k}=${encodeURIComponent(msg)}#applications`);

/** Users page: approve a free-trial application, and email them how to sign in. */
export async function approveApplicationAction(fd: FormData) {
  const me = await requireAdmin();
  const t = await serverT();
  const db = await getDb();
  let u;
  try {
    u = await approveApplication(db, me.email, String(fd.get("userId") ?? ""));
  } catch (e) {
    if (e instanceof DomainError) back("error", t.error(e));
    throw e;
  }
  revalidatePath("/admin");
  const site = await siteAddress();
  let mailed = false;
  if (site) {
    try { await sendMail(approvedMail(site, u)); mailed = true; } catch (e) { console.error("Approval email failed", e); }
  }
  back("ok", mailed ? t("Approved {email}. They've been emailed how to sign in.", { email: u.email }) : t("Approved {email}, but the email couldn't be sent. Let them know they can sign in now.", { email: u.email }));
}

/** Users page: decline a free-trial application (it is removed; no email is sent). */
export async function declineApplicationAction(fd: FormData) {
  const me = await requireAdmin();
  const t = await serverT();
  let u;
  try {
    u = await declineApplication(await getDb(), me.email, String(fd.get("userId") ?? ""));
  } catch (e) {
    if (e instanceof DomainError) back("error", t.error(e));
    throw e;
  }
  revalidatePath("/admin");
  back("ok", t("Declined {email}. No email was sent.", { email: u.email }));
}
