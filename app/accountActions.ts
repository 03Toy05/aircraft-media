"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/session";
import { serverT } from "@/lib/uiLang";
import { sendMail } from "@/lib/mail";
import { siteAddress } from "@/lib/site";
import { supportEmail } from "@/lib/owner";
import { DomainError } from "@/domain/errors";
import { cancelAccount, deleteAccount, reopenAccount } from "@/domain/closeAccount";

const back = (k: "error" | "ok", msg: string) => redirect(`/settings?${k}=${encodeURIComponent(msg)}#account`);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Tell the platform's address (toy@aircraftmedia.my) what someone did with their account. Never stops the action. */
async function tellAdmin(subject: string, lines: string[], replyTo?: string) {
  const to = supportEmail();
  if (!to) return;
  const text = lines.filter(Boolean).join("\n\n");
  await sendMail({ to, subject, text, html: text.split("\n\n").map((p) => `<p>${esc(p)}</p>`).join(""), replyTo })
    .catch((e) => console.error("Account notice not sent", e));
}

/** Their own session only: not the admin, and not while the admin is looking at someone's workspace. */
async function own() {
  const s = await requireUser();
  const t = await serverT();
  if (s.isAdmin || s.viewingAs) back("error", t("Platform admins can't close their account here."));
  return { s, t, db: await getDb() };
}

export async function cancelAccountAction() {
  const { s, t, db } = await own();
  try {
    await cancelAccount(db, s.actor.id);
  } catch (e) {
    if (e instanceof DomainError) back("error", t.error(e));
    throw e;
  }
  const site = (await siteAddress().catch(() => null)) ?? "";
  await tellAdmin(`Cancelled: ${s.email}`, [
    `${s.email} cancelled their account. Their workspace is now read-only; nothing was deleted.`,
    "They can reopen it themselves from Settings, or you can turn it back on from the Users page.",
    site ? `Users: ${site}/admin` : "",
  ], s.email);
  revalidatePath("/", "layout");
  back("ok", t("Your account is cancelled. Your workspace is read-only now; you can reopen it here at any time."));
}

export async function reopenAccountAction() {
  const { s, t, db } = await own();
  await reopenAccount(db, s.actor.id);
  await tellAdmin(`Reopened: ${s.email}`, [`${s.email} reopened their account.`], s.email);
  revalidatePath("/", "layout");
  back("ok", t("Welcome back. Your account is open again."));
}

export async function deleteAccountAction(fd: FormData) {
  const { s, t, db } = await own();
  let done;
  try {
    done = await deleteAccount(db, s.actor.id, String(fd.get("confirmEmail") ?? ""));
  } catch (e) {
    if (e instanceof DomainError) back("error", t.error(e));
    throw e;
  }
  await tellAdmin(`Deleted: ${done.email}`, [
    done.workspace
      ? `${done.email} deleted their account and workspace: ${done.aircraft} aircraft, ${done.photos} photos and ${done.quotes} saved quote versions were removed, and their client links no longer open.`
      : `${done.email} left a shared workspace and deleted their account. The workspace itself was kept.`,
    "Photo files kept in storage were not touched (originals are never deleted by the app). Photos already accepted into the library stay there.",
  ]);
  await signOut({ redirectTo: "/login?ok=deleted" });
}
