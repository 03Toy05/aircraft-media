"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireWriter } from "@/lib/session";
import { DomainError } from "@/domain/errors";
import { photoAllowed } from "@/domain/photoAccess";
import * as req from "@/domain/requests";

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
  redirect(archived ? withParam("/requests", "ok", "Request archived.") : withParam(`/requests/${id}`, "ok", "Request back in the list."));
}

export type SaveResult = { ok: boolean; message: string; requestId?: string; reference?: string; version?: number; routingChanged?: boolean };

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
        if (!(await photoAllowed(db, s, p.id))) return { ok: false, message: "One of the photos is no longer available to you. Untick it and save again." };
      }
    }
    const r = await req.saveQuoteVersion(db, s.actor, requestId, legs, snap);
    revalidatePath(`/requests/${r.requestId}`);
    revalidatePath("/requests");
    revalidatePath("/");
    return { ok: true, ...r, message: `Saved as ${r.reference} version ${r.version}.` };
  } catch (e) {
    if (e instanceof req.RoutingChanged) return { ok: false, routingChanged: true, message: e.message };
    if (e instanceof DomainError || e instanceof Error) return { ok: false, message: e.message };
    return { ok: false, message: "The quote couldn't be saved. Try again." };
  }
}
