import { requireUser } from "@/lib/session";
import { sendSupportAction } from "../../supportActions";
import { Flash, one, type SP } from "../../_components/ui";
import { PendingButton } from "../../_components/PendingButton";
import { serverT } from "@/lib/uiLang";

/** Feedback and support: a short form that emails the admin. The reply goes to the broker's sign-in email. */
export default async function Support({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const t = await serverT();
  const s = await requireUser();
  const topics: [string, string][] = [
    ["Problem", t("Something isn't working")],
    ["Question", t("A question")],
    ["Idea or feedback", t("An idea or feedback")],
    ["Billing", t("Billing or my plan")],
  ];
  return (
    <>
      <h1>{t("Feedback and support")}</h1>
      <p className="muted">{t("Tell us what's not working, ask a question, or suggest something. We reply by email to {email}.", { email: s.email })}</p>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <form action={sendSupportAction} className="card">
        <label>{t("What is it about?")}</label>
        <select name="topic" defaultValue="Problem">
          {topics.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <label>{t("Which page or aircraft? (optional)")}</label>
        <input name="page" maxLength={300} placeholder={t("For example: Quote page, G650ER B-LDE")} />
        <label>{t("Your message")}</label>
        <textarea name="message" required rows={8} maxLength={5000} placeholder={t("What happened, and what did you expect? Screenshots can be sent as a reply to our email.")} />
        <PendingButton pending={t("Sending…")}>{t("Send")}</PendingButton>
      </form>
    </>
  );
}
