import type { Db } from "../db/client";
import { startTrial } from "../domain/signup";
import { sendMail } from "./mail";
import { siteAddress } from "./site";
import { supportEmail } from "./owner";

export type SignupWay = "Google" | "the free trial page" | "the sign-in page";

/**
 * Records a free-trial application for someone new (or finds their account) and, when it is new, emails the platform's
 * address (SUPPORT_EMAIL, toy@aircraftmedia.my): who applied and how, with a link to approve it. Never stops the sign-up.
 */
export async function startTrialWithNotice(db: Db, email: string, name: string | null | undefined, way: SignupWay) {
  const r = await startTrial(db, email, name, new Date(), way === "Google" ? "google" : "email");
  if (r?.created) {
    const to = supportEmail();
    if (to) {
      const site = (await siteAddress().catch(() => null)) ?? "";
      const who = r.user.displayName && r.user.displayName !== r.user.email.split("@")[0] ? `${r.user.displayName} <${r.user.email}>` : r.user.email;
      const text = [
        `${who} applied for a free trial through ${way}.`,
        "Approve or decline it on the Users page. Once approved, they get an email telling them how to sign in, and their 14 days start at their first sign-in.",
        site ? `Applications: ${site}/admin#applications` : "",
      ].filter(Boolean).join("\n\n");
      await sendMail({ to, subject: `New application: ${r.user.email}`, text, html: text.split("\n\n").map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`).join(""), replyTo: r.user.email })
        .catch((e) => console.error("Sign-up notice not sent", e));
    }
  }
  return r;
}
