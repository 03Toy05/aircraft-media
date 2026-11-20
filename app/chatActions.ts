"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftMedia } from "@/db/schema";
import { getFileStore } from "@/storage";
import { requireUser } from "@/lib/session";
import { exportAfterResponse } from "@/lib/cbosExportRunner";
import { DomainError } from "@/domain/errors";
import { ingestPdf } from "@/domain/intake";
import { ingestUpload } from "@/domain/media";
import { applyChatProposal, suggestClassification, type ApplyResult } from "@/domain/chat";
import { parseChatLang, tr, trStep } from "@/domain/chocksText";
import { converse, emptyDraft, type ChocksReply, type Draft, type DraftPhoto } from "@/domain/chocks";

export interface TurnResult {
  draft: Draft;
  reply: ChocksReply;
  failures: string[];
  applied?: ApplyResult;
}

async function photoFor(db: Awaited<ReturnType<typeof getDb>>, tenantId: string, mediaId: string, name: string, note?: string): Promise<DraftPhoto> {
  const [m] = await db.select().from(aircraftMedia).where(and(eq(aircraftMedia.id, mediaId), eq(aircraftMedia.tenantId, tenantId)));
  return { mediaId, name, contentVersionId: m?.currentContentVersionId ?? null, classification: m && m.primaryClassification !== "unclassified" ? m.primaryClassification : suggestClassification(name), note };
}

/**
 * One Chocks turn. The browser sends the draft back with every message, so a short reply is always read against
 * the question Chocks just asked. Photos are stored (waiting in Review) when they arrive; nothing is created,
 * attached or approved until the owner confirms.
 */
export async function chocksTurnAction(fd: FormData): Promise<TurnResult> {
  const session = await requireUser();
  const { actor } = session;
  const readOnlyWhy = session.viewingAs
    ? `You are looking at ${session.viewingAs.email}'s workspace, so nothing can be added here.`
    : session.readOnly ? "Your 14-day trial has ended, so I can look things up and share, but not add or change anything. Ask the admin to extend it." : null;
  const db = await getDb();
  const store = getFileStore();
  let draft: Draft;
  try {
    draft = JSON.parse(String(fd.get("draft") ?? "")) as Draft;
    if (!Array.isArray(draft.photos)) throw new Error("bad draft");
  } catch {
    draft = emptyDraft(randomUUID());
  }
  const L = parseChatLang(fd.get("lang"));
  draft.lang = L;
  const message = String(fd.get("text") ?? "");
  const photos: DraftPhoto[] = [];
  const failures: string[] = [];
  const batchId = randomUUID();

  for (const f of fd.getAll("files")) {
    if (!(f instanceof File) || f.size === 0) continue;
    if (readOnlyWhy) {
      failures.push(`${f.name}: ${readOnlyWhy}`);
      continue;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        const r = await ingestPdf(db, store, actor, { filename: f.name, bytes, cardText: message || null, batchId });
        for (const x of r.result.extracted) photos.push(await photoFor(db, actor.tenantId, x.mediaId, f.name));
        if (r.result.extracted.length === 0) failures.push(`${f.name}: no embedded photos were found in this PDF (kept as evidence).`);
      } else {
        const r = await ingestUpload(db, store, actor, { filename: f.name, bytes, cardText: message || null, batchId });
        if (draft.photos.some((p) => p.mediaId === r.result.mediaId)) continue; // same photo sent twice in this chat
        photos.push(await photoFor(db, actor.tenantId, r.result.mediaId, f.name, r.replayed ? "uploaded before" : undefined));
      }
    } catch (e) {
      if (e instanceof DomainError) failures.push(`${f.name}: ${e.message}`);
      else throw e;
    }
  }

  const turn = await converse(db, actor.tenantId, draft, message, photos);
  revalidatePath("/", "layout");
  if (!turn.confirm) return { draft: turn.draft, reply: turn.reply, failures };
  if (readOnlyWhy) return { draft: turn.draft, reply: { ...turn.reply, say: [readOnlyWhy], ready: false }, failures };

  // The owner said yes: apply exactly what the last summary listed.
  const d = turn.draft;
  const applied = await applyChatProposal(db, actor, d.submitKey, {
    mediaIds: d.photos.map((p) => p.mediaId),
    classifications: Object.fromEntries(d.photos.map((p) => [p.mediaId, p.classification])),
    operatorId: d.operator.kind === "existing" || d.operator.kind === "alias_of" ? d.operator.id : null,
    newOperatorName: d.operator.kind === "new" ? d.operatorText : null,
    region: d.region || null,
    aliasOf: d.operator.kind === "alias_of" ? { organisationId: d.operator.id, alias: d.operatorText } : null,
    aircraftTypeId: d.typeId,
    aircraft:
      d.aircraft.kind === "existing" ? { mode: "existing", aircraftId: d.aircraft.id }
      : d.aircraft.kind === "new" ? { mode: "new", registration: d.tail, distinct: d.aircraft.distinct }
      : { mode: "none" },
    info: { yom: d.yom, yor: d.yor, capacity: d.capacity, wifiStatus: d.wifi, wifiDetail: d.wifiDetail || null, smoking: d.smoking ?? "unknown", pets: d.pets ?? "unknown", cleaningFee: d.cleaningFee || null, notes: d.notes || null },
    base: d.base ?? undefined,
    evidenceText: d.evidence.join("\n") || null,
  });
  if (applied.photos.some((p) => p.outcome === "approved")) exportAfterResponse(session);
  revalidatePath("/", "layout");
  const say = [tr(L, "Done."), ...applied.steps.map((x) => trStep(L, x)), ...applied.photos.map((p) => tr(L, "Photo: {detail}", { detail: trStep(L, p.detail) }))];
  return { draft: { ...emptyDraft(randomUUID()), lang: L }, reply: { say, chips: [], ready: false, done: true }, failures, applied };
}
