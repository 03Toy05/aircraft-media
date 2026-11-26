import Link from "next/link";
import { getDb } from "@/db/client";
import { checkUnsubscribe, setEmailOptOut } from "@/domain/userEmails";
import { serverT } from "@/lib/uiLang";

async function resubscribeAction(fd: FormData) {
  "use server";
  const u = String(fd.get("u") ?? ""), s = String(fd.get("s") ?? "");
  if (/^[0-9a-f-]{36}$/.test(u) && checkUnsubscribe(u, s)) await setEmailOptOut(await getDb(), u, false);
  const { redirect } = await import("next/navigation");
  redirect(`/unsubscribe?u=${u}&s=${encodeURIComponent(s)}&back=1`);
}

/** The link at the foot of announcements: stops them for this person (trial emails still come). */
export default async function Unsubscribe({ searchParams }: { searchParams: Promise<{ u?: string; s?: string; back?: string }> }) {
  const { u = "", s = "", back } = await searchParams;
  const t = await serverT();
  const ok = /^[0-9a-f-]{36}$/.test(u) && checkUnsubscribe(u, s);
  if (ok && !back) await setEmailOptOut(await getDb(), u, true);
  return (
    <main style={{ maxWidth: 440, margin: "12vh auto", padding: 16 }}>
      <div className="card">
        <h1>Aircraft Media</h1>
        {!ok ? <p>{t("That link doesn't work. Open it again from the email.")}</p>
          : back ? <p>{t("Done: you'll get our updates again.")}</p>
          : <>
              <p>{t("You won't get our updates any more. Emails about your account and trial still come.")}</p>
              <form action={resubscribeAction}><input type="hidden" name="u" value={u} /><input type="hidden" name="s" value={s} /><button type="submit" className="secondary">{t("Undo")}</button></form>
            </>}
        <p className="small"><Link href="/">{t("Open Aircraft Media")}</Link></p>
      </div>
    </main>
  );
}
