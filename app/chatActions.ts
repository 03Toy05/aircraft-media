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
import { bringBackForReview, ingestPdf } from "@/domain/intake";
import { libraryScope } from "@/domain/library";
import { ingestUpload } from "@/domain/media";
import { applyChatProposal, changeAircraftFields, suggestClassification, type ApplyResult } from "@/domain/chat";
import { parseChatLang, tr, trStep } from "@/domain/toyText";
import { serverT } from "@/lib/uiLang";
import { converse, emptyDraft, quoteReply, type ToyReply, type Draft, type DraftPhoto } from "@/domain/toy";

export interface TurnResult {
  draft: Draft;
  reply: ToyReply;
  failures: string[];
  applied?: ApplyResult;
  /** How long the server took for this turn (for the Speed page). */
  serverMs?: number;
}

async function photoFor(db: Awaited<ReturnType<typeof getDb>>, tenantId: string, mediaId: string, name: string, note?: string): Promise<DraftPhoto> {
  const [m] = await db.select().from(aircraftMedia).where(and(eq(aircraftMedia.id, mediaId), eq(aircraftMedia.tenantId, tenantId)));
  return { mediaId, name, contentVersionId: m?.currentContentVersionId ?? null, classification: m && m.primaryClassification !== "unclassified" ? m.primaryClassification : suggestClassification(name), note };
}

/**
 * One Toy turn. The browser sends the draft back with every message, so a short reply is always read against
 * the question Toy just asked. Photos are stored (waiting in Review) when they arrive; nothing is created,
 * attached or approved until the owner confirms.
 */
export async function toyTurnAction(fd: FormData): Promise<TurnResult> {
  const started = performance.now();
  const r = await turn(fd);
  return { ...r, serverMs: Math.round(performance.now() - started) };
}

async function turn(fd: FormData): Promise<TurnResult> {
  const session = await requireUser();
  const { actor } = session;
  const t = await serverT();
  const readOnlyWhy = session.viewingAs
    ? t("You are looking at {email}'s workspace, so nothing can be added here.", { email: session.viewingAs.email })
    : session.readOnly ? t("Your 14-day trial has ended, so I can look things up and share, but not add or change anything. Ask the admin to extend it.") : null;
  const db = await getDb();
  const store = getFileStore();
  let draft: Draft;
  try {
    // Missing fields are filled in (a quote kept over a reload comes back with only its photos and quote).
    const parsed = JSON.parse(String(fd.get("draft") ?? "")) as Partial<Draft>;
    if (!Array.isArray(parsed.photos)) throw new Error("bad draft");
    draft = { ...emptyDraft(randomUUID()), ...parsed };
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
        await bringBackForReview(db, actor, r.result.extracted.map((x) => x.mediaId)); // removed earlier: usable again
        for (const x of r.result.extracted) photos.push(await photoFor(db, actor.tenantId, x.mediaId, f.name));
        // Say why, so the broker knows what to do: skipped photos with their reasons, or a PDF with no photo files inside.
        const real = r.result.skipped.filter((s) => !/likely decorative|image mask/.test(s.reason));
        const why = [...real.reduce((m, s) => m.set(s.reason, (m.get(s.reason) ?? 0) + 1), new Map<string, number>())].map(([reason, n]) => `${n} × ${reason}`).join("; ");
        if (r.result.extracted.length === 0) {
          failures.push(why
            ? t("{file}: no photos could be taken out of this PDF. Skipped: {why}. The PDF is kept; send the photos as JPG files instead.", { file: f.name, why })
            : t("{file}: this PDF has no photo files inside (its pages are drawn as artwork, or the photos are tiny). The PDF is kept; send the photos as JPG files instead.", { file: f.name }));
        } else if (why) failures.push(r.result.extracted.length === 1 ? t("{file}: {n} photo taken out; some could not be: {why}.", { file: f.name, n: 1, why }) : t("{file}: {n} photos taken out; some could not be: {why}.", { file: f.name, n: r.result.extracted.length, why }));
      } else {
        const r = await ingestUpload(db, store, actor, { filename: f.name, bytes, cardText: message || null, batchId });
        await bringBackForReview(db, actor, [r.result.mediaId]);
        if (draft.photos.some((p) => p.mediaId === r.result.mediaId)) continue; // same photo sent twice in this chat
        photos.push(await photoFor(db, actor.tenantId, r.result.mediaId, f.name, r.replayed ? t("uploaded before") : undefined));
      }
    } catch (e) {
      if (e instanceof DomainError) failures.push(`${f.name}: ${t.error(e)}`);
      else throw e;
    }
  }

  const turn = await converse(db, actor.tenantId, draft, message, photos, { library: await libraryScope(db, session) });
  if (turn.edits) {
    // The broker said yes to changing an aircraft's record from the chat; then the quote is shown again with it.
    if (readOnlyWhy) return { draft: turn.draft, reply: { say: [readOnlyWhy], chips: [], ready: false }, failures };
    const done: string[] = [];
    const byAircraft = new Map<string, typeof turn.edits>();
    for (const e of turn.edits) byAircraft.set(e.aircraftId, [...(byAircraft.get(e.aircraftId) ?? []), e]);
    for (const [aircraftId, edits] of byAircraft) {
      try {
        await changeAircraftFields(db, actor, `${turn.draft.submitKey}:edit:${randomUUID()}`, aircraftId, Object.assign({}, ...edits.map((e) => e.set)));
        for (const e of edits) done.push(tr(L, "Changed {name}: {change}.", { name: e.label, change: e.change }));
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        failures.push(`${edits[0].label}: ${t.error(e)}`);
      }
    }
    revalidatePath("/", "layout");
    const d = turn.draft;
    if (!d.quote?.ids.length) return { draft: d, reply: { say: done, chips: [], ready: false }, failures };
    const reply = await quoteReply(db, actor.tenantId, d, { library: await libraryScope(db, session) }, done, Object.keys(d.quote.prices).length > 0);
    return { draft: d, reply, failures };
  }
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
  // The quote shown earlier in this chat stays, so prices and changes can still be typed after adding photos.
  return { draft: { ...emptyDraft(randomUUID()), lang: L, quote: d.quote }, reply: { say, chips: [], ready: false, done: true }, failures, applied };
}
