"use client";

import { useState } from "react";
import { copyText } from "./copyText";

/** The invite message for one person (the app link and the exact Google email to sign in with), ready to paste. */
export function inviteMessage(name: string, email: string, link: string, days: number | null) {
  return [
    `Hi ${name}, you're invited to Aircraft Media: ${link}`,
    `Tap "Sign in with Google" and choose ${email}. It has to be that Google account; another one will not get in.`,
    days ? `You have a ${days}-day free trial from your first sign-in.` : null,
  ].filter(Boolean).join("\n\n");
}

/** Users page: copies the invite message, since the app does not send email itself. */
export default function InviteCopy({ name, email, link, days }: { name: string; email: string; link: string; days: number | null }) {
  const [done, setDone] = useState<"" | "ok" | "fail">("");
  return (
    <button
      type="button"
      className="secondary small-btn"
      onClick={async () => {
        const ok = await copyText(inviteMessage(name, email, link, days));
        setDone(ok ? "ok" : "fail");
        setTimeout(() => setDone(""), 2500);
      }}
    >
      {done === "ok" ? "Copied" : done === "fail" ? "Could not copy" : "Copy invite message"}
    </button>
  );
}
