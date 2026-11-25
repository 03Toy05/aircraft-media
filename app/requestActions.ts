"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireWriter } from "@/lib/session";
import { DomainError } from "@/domain/errors";
import { photoAllowed } from "@/domain/photoAccess";
import * as req from "@/domain/requests";
import { ensureLink, replaceLink, setLink } from "@/domain/quoteLinks";
import { siteAddress } from "@/lib/site";
import { serverT } from "@/lib/uiLang";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const withParam = (path: string, k: string, v: string) => `${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;

export async function archiveRequestAction(fd: FormData) {
  const id = str(fd, "requestId");
  let s;
  try {
    s = await requireWriter();
  } catch (e) {
    if (e instanceof DomainError) redirect(withParam(`/requests/${id}`, "error", e.message));
    throw e;
  }
  const archived = str(fd, "archived") === "1";
  await req.setArchived(await getDb(), s.actor, id, archived);
  revalidatePath("/requests");
  const t = await serverT();
  redirect(archived ? withParam("/requests", "ok", t("Request archived.")) : withParam(`/requests/${id}`, "ok", t("Request back in the list.")));
}

export type SaveResult = { ok: boolean; message: string; requestId?: string; reference?: string; version?: number };

/**
 * Quote page: save the quote with its routing, as the next version of its request (or the first of a new one, when
 * `requestId` is null). Only photos the broker may use are kept.
 */
export async function saveQuoteVersionAction(requestId: string | null, legs: unknown, snapshot: unknown): Promise<SaveResult> {
  try {
    const s = await requireWriter();
    const db = await getDb();
    const snap = req.cleanSnapshot(snapshot);
    for (const o of snap.options) {
      for (const p of o.photos) {
        if (!(await photoAllowed(db, s, p.id))) return { ok: false, message: (await serverT())("One of the photos is no longer available to you. Untick it and save again.") };
      }
    }
    const r = await req.saveQuoteVersion(db, s.actor, requestId, legs, snap);
    revalidatePath(`/requests/${r.requestId}`);
    revalidatePath("/requests");
    revalidatePath("/");
    return { ok: true, ...r, message: (await serverT())("Saved as {ref} version {n}.", { ref: r.reference, n: r.version }) };
  } catch (e) {
    if (e instanceof DomainError || e instanceof Error) return { ok: false, message: e.message };
    return { ok: false, message: (await serverT())("The quote couldn't be saved. Try again.") };
  }
}

// ---------------------------------------------------------------- the client's link


/** The request's client link (made now if it has none), as a full address to send. */
export async function clientLinkAction(requestId: string): Promise<{ ok: boolean; url?: string; message: string }> {
  try {
    const s = await requireWriter();
    const site = await siteAddress();
    if (!site) return { ok: false, message: (await serverT())("The site's address isn't set (APP_URL).") };
    const l = await ensureLink(await getDb(), s.actor, requestId);
    return { ok: true, url: `${site}/q/${l.token}`, message: (await serverT())("Client link ready.") };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : (await serverT())("The link couldn't be made.") };
  }
}

/** Request page: switch the link off or on, set or clear its end date, or replace it with a new one. */
export async function clientLinkSettingsAction(fd: FormData) {
  const id = str(fd, "requestId");
  const back = `/requests/${id}`;
  let s;
  try {
    s = await requireWriter();
  } catch (e) {
    if (e instanceof DomainError) redirect(withParam(back, "error", e.message));
    throw e;
  }
  const db = await getDb();
  const op = str(fd, "op");
  const t = await serverT();
  let ok = t("Saved.");
  try {
    if (op === "create") { await ensureLink(db, s.actor, id); ok = t("Client link made. Copy it and send it to the client."); }
    else if (op === "off") { await setLink(db, s.actor, id, { active: false }); ok = t("Link switched off: it no longer opens."); }
    else if (op === "on") { await setLink(db, s.actor, id, { active: true }); ok = t("Link switched on again."); }
    else if (op === "replace") { await replaceLink(db, s.actor, id); ok = t("New link made; the old one no longer opens."); }
    else if (op === "expiry") {
      const d = str(fd, "expires");
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(t("The end date isn't right."));
      // Works until the end of that day (UTC).
      await setLink(db, s.actor, id, { expiresAt: d ? new Date(`${d}T23:59:59Z`) : null });
      ok = d ? t("The link stops working after {date}.", { date: d }) : t("The link has no end date.");
    }
  } catch (e) {
    redirect(withParam(back, "error", (e as Error).message));
  }
  revalidatePath(back);
  redirect(withParam(back, "ok", ok));
}
