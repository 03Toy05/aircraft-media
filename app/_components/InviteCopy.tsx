"use client";

import { useState } from "react";
import { copyText } from "./copyText";
import { useT, type T } from "./uiLang";

/** The invite message for one person (the app link and the email to sign in with), ready to paste, in the admin's screen language. */
export function inviteMessage(t: T, name: string, email: string, link: string, days: number | null) {
  return [
    t("Hi {name}, you're invited to Aircraft Media: {link}", { name, link }),
    t("First time: tap \"First time here, or forgot your password?\", enter {email}, and set a password from the email you get. Or, if {email} is a Google account, tap \"Sign in with Google\". It has to be that email; another one will not get in.", { email }),
    days ? t("You have a {n}-day free trial from your first sign-in.", { n: days }) : null,
  ].filter(Boolean).join("\n\n");
}

/** Users page: copies the invite message, since the app does not send email itself. */
export default function InviteCopy({ name, email, link, days }: { name: string; email: string; link: string; days: number | null }) {
  const t = useT();
  const [done, setDone] = useState<"" | "ok" | "fail">("");
  return (
    <button
      type="button"
      className="secondary small-btn"
      onClick={async () => {
        const ok = await copyText(inviteMessage(t, name, email, link, days));
        setDone(ok ? "ok" : "fail");
        setTimeout(() => setDone(""), 2500);
      }}
    >
      {done === "ok" ? t("Copied") : done === "fail" ? t("Could not copy") : t("Copy invite message")}
    </button>
  );
}
