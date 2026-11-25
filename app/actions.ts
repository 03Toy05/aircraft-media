"use server";

import { randomUUID } from "node:crypto";
import { serverT } from "@/lib/uiLang";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getDriveClient, getFileStore } from "@/storage";
import { importDriveFolder, type DriveImportSummary } from "@/domain/driveImport";
import { bringBackForReview, ingestPdf } from "@/domain/intake";
import { cookies, headers } from "next/headers";
import { VIEW_AS_COOKIE, requireAdmin, requireUser, requireWriter } from "@/lib/session";
import * as accounts from "@/domain/accounts";
import { exportAfterResponse, runExport } from "@/lib/cbosExportRunner";
import { DomainError } from "@/domain/errors";
import type { Actor } from "@/domain/action";
import * as dir from "@/domain/directory";
import * as contacts from "@/domain/contacts";
import * as quoteTemplates from "@/domain/quoteTemplates";
import * as quoteShares from "@/domain/quoteShares";
import * as quoteEmail from "@/domain/quoteEmail";
import { photoAllowed } from "@/domain/photoAccess";
import { brokerQuotePdf } from "@/domain/quotePdf";
import { ensureLink } from "@/domain/quoteLinks";
import * as branding from "@/domain/branding";
import { siteAddress } from "@/lib/site";
import { sendMail } from "@/lib/mail";
import * as passwords from "@/domain/passwords";
import * as library from "@/domain/library";
import { readPackFiles, startPackImport } from "@/domain/libraryUpload";
import { after } from "next/server";
import * as media from "@/domain/media";
import * as settings from "@/domain/settings";
import { applyChatProposal } from "@/domain/chat";
import { trStep } from "@/domain/toyText";
import { makeCombinedPhoto } from "@/domain/combinedPhoto";
import { and, eq } from "drizzle-orm";
import { aircraft as aircraftTable, aircraftMedia as mediaTable, users } from "@/db/schema";
import { CLASSIFICATIONS, type Classification, type OrgRole, type RightsStatus, type WifiStatus, type YesNoStatus } from "@/domain/constants";
import { signOut } from "@/auth";

// ------------------------------------------------------------------ helpers

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const optStr = (fd: FormData, k: string) => str(fd, k) || null;
const optNum = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === "" ? null : Number(v);
};
const list = (s: string) => s.split(/[,\n;/]/).map((x) => x.trim()).filter(Boolean);
const key = (fd: FormData) => str(fd, "key") || randomUUID();

function withParam(url: string, name: string, value: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${name}=${encodeURIComponent(value)}`;
}

/** Runs a domain action; a DomainError becomes a visible message, anything else is a real failure. */
async function run(returnTo: string, ok: string | null, fn: () => Promise<unknown>, successTo?: string) {
  let error: string | null = null;
  try {
    await fn();
  } catch (e) {
    if (e instanceof DomainError) error = e.message;
    else throw e;
  }
  revalidatePath("/", "layout");
  if (error) redirect(withParam(returnTo, "error", error));
  const dest = successTo ?? returnTo;
  redirect(ok ? withParam(dest, "ok", ok) : dest);
}

/** Back to the page the form was on (same site only). */
async function backTo(): Promise<string> {
  const ref = (await headers()).get("referer");
  try {
    const u = ref ? new URL(ref) : null;
    return u ? `${u.pathname}${u.search.replace(/([?&])(error|ok)=[^&]*/g, "$1").replace(/[?&]+$/, "")}` : "/";
  } catch {
    return "/";
  }
}

/** Every action that adds or changes data: refused (with a message on the same page) when the workspace is read-only. */
async function ctx() {
  let actor;
  try {
    ({ actor } = await requireWriter());
  } catch (e) {
    if (e instanceof DomainError) redirect(withParam(await backTo(), "error", e.message));
    throw e;
  }
  return { actor, db: await getDb(), store: getFileStore() };
}

// ------------------------------------------------------------------ session

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

// ------------------------------------------------------------------ intake

export type UploadResult = { name: string; status: "new" | "duplicate" | "failed" | "partial"; mediaId?: string; error?: string; detail?: string; alreadyApproved?: boolean };

/** One uploaded file (a photo, or a PDF whose photos are taken out): what happened, and how many photos now wait in Review. */
async function uploadOne(actor: Actor, db: Awaited<ReturnType<typeof getDb>>, store: ReturnType<typeof getFileStore>, f: File, cardText: string | null, batchId: string): Promise<{ result: UploadResult; toReview: number }> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  const t = await serverT();
  try {
    let ids: string[];
    let status: "new" | "duplicate" | "partial";
    let detail = "";
    if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
      const r = await ingestPdf(db, store, actor, { filename: f.name, bytes, cardText, batchId });
      const x = r.result;
      ids = x.extracted.map((e) => e.mediaId);
      status = r.replayed ? "duplicate" : x.status === "partially_processed" ? "partial" : "new";
      detail = x.status === "no_images"
        ? t("PDF kept. No embedded photos were found in its {n} page(s) — page rendering is not supported; export the pages as images and upload those.", { n: x.pageCount })
        : t("{n} photo(s) taken out of {pages} page(s)", { n: x.extracted.length, pages: x.pageCount }) + (x.skipped.length ? t("; skipped {n}: {list}", { n: x.skipped.length, list: x.skipped.map((k) => `p${k.page} ${k.reason}`).join("; ") }) : "");
    } else {
      const r = await media.ingestUpload(db, store, actor, { filename: f.name, bytes, cardText, batchId });
      ids = [r.result.mediaId];
      status = r.replayed ? "duplicate" : "new";
    }
    // Photos the workspace already had are reused: say where each one is, and bring removed ones back to Review.
    const st = await bringBackForReview(db, actor, ids);
    const where: string[] = [];
    if (st.waiting.length) where.push(t("{n} waiting in Review", { n: st.waiting.length }));
    if (st.reopened.length) where.push(t("{n} removed earlier, now back in Review", { n: st.reopened.length }));
    if (st.approved.length) {
      const planes = [...new Set(st.approved.map((a) => a.aircraftId).filter((x): x is string => !!x))];
      const names = (await Promise.all(planes.map((id) => dir.getAircraftCard(db, id)))).filter(Boolean).map((c) => [c!.operator, c!.aircraft, c!.tailNumber].filter(Boolean).join(" "));
      where.push(names.length ? t("{n} already approved (on {names}), so not in Review", { n: st.approved.length, names: names.join("; ") }) : t("{n} already approved, so not in Review", { n: st.approved.length }));
    }
    return {
      result: { name: f.name, status, mediaId: [...st.waiting, ...st.reopened][0] ?? ids[0], detail: [detail, where.join("; ")].filter(Boolean).join(". "), ...(st.approved.length ? { alreadyApproved: true } : {}) },
      toReview: st.waiting.length + st.reopened.length,
    };
  } catch (e) {
    if (e instanceof DomainError) return { result: { name: f.name, status: "failed", error: e.message }, toReview: 0 };
    throw e;
  }
}

/** Where to go after an upload: straight to Review when everything went in, otherwise the list of what happened. */
async function afterUpload(results: UploadResult[], toReview: number): Promise<string> {
  if (toReview && results.every((r) => r.status !== "failed" && r.status !== "partial") && results.every((r) => !r.alreadyApproved && !/already approved/.test(r.detail ?? ""))) {
    const t = await serverT();
    return withParam("/review", "ok", toReview === 1 ? t("{n} photo waiting in Review. Check the views and details of each set, then save it.", { n: toReview }) : t("{n} photos waiting in Review. Check the views and details of each set, then save it.", { n: toReview }));
  }
  return withParam("/intake", "r", JSON.stringify(results));
}

/** The whole form at once (used when the page's script has not loaded). */
export async function uploadMediaAction(fd: FormData) {
  const { actor, db, store } = await ctx();
  const cardText = optStr(fd, "cardText");
  const batchId = randomUUID(); // one upload = one batch: the card text and the assignment apply to all its photos
  const results: UploadResult[] = [];
  let toReview = 0;
  for (const f of fd.getAll("files")) {
    if (!(f instanceof File) || f.size === 0) continue;
    const r = await uploadOne(actor, db, store, f, cardText, batchId);
    results.push(r.result);
    toReview += r.toReview;
  }
  revalidatePath("/", "layout");
  redirect(await afterUpload(results, toReview));
}

/**
 * One file of an upload, sent on its own so the page can show progress ("3 of 10") and send a few at once.
 * The files of one upload share a batch id (made by the page), so they stay together in Review as before.
 */
export async function uploadFileAction(fd: FormData): Promise<{ result: UploadResult; toReview: number }> {
  const f = fd.get("file");
  const name = f instanceof File ? f.name : "file";
  let actor;
  try {
    ({ actor } = await requireWriter());
  } catch (e) {
    if (e instanceof DomainError) return { result: { name, status: "failed", error: e.message }, toReview: 0 };
    throw e;
  }
  if (!(f instanceof File) || f.size === 0) return { result: { name, status: "failed", error: (await serverT())("The file was empty.") }, toReview: 0 };
  const given = str(fd, "batchId");
  const batchId = /^[0-9a-f-]{36}$/.test(given) ? given : randomUUID();
  return uploadOne(actor, await getDb(), getFileStore(), f, optStr(fd, "cardText"), batchId);
}

/** After the page has sent every file: refresh the pages and say where to go next. */
export async function finishUploadAction(results: UploadResult[], toReview: number): Promise<string> {
  revalidatePath("/", "layout");
  return await afterUpload(results.slice(0, 200), toReview);
}

export async function driveImportAction(fd: FormData) {
  const { actor, db, store } = await ctx();
  const client = getDriveClient();
  let error: string | null = null;
  let summary: unknown = null;
  try {
    // The Drive folder is the admin's own; other users upload their photos instead.
    if (!(await requireUser()).isAdmin) throw new DomainError("ADMIN_ONLY", "Only the admin can import from the Google Drive folder. Upload your photos instead.");
    if (!client) throw new DomainError("DRIVE_NOT_CONNECTED", "Google Drive is not connected yet (see the configuration guide).");
    const s = await importDriveFolder(db, client, store, actor, str(fd, "folder") || client.rootFolderId);
    summary = { ...s, items: s.items.filter((i) => i.outcome !== "already_imported").slice(0, 25) };
  } catch (e) {
    if (e instanceof DomainError) error = e.message;
    else throw e;
  }
  revalidatePath("/", "layout");
  if (error) redirect(withParam("/intake", "error", error));
  // New photos and nothing failed: go to Review, where each Drive folder is one set with its views already scanned.
  const s = summary as DriveImportSummary;
  if (s.imported > 0 && s.failed === 0) {
    const more = s.truncated ? " More files remain: run the import again to continue." : "";
    redirect(withParam("/review", "ok", `${s.imported} file${s.imported === 1 ? "" : "s"} imported from Drive (“${s.folderName ?? "folder"}”) and scanned. Each folder is one set below.${more}`));
  }
  redirect(withParam("/intake", "d", JSON.stringify(summary)));
}

// ------------------------------------------------------------------ organisations & types

export async function createOrganisationAction(fd: FormData) {
  const { actor, db } = await ctx();
  const roles = fd.getAll("roles").map(String) as OrgRole[];
  await run("/fleet?add=operator#add-operator", (await serverT())("Operator created"), () =>
    dir.createOrganisation(db, actor, key(fd), { name: str(fd, "name"), roles, aliases: list(str(fd, "aliases")), region: str(fd, "region"), base: str(fd, "base") }),
  "/fleet");
}

/** "Create operator and add aircraft": the same as above, then straight to the aircraft form with this operator chosen. */
export async function createOperatorThenAircraftAction(fd: FormData) {
  const { actor, db } = await ctx();
  const roles = fd.getAll("roles").map(String) as OrgRole[];
  let newId = "";
  let error: string | null = null;
  try {
    newId = (await dir.createOrganisation(db, actor, key(fd), { name: str(fd, "name"), roles, aliases: list(str(fd, "aliases")), region: str(fd, "region"), base: str(fd, "base") })).result.organisationId;
  } catch (e) {
    if (e instanceof DomainError) error = e.message;
    else throw e;
  }
  revalidatePath("/", "layout");
  if (error) redirect(withParam("/fleet?add=operator#add-operator", "error", error));
  redirect(`/fleet?add=aircraft&operatorId=${newId}&ok=${encodeURIComponent((await serverT())("Operator created. Now add its aircraft"))}#add-aircraft`);
}

export async function renameOrgAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "organisationId");
  await run(`/organisations/${id}`, (await serverT())("Name changed"), () =>
    dir.renameOrganisation(db, actor, key(fd), { organisationId: id, name: str(fd, "name"), keepOldAsAlias: fd.get("keepOld") === "on" }),
  );
}

export async function setOrgRegionAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "organisationId");
  await run(str(fd, "returnTo") || "/fleet", (await serverT())("Region saved"), () => dir.setOrganisationRegion(db, actor, key(fd), { organisationId: id, region: str(fd, "region") || null, base: str(fd, "base") })); 
}

/** Operator page: its website, email and sales contact. */
export async function setOrgContactsAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "organisationId");
  await run(`/organisations/${id}`, (await serverT())("Contact details saved"), () =>
    dir.setOrganisationContacts(db, actor, key(fd), { organisationId: id, website: str(fd, "website"), email: str(fd, "email"), salesContact: String(fd.get("salesContact") ?? "") }));
}

export async function saveQuoteTemplateAction(fd: FormData) {
  const { actor, db } = await ctx();
  const language = str(fd, "language");
  const raw = (k: string) => String(fd.get(k) ?? "");
  await run(`/quote/template?lang=${encodeURIComponent(language)}`, (await serverT())("Template saved"), () =>
    quoteTemplates.saveQuoteTemplate(db, actor, key(fd), {
      language,
      template: { greeting: raw("greeting"), block: raw("block"), closing: raw("closing"), yes: raw("yes"), no: raw("no"), tbc: raw("tbc"), seats: raw("seats"), routing: raw("routing"), times: raw("times") },
    }),
  );
}

export async function resetQuoteTemplateAction(fd: FormData) {
  const { actor, db } = await ctx();
  const language = str(fd, "language");
  await run(`/quote/template?lang=${encodeURIComponent(language)}`, (await serverT())("Back to the standard wording"), () => quoteTemplates.resetQuoteTemplate(db, actor, key(fd), { language }));
}

export async function createContactAction(fd: FormData) {
  const { actor, db } = await ctx();
  await run("/contacts", (await serverT())("Contact added"), () => contacts.createContact(db, actor, key(fd), { name: str(fd, "name"), englishName: optStr(fd, "englishName"), app: str(fd, "app"), handle: str(fd, "handle"), notes: str(fd, "notes") }));
}

export async function updateContactAction(fd: FormData) {
  const { actor, db } = await ctx();
  await run("/contacts", (await serverT())("Contact saved"), () => contacts.updateContact(db, actor, key(fd), { contactId: str(fd, "contactId"), name: str(fd, "name"), englishName: optStr(fd, "englishName"), app: str(fd, "app"), handle: str(fd, "handle"), notes: str(fd, "notes") }));
}

export async function retireContactAction(fd: FormData) {
  const { actor, db } = await ctx();
  await run("/contacts", (await serverT())("Contact removed"), () => contacts.retireContact(db, actor, key(fd), { contactId: str(fd, "contactId") }));
}

export async function addOrgAliasAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "organisationId");
  await run(`/organisations/${id}`, (await serverT())("Alias added"), () => dir.addOrganisationAlias(db, actor, key(fd), { organisationId: id, alias: str(fd, "alias") }));
}

export async function createTypeAction(fd: FormData) {
  const { actor, db } = await ctx();
  await run("/fleet", (await serverT())("Aircraft type created"), () =>
    dir.createAircraftType(db, actor, key(fd), { manufacturer: str(fd, "manufacturer"), model: str(fd, "model"), aliases: list(str(fd, "aliases")), category: optStr(fd, "category") }),
  );
}

export async function loadStandardTypesAction(fd: FormData) {
  const { actor, db } = await ctx();
  const r = await dir.loadStandardAircraftTypes(db, actor, key(fd));
  revalidatePath("/", "layout");
  const x = r.result;
  redirect(withParam("/fleet", "ok", (await serverT())("Standard types loaded: {added} added, {categorised} given a category, {skipped} already there", { added: x.added, categorised: x.categorised, skipped: x.skipped })));
}

export async function setTypeCategoryAction(fd: FormData) {
  const { actor, db } = await ctx();
  await run("/fleet", (await serverT())("Category saved"), () => dir.setAircraftTypeCategory(db, actor, key(fd), { aircraftTypeId: str(fd, "aircraftTypeId"), category: optStr(fd, "category") }));
}

export async function addTypeAliasAction(fd: FormData) {
  const { actor, db } = await ctx();
  await run("/fleet", (await serverT())("Alias added"), () => dir.addAircraftTypeAlias(db, actor, key(fd), { aircraftTypeId: str(fd, "aircraftTypeId"), alias: str(fd, "alias") }));
}

// ------------------------------------------------------------------ aircraft

function infoFrom(fd: FormData) {
  return {
    yom: optNum(fd, "yom"),
    yor: optNum(fd, "yor"),
    capacity: optNum(fd, "capacity"),
    wifiStatus: (str(fd, "wifiStatus") || "unknown") as WifiStatus,
    wifiDetail: optStr(fd, "wifiDetail"),
    smoking: (str(fd, "smoking") || "unknown") as YesNoStatus,
    pets: (str(fd, "pets") || "unknown") as YesNoStatus,
    cleaningFee: optStr(fd, "cleaningFee"),
    notes: optStr(fd, "notes"),
  };
}

function baseFrom(fd: FormData) {
  const mode = str(fd, "baseMode");
  if (mode === "floating") return { mode: "floating" as const, locations: [] };
  if (mode === "based") return { mode: "based" as const, locations: list(str(fd, "baseLocations")) };
  return undefined; // "not recorded"
}

export async function createAircraftAction(fd: FormData) {
  const { actor, db } = await ctx();
  const existingTail = str(fd, "tailResolution") === "distinct_aircraft";
  let newId: string | null = null;
  let error: string | null = null;
  try {
    // No operator chosen but a new name typed: create that operator first (same submission key, so a retry reuses it).
    let operatorId = optStr(fd, "operatorId");
    const newOperator = optStr(fd, "newOperatorName");
    if (!operatorId && newOperator) {
      operatorId = (await dir.createOrganisation(db, actor, `${key(fd)}:operator`, { name: newOperator, roles: ["operator"], aliases: [] })).result.organisationId;
    }
    // No base given: start from the operator's usual base, if it has one.
    let base = baseFrom(fd);
    if (!base && operatorId) {
      const usual = await dir.getOrganisationBase(db, actor.tenantId, operatorId);
      if (usual.length) base = { mode: "based" as const, locations: usual };
    }
    const r = await dir.createAircraft(db, actor, key(fd), {
      aircraftTypeId: str(fd, "aircraftTypeId"),
      registration: str(fd, "registration"),
      serialNumber: optStr(fd, "serialNumber"),
      operatorId,
      base,
      info: infoFrom(fd),
      tailResolution: existingTail ? "distinct_aircraft" : undefined,
      evidenceText: optStr(fd, "evidenceText"),
    });
    newId = r.result.aircraftId;
  } catch (e) {
    if (e instanceof DomainError) error = e.message;
    else throw e;
  }
  revalidatePath("/", "layout");
  if (error) redirect(withParam("/fleet", "error", error));
  redirect(`/aircraft/${newId}?ok=${encodeURIComponent((await serverT())("Aircraft created"))}`);
}

export async function changeTailAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "aircraftId");
  await run(`/aircraft/${id}`, (await serverT())("Tail number changed; history kept"), () =>
    dir.changeRegistration(db, actor, key(fd), {
      aircraftId: id,
      newRegistration: str(fd, "newRegistration"),
      effectiveDate: optStr(fd, "effectiveDate"),
      tailResolution: str(fd, "tailResolution") === "distinct_aircraft" ? "distinct_aircraft" : undefined,
    }),
  );
}

export async function addInfoVersionAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "aircraftId");
  await run(`/aircraft/${id}`, (await serverT())("New information version saved"), () =>
    dir.addInformationVersion(db, actor, key(fd), { aircraftId: id, expectedVersion: Number(str(fd, "expectedVersion")), info: infoFrom(fd), effectiveDate: optStr(fd, "effectiveDate") }),
  );
}

export async function setBasesAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "aircraftId");
  const base = baseFrom(fd);
  await run(`/aircraft/${id}`, (await serverT())("Base updated"), async () => {
    if (!base) throw new DomainError("INVALID", (await serverT())("Choose Based or Floating"));
    return dir.setBases(db, actor, key(fd), { aircraftId: id, base });
  });
}

export async function setOperatorAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "aircraftId");
  await run(`/aircraft/${id}`, (await serverT())("Operator updated"), () => dir.setOperator(db, actor, key(fd), { aircraftId: id, organisationId: str(fd, "organisationId"), validFrom: optStr(fd, "validFrom") }));
}

export async function addManagementAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "aircraftId");
  await run(`/aircraft/${id}`, (await serverT())("Management company added"), () => dir.addManagementCompany(db, actor, key(fd), { aircraftId: id, organisationId: str(fd, "organisationId") }));
}

// ------------------------------------------------------------------ media review

export async function mediaMetadataAction(fd: FormData) {
  const { actor, db } = await ctx();
  exportAfterResponse(await requireUser());
  const id = str(fd, "mediaId");
  const cls = str(fd, "classification") as Classification;
  await run(`/review/${id}`, (await serverT())("Saved"), () =>
    media.updateMediaMetadata(db, actor, key(fd), {
      mediaId: id,
      expectedVersion: Number(str(fd, "expectedVersion")),
      classification: CLASSIFICATIONS.includes(cls) ? cls : undefined,
      displayOrder: optNum(fd, "displayOrder") ?? undefined,
      rightsStatus: (str(fd, "rightsStatus") || undefined) as RightsStatus | undefined,
    }),
  );
}

export async function mediaAssociationAction(fd: FormData) {
  const { actor, db } = await ctx();
  exportAfterResponse(await requireUser());
  const id = str(fd, "mediaId");
  const status = str(fd, "status") as "actual_aircraft" | "representative_type" | "unresolved";
  await run(`/review/${id}`, (await serverT())("Association saved"), () =>
    media.setMediaAssociation(db, actor, key(fd), {
      mediaId: id,
      expectedVersion: Number(str(fd, "expectedVersion")),
      status,
      aircraftId: optStr(fd, "aircraftId"),
      aircraftTypeId: optStr(fd, "aircraftTypeId"),
    }),
  );
}

export async function approveAction(fd: FormData) {
  const { actor, db } = await ctx();
  exportAfterResponse(await requireUser());
  const id = str(fd, "mediaId");
  // After a decision, go back to the queue so the next photo is one click away.
  await run(`/review/${id}`, (await serverT())("Photo approved"), () =>
    media.approveMedia(db, actor, { mediaId: id, contentVersionId: str(fd, "contentVersionId"), expectedVersion: Number(str(fd, "expectedVersion")) }),
    "/review",
  );
}

export async function useVersionAction(fd: FormData) {
  const { actor, db } = await ctx();
  exportAfterResponse(await requireUser());
  const id = str(fd, "mediaId");
  await run(`/review/${id}`, (await serverT())("Switched version (earlier versions are kept)"), () =>
    media.useContentVersion(db, actor, key(fd), { mediaId: id, contentVersionId: str(fd, "contentVersionId"), expectedVersion: Number(str(fd, "expectedVersion")) }),
  );
}

export async function rejectAction(fd: FormData) {
  const { actor, db } = await ctx();
  exportAfterResponse(await requireUser());
  const id = str(fd, "mediaId");
  await run(`/review/${id}`, (await serverT())("Photo rejected. It is listed under Rejected, where you can reopen it."), () =>
    media.rejectMedia(db, actor, key(fd), { mediaId: id, expectedVersion: Number(str(fd, "expectedVersion")), reason: str(fd, "reason") }),
    "/review",
  );
}

export async function reopenAction(fd: FormData) {
  const { actor, db } = await ctx();
  exportAfterResponse(await requireUser());
  const id = str(fd, "mediaId");
  await run(`/review/${id}`, (await serverT())("Reopened for review"), () => media.reopenMedia(db, actor, key(fd), { mediaId: id, expectedVersion: Number(str(fd, "expectedVersion")) }));
}

export async function retireAction(fd: FormData) {
  const { actor, db } = await ctx();
  exportAfterResponse(await requireUser());
  const id = str(fd, "mediaId");
  await run(`/review/${id}`, (await serverT())("Retired"), () => media.retireMedia(db, actor, key(fd), { mediaId: id }));
}

export async function restoreAction(fd: FormData) {
  const { actor, db } = await ctx();
  exportAfterResponse(await requireUser());
  const id = str(fd, "mediaId");
  await run(`/review/${id}`, (await serverT())("Restored"), () => media.restoreMedia(db, actor, key(fd), { mediaId: id }));
}

export async function cropAction(fd: FormData) {
  const { actor, db, store } = await ctx();
  exportAfterResponse(await requireUser());
  const id = str(fd, "mediaId");
  const input = {
    mediaId: id,
    sourceContentVersionId: str(fd, "contentVersionId"),
    rect: { x: Math.round(Number(str(fd, "x"))), y: Math.round(Number(str(fd, "y"))), width: Math.round(Number(str(fd, "width"))), height: Math.round(Number(str(fd, "height"))) },
    key: str(fd, "key") || undefined,
  };
  if (str(fd, "mode") === "separate") {
    let newId: string | null = null;
    let error: string | null = null;
    try {
      newId = (await media.extractCropAsMedia(db, store, actor, input)).result.mediaId;
    } catch (e) {
      if (e instanceof DomainError) error = e.message;
      else throw e;
    }
    revalidatePath("/", "layout");
    if (error) redirect(withParam(`/review/${id}`, "error", error));
    redirect(withParam(`/review/${newId}`, "ok", (await serverT())("Separated into a new photo for review")));
  }
  await run(`/review/${id}`, (await serverT())("Crop applied as a new version"), () => media.recropMedia(db, store, actor, input));
}

export interface AssignOutcome {
  ok: boolean;
  message: string;
  /** Photos that were approved by this save. */
  approvedIds: string[];
}

/** Shared by both Review pages: assign the ticked photos to an operator and aircraft, save the details, approve. */
async function assignFromForm(actor: Actor, db: Awaited<ReturnType<typeof getDb>>, fd: FormData): Promise<AssignOutcome> {
  const mediaId = str(fd, "mediaId");
  const operatorChoice = str(fd, "operator"); // "", "new" or an organisation id
  const aircraftChoice = str(fd, "aircraft"); // "new", "none" or an aircraft id
  const tail = str(fd, "tail");
  const baseMode = str(fd, "baseMode");
  const baseLocations = list(str(fd, "baseLocations"));
  const asClass = (v: string): Classification => (CLASSIFICATIONS.includes(v as Classification) ? (v as Classification) : "unclassified");
  // The other photos sent with this one (same source evidence) that the owner kept ticked, each with its own view.
  const also = [...new Set(fd.getAll("also").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x) && x !== mediaId))];
  const ids = [...(mediaId ? [mediaId] : []), ...also];
  const t = await serverT();
  if (!ids.length) return { ok: false, message: t("Tick at least one photo."), approvedIds: [] };
  const classifications: Record<string, Classification> = {};
  if (mediaId) classifications[mediaId] = asClass(str(fd, "classification"));
  for (const id of also) classifications[id] = asClass(str(fd, `cls_${id}`));
  try {
    const r = await applyChatProposal(db, actor, key(fd), {
      mediaIds: ids,
      classifications,
      operatorId: operatorChoice && operatorChoice !== "new" ? operatorChoice : null,
      newOperatorName: operatorChoice === "new" ? str(fd, "newOperatorName") : null,
      aircraftTypeId: optStr(fd, "aircraftTypeId"),
      aircraft: aircraftChoice === "new" ? { mode: "new", registration: tail } : aircraftChoice === "none" || !aircraftChoice ? { mode: "none" } : { mode: "existing", aircraftId: aircraftChoice },
      info: infoFrom(fd),
      base: baseMode === "floating" ? { mode: "floating", locations: [] } : baseMode === "based" && baseLocations.length ? { mode: "based", locations: baseLocations } : undefined,
    });
    // One line per outcome ("3 photos approved as this aircraft"), not one per photo.
    const tally = new Map<string, number>();
    for (const p of r.photos) tally.set(p.detail, (tally.get(p.detail) ?? 0) + 1);
    const message = [...r.steps.map((x) => trStep(t.lang, x)), ...[...tally].map(([detail, n]) => (n === 1 ? t("Photo {detail}", { detail: trStep(t.lang, detail) }) : t("{n} photos {detail}", { n, detail: trStep(t.lang, detail) })))].join(t(". "));
    const approvedIds = r.photos.filter((p) => p.outcome === "approved").map((p) => p.mediaId);
    return { ok: approvedIds.length === ids.length, message: message || t("Saved"), approvedIds };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, message: e.message, approvedIds: [] };
    throw e;
  }
}

/** Review page for one photo: assign it (and the ticked photos sent with it), then go back to the queue. */
export async function assignPhotoAction(fd: FormData) {
  const { actor, db } = await ctx();
  const r = await assignFromForm(actor, db, fd);
  if (r.approvedIds.length) exportAfterResponse(await requireUser());
  revalidatePath("/", "layout");
  if (r.ok) redirect(withParam("/review", "ok", r.message));
  redirect(withParam(`/review/${str(fd, "mediaId")}`, "error", r.message || (await serverT())("Nothing was saved")));
}

/** Review worksheet: save one group and stay on the page. Returns what happened instead of navigating. */
export async function assignGroupAction(fd: FormData): Promise<AssignOutcome> {
  let actor: Actor;
  try {
    ({ actor } = await requireWriter());
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, message: e.message, approvedIds: [] };
    throw e;
  }
  const r = await assignFromForm(actor, await getDb(), fd);
  if (r.approvedIds.length) exportAfterResponse(await requireUser());
  revalidatePath("/", "layout");
  return r;
}

// ------------------------------------------------------------------ settings

export async function addNumberAction(fd: FormData) {
  const { actor, db } = await ctx();
  await run("/settings", (await serverT())("Number added"), () => settings.addVerifiedNumber(db, actor, key(fd), { phone: str(fd, "phone") }));
}

export async function deactivateNumberAction(fd: FormData) {
  const { actor, db } = await ctx();
  await run("/settings", (await serverT())("Number deactivated"), () => settings.deactivateNumber(db, actor, key(fd), { numberId: str(fd, "numberId") }));
}

export async function setPreferredOperatorsAction(fd: FormData) {
  const { actor, db } = await ctx();
  const ids = fd.getAll("organisationId").map(String).filter(Boolean);
  await run(str(fd, "returnTo") || "/settings", (await serverT())("Preferred operators saved"), () => dir.setPreferredOperators(db, actor, key(fd), { organisationIds: ids }));
}

/** Star or unstar an operator from the Quote page, without leaving it. Returns the new list, or a message. */
export async function togglePreferredOperator(organisationId: string): Promise<{ ids: string[]; error?: string }> {
  let actor;
  try {
    ({ actor } = await requireWriter());
  } catch (e) {
    if (e instanceof DomainError) return { ids: await dir.getPreferredOperators(await getDb(), (await requireUser()).actor.tenantId), error: e.message };
    throw e;
  }
  const db = await getDb();
  const cur = await dir.getPreferredOperators(db, actor.tenantId);
  const next = cur.includes(organisationId) ? cur.filter((x) => x !== organisationId) : [...cur, organisationId];
  if (next.length > dir.MAX_PREFERRED_OPERATORS) return { ids: cur, error: (await serverT())("You already have {n} preferred operators. Remove one first (tap its star).", { n: dir.MAX_PREFERRED_OPERATORS }) };
  try {
    await dir.setPreferredOperators(db, actor, randomUUID(), { organisationIds: next });
  } catch (e) {
    if (e instanceof DomainError) return { ids: cur, error: e.message };
    throw e;
  }
  revalidatePath("/settings");
  return { ids: next };
}

export async function setLanguageAction(fd: FormData) {
  const { actor, db } = await ctx();
  await run("/settings", (await serverT())("Language saved"), () => settings.setPreferredLanguage(db, actor, key(fd), { language: str(fd, "language") }));
}

// ------------------------------------------------------------------ admin (platform owner only)

async function adminCtx() {
  const s = await requireAdmin();
  return { s, db: await getDb(), adminEmail: s.email };
}

export async function inviteUserAction(fd: FormData) {
  const { s, db } = await adminCtx();
  const plan = str(fd, "plan") === "full" ? "full" : "trial";
  await run("/admin", "Invited. Aircraft Media does not email them: tap Copy invite message on their card and send it by WhatsApp or email.", () => accounts.inviteUser(db, s.actor.id, { email: str(fd, "email"), plan, name: optStr(fd, "name") }));
}

export async function extendTrialAction(fd: FormData) {
  const { db, adminEmail } = await adminCtx();
  await run("/admin", "Trial extended", () => accounts.extendTrial(db, adminEmail, str(fd, "userId"), Number(str(fd, "days"))));
}

export async function setPlanAction(fd: FormData) {
  const { db, adminEmail } = await adminCtx();
  const plan = str(fd, "plan") === "full" ? "full" : "trial";
  await run("/admin", plan === "full" ? "Now a full account (no time limit)" : "Back on a 14-day trial", () => accounts.setPlan(db, adminEmail, str(fd, "userId"), plan));
}

export async function setBlockedAction(fd: FormData) {
  const { db, adminEmail } = await adminCtx();
  const blocked = str(fd, "blocked") === "1";
  await run("/admin", blocked ? "Access turned off; their work is kept" : "Access turned back on", () => accounts.setBlocked(db, adminEmail, str(fd, "userId"), blocked));
}

export async function withdrawInviteAction(fd: FormData) {
  const { db, adminEmail } = await adminCtx();
  await run("/admin", "Invitation withdrawn", () => accounts.withdrawInvite(db, adminEmail, str(fd, "userId")));
}

/** Admin: look at a user's workspace, read-only, until "Back to my workspace". */
export async function viewAsAction(fd: FormData) {
  await requireAdmin();
  const id = str(fd, "userId");
  if (/^[0-9a-f-]{36}$/.test(id)) (await cookies()).set(VIEW_AS_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 3600 });
  revalidatePath("/", "layout");
  redirect("/fleet");
}

export async function stopViewingAction() {
  await requireAdmin();
  (await cookies()).delete(VIEW_AS_COOKIE);
  revalidatePath("/", "layout");
  redirect("/admin");
}

// ------------------------------------------------------------------ CBOS export

/** Approved photos page: bring the CBOS export folder in Drive up to date now. */
/** Aircraft page: make (or remake) the aircraft's combined photo from its current photos. */
export async function makeCombinedAction(fd: FormData) {
  const { actor, db, store } = await ctx();
  const aircraftId = str(fd, "aircraftId");
  const back = `/aircraft/${aircraftId}`;
  const t = await serverT();
  const [ac] = await db.select().from(aircraftTable).where(and(eq(aircraftTable.id, aircraftId), eq(aircraftTable.tenantId, actor.tenantId)));
  if (!ac) redirect(withParam("/fleet", "error", t("Aircraft not found")));
  let error: string | null = null;
  let ok = "";
  try {
    const r = await makeCombinedPhoto(db, store, actor, { kind: "aircraft", aircraftId, aircraftTypeId: ac.aircraftTypeId }, { replace: true });
    if (r.made) ok = r.replaced ? t("Combined photo remade. The old one was retired.") : t("Combined photo made and saved with the aircraft's photos.");
    else error = t("No combined photo made. {reason}", { reason: r.reason });
  } catch (e) {
    error = t("The combined photo could not be made: {reason}", { reason: e instanceof Error ? e.message : t("unknown error") });
  }
  revalidatePath("/", "layout");
  if (!error) exportAfterResponse(await requireUser());
  redirect(withParam(back, error ? "error" : "ok", error ?? ok));
}

export async function exportCbosAction() {
  await ctx(); // refuses read-only workspaces
  const t = await serverT();
  const s = await requireUser();
  let error: string | null = null;
  let ok = "";
  try {
    const r = await runExport(s);
    ok = t("Export to Drive “{root}” done: {added} added, {updated} refreshed, {moved} renamed or moved, {removed} removed, {unchanged} unchanged", { root: r.root, added: r.added, updated: r.updated, moved: r.moved, removed: r.removed, unchanged: r.unchanged }) + (r.skipped ? t(", {n} not exported (combined photos, or no view)", { n: r.skipped }) : "") + t(".");
    if (r.failed.length) error = `${ok} ${t("{n} failed ({error}). Press Export again to retry them.", { n: r.failed.length, error: r.failed[0].error })}`;
  } catch (e) {
    error = t("Export failed: {reason}", { reason: e instanceof Error ? e.message : t("unknown error") });
  }
  redirect(withParam("/photos", error ? "error" : "ok", error ?? ok));
}

/**
 * A quote was handed to another app (share sheet completed) or its message copied. Counted for the Users page.
 * Not counted while the admin is looking at someone else's workspace. Never fails the share.
 */
/**
 * Quote page: email the quote to the client from the site's own address, with the ticked photos attached. Replies go
 * to the broker, who can get a copy. Only photos this person may see are attached; a few emails a day at most.
 */
export async function sendQuoteEmailAction(input: {
  to: string; subject: string; text: string; rtl?: boolean; copyMe: boolean; quoteKey: string; options: number;
  photos: { id: string; name: string }[];
  /** A saved request's quote: attach its PDF (that version), and/or add the client's link to the message. */
  request?: { id: string; version?: number; pdf?: boolean; link?: boolean };
}): Promise<{ ok: boolean; message: string }> {
  const t = await serverT();
  try {
    const s = await requireUser();
    if (s.viewingAs) return { ok: false, message: t("You are looking at someone else's workspace, so nothing is sent from here.") };
    const r = quoteEmail.parseRecipients(String(input.to ?? ""));
    if ("error" in r) return { ok: false, message: r.error };
    const subject = String(input.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
    if (!subject) return { ok: false, message: t("Add a subject.") };
    let text = String(input.text ?? "").slice(0, 20_000);
    if (!text.trim()) return { ok: false, message: t("The message is empty.") };
    const photos = (Array.isArray(input.photos) ? input.photos : []).slice(0, quoteEmail.MAX_PHOTOS + 1);
    if (photos.length > quoteEmail.MAX_PHOTOS) return { ok: false, message: t("Attach {n} photos at most. Untick some and try again.", { n: quoteEmail.MAX_PHOTOS }) };
    const db = await getDb();
    if ((await quoteEmail.emailsToday(db, s.actor.id)) >= quoteEmail.MAX_EMAILS_PER_DAY) {
      return { ok: false, message: t("You have sent {n} quote emails in the last 24 hours, the most allowed. Use Copy message or Share for now.", { n: quoteEmail.MAX_EMAILS_PER_DAY }) };
    }
    const store = getFileStore();
    const attachments: { filename: string; content: Uint8Array }[] = [];
    let bytes = 0;
    for (const p of photos) {
      const id = String(p?.id ?? "");
      if (!(await photoAllowed(db, s, id))) return { ok: false, message: t("One of the photos is no longer available to you. Untick it and try again.") };
      const f = await media.readContentBytes(db, store, id).catch(() => null);
      if (!f) return { ok: false, message: t("One of the photos couldn't be read from storage. Untick it and try again.") };
      bytes += f.bytes.length;
      if (bytes > quoteEmail.MAX_ATTACH_BYTES) return { ok: false, message: t("The photos are too large for one email (25 MB). Untick some, or send them as a combined photo.") };
      attachments.push({ filename: quoteEmail.attachmentName(String(p?.name ?? ""), f.mimeType), content: f.bytes });
    }
    // A saved request: the PDF of that version first among the attachments, and the client's link under the message.
    let pdfName = "";
    if (input.request?.id && input.request.pdf) {
      const pdf = await brokerQuotePdf(db, store, s, String(input.request.id), Number(input.request.version) || undefined);
      if (!pdf) return { ok: false, message: t("That quote has no PDF (not saved yet, or its language has no PDF yet). Untick “Attach the PDF” and send the client link instead.") };
      bytes += pdf.bytes.length;
      if (bytes > quoteEmail.MAX_ATTACH_BYTES) return { ok: false, message: t("The PDF and photos are too large for one email (25 MB). Untick some photos: the PDF already has them.") };
      attachments.unshift({ filename: pdf.filename, content: pdf.bytes });
      pdfName = pdf.filename;
    }
    if (input.request?.id && input.request.link) {
      const site = await siteAddress();
      if (!site) return { ok: false, message: t("The site's address isn't set (APP_URL), so the link can't be added.") };
      const l = await ensureLink(db, s.actor, String(input.request.id));
      text = `${text}\n\n${site}/q/${l.token}`;
    }
    const [me] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, s.actor.id));
    const body = quoteEmail.quoteEmailBody(text, { rtl: !!input.rtl });
    await sendMail({
      to: r.emails, subject, text: body.text, html: body.html,
      from: quoteEmail.quoteFrom(me?.name ?? s.email.split("@")[0]),
      replyTo: s.email,
      bcc: input.copyMe ? [s.email] : undefined,
      attachments,
    });
    await quoteShares.recordQuoteShare(db, s.actor, { quoteKey: String(input.quoteKey ?? "") || randomUUID(), how: "email", options: Number(input.options) || 1 });
    const nPhotos = attachments.length - (pdfName ? 1 : 0);
    const what = [pdfName && t("the PDF ({name})", { name: pdfName }), nPhotos && (nPhotos === 1 ? t("{n} photo", { n: 1 }) : t("{n} photos", { n: nPhotos })), input.request?.link && t("the client link")].filter(Boolean).join(", ");
    const to = r.emails.join(", ");
    return { ok: true, message: what ? t("Email sent to {to} with {what}. Replies come to {me}.", { to, what, me: s.email }) : t("Email sent to {to}. Replies come to {me}.", { to, me: s.email }) };
  } catch (e) {
    console.error("Quote email failed", e);
    return { ok: false, message: t("The email couldn't be sent. Try again in a moment, or use Copy message.") };
  }
}

export async function recordQuoteShareAction(input: { quoteKey: string; how: "share" | "copy"; options: number }): Promise<void> {
  try {
    const s = await requireUser();
    if (s.viewingAs) return;
    await quoteShares.recordQuoteShare(await getDb(), s.actor, input);
  } catch (e) {
    console.error("recordQuoteShare failed", e);
  }
}

// ------------------------------------------------------------------ platform library

/** Settings: share (or stop sharing) this workspace's approved photos with the platform library. */
export async function setLibraryOptInAction(fd: FormData) {
  const s = await requireUser();
  if (s.viewingAs) redirect(withParam("/settings", "error", (await serverT())("You are looking at someone else's workspace.")));
  const on = str(fd, "libraryOptIn") === "yes";
  const db = await getDb();
  await library.setOptIn(db, s.actor.id, on);
  // Offer what is already approved, once the page has answered.
  if (on) after(async () => {
    try { await library.collectContributions(await getDb(), s.actor.tenantId, s.actor.id); } catch (e) { console.error("Library contributions failed", e); }
  });
  revalidatePath("/settings");
  const t = await serverT();
  redirect(withParam("/settings", "ok", on ? t("Thank you. Your approved photos will help build the library.") : t("Your photos are no longer offered to the library.")));
}

async function libraryAdmin() {
  const s = await requireAdmin();
  if (s.viewingAs) redirect(withParam("/library/review", "error", "Go back to your own workspace first."));
  return { admin: s.actor, db: await getDb(), store: getFileStore() };
}

/** Library review: accept the ticked photos of one aircraft, under the chosen library operator. */
export async function acceptLibraryAction(fd: FormData) {
  const { admin, db, store } = await libraryAdmin();
  const ids = fd.getAll("contributionId").map(String);
  const op = str(fd, "operator");
  let msg: string;
  try {
    if (!ids.length) throw new Error("Tick at least one photo to accept.");
    const r = await library.acceptContributions(db, store, admin, {
      matchKey: str(fd, "matchKey"),
      contributionIds: ids,
      operator: op && op !== "new" ? { kind: "existing", id: op } : { kind: "new", name: str(fd, "newOperatorName") },
    });
    msg = `Added ${r.accepted} photo${r.accepted === 1 ? "" : "s"} to the library${r.skipped.length ? ` (passed over: ${r.skipped.join("; ")})` : ""}.`;
  } catch (e) {
    redirect(withParam("/library/review", "error", (e as Error).message));
  }
  revalidatePath("/library");
  redirect(withParam("/library/review", "ok", msg));
}

/** Library review: turn the ticked photos down (their places open again for others). */
export async function rejectLibraryAction(fd: FormData) {
  const { admin, db } = await libraryAdmin();
  const n = await library.rejectContributions(db, admin, fd.getAll("contributionId").map(String));
  revalidatePath("/library/review");
  redirect(withParam("/library/review", "ok", `${n} photo${n === 1 ? "" : "s"} turned down.`));
}

/** Library review: look through every workspace that shares with the library for photos it still needs. */
export async function collectLibraryNowAction() {
  const { db } = await libraryAdmin();
  const n = await library.collectAll(db);
  revalidatePath("/library/review");
  redirect(withParam("/library/review", "ok", n ? `${n} new photo${n === 1 ? "" : "s"} offered.` : "Nothing new to offer."));
}

/** Users page: share (or stop sharing) the library with one person. */
export async function setLibraryAccessAction(fd: FormData) {
  await requireAdmin();
  const on = str(fd, "on") === "1";
  await library.setLibraryAccess(await getDb(), str(fd, "userId"), on);
  revalidatePath("/admin");
  redirect(withParam("/admin", "ok", on ? "Library shared with them." : "Library no longer shared with them."));
}

/** Settings: set (Google users) or change my password. Changing needs the current one. */
export async function changePasswordAction(fd: FormData) {
  const { email } = await requireUser();
  const db = await getDb();
  // Passwords exactly as typed (not trimmed).
  const raw = (k: string) => String(fd.get(k) ?? "");
  const pw = raw("password");
  const t = await serverT();
  const back = (k: "error" | "ok", msg: string) => redirect(withParam("/settings", k, msg));
  if (pw !== raw("again")) back("error", t("The two new passwords aren't the same."));
  const problem = passwords.passwordProblem(pw);
  if (problem) back("error", problem);
  if (await passwords.hasPassword(db, email)) {
    const r = await passwords.checkPassword(db, email, raw("current"));
    if (r.result === "locked") back("error", t("Too many wrong tries. Wait 15 minutes and try again."));
    if (r.result !== "ok") back("error", t("The current password isn't right."));
  }
  if (!(await passwords.setPassword(db, email, pw))) back("error", t("The password couldn't be saved."));
  back("ok", t("Password saved. Use it with your email on the sign-in page."));
}

/** Users page: which library operators this person may see (all of them, or only the ticked ones). */
export async function setLibraryOperatorsAction(fd: FormData) {
  await requireAdmin();
  const chosen = str(fd, "mode") === "chosen";
  const ops = fd.getAll("op").map(String).filter((id) => /^[0-9a-f-]{36}$/.test(id));
  await library.setLibraryOperators(await getDb(), str(fd, "userId"), chosen ? ops : null);
  revalidatePath("/admin");
  redirect(withParam("/admin", "ok", chosen ? `They now see ${ops.length} library operator${ops.length === 1 ? "" : "s"}.` : "They now see every library operator."));
}

/** Library page: add one aircraft (or a whole operator) to my workspace, with its photos. */
export async function addFromLibraryAction(fd: FormData) {
  const session = await requireWriter().catch((e) => { if (e instanceof DomainError) redirect(withParam("/library", "error", e.message)); throw e; });
  const db = await getDb();
  const scope = await library.libraryScope(db, session);
  const t = await serverT();
  if (!scope) redirect(withParam("/library", "error", t("The library is not shared with you yet.")));
  const back = `/library${str(fd, "q") ? `?q=${encodeURIComponent(str(fd, "q"))}` : ""}`;
  const operatorId = str(fd, "libraryOperatorId");
  // Only aircraft of the operators opened to them.
  const ids = (operatorId ? await library.libraryOperatorAircraft(db, operatorId) : [str(fd, "libraryAircraftId")].filter(Boolean))
    .filter((id) => library.scopeHasAircraft(scope, id));
  const have = await library.copiedLibraryAircraft(db, session.actor.tenantId);
  // Copying the photos takes a while (each one goes through Google Drive), so it carries on after this page answers.
  const { queued, done } = library.queueAdds(db, getFileStore(), session.actor, ids.filter((id) => !have.has(id)));
  if (queued.length) after(async () => { await done; exportAfterResponse(session); });
  redirect(withParam(back, "ok", queued.length
    ? t("Adding {n} aircraft to your workspace with their photos. This takes about half a minute each; this page shows each one as it arrives.", { n: queued.length })
    : t("Already in your workspace, or being added.")));
}

/** Aircraft page: bring a copy from the library up to date with the library's newer photos. */
export async function updateLibraryCopyAction(fd: FormData) {
  const { actor, db, store } = await ctx();
  const id = str(fd, "aircraftId");
  let msg: string;
  try {
    const r = await library.updateCopy(db, store, actor, id);
    const t = await serverT();
    msg = (r.added === 1 ? t("Updated from the library: {n} newer photo added", { n: r.added }) : t("Updated from the library: {n} newer photos added", { n: r.added })) + (r.retired ? (r.retired === 1 ? t(", {n} older one retired", { n: r.retired }) : t(", {n} older ones retired", { n: r.retired })) : "") + t(".");
  } catch (e) {
    redirect(withParam(`/aircraft/${id}`, "error", (e as Error).message));
  }
  exportAfterResponse(await requireUser());
  revalidatePath(`/aircraft/${id}`);
  redirect(withParam(`/aircraft/${id}`, "ok", msg));
}

/** Aircraft page: offer my photos as newer ones for the library aircraft with the same tail. */
export async function offerLibraryUpdateAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "aircraftId");
  let n = 0;
  try {
    n = await library.offerUpdate(db, actor, id, fd.getAll("mediaId").map(String));
  } catch (e) {
    redirect(withParam(`/aircraft/${id}`, "error", (e as Error).message));
  }
  revalidatePath(`/aircraft/${id}`);
  const t = await serverT();
  redirect(withParam(`/aircraft/${id}`, "ok", n ? (n === 1 ? t("Thank you. {n} photo offered to the library; the Aircraft Media team will compare them with the current ones.", { n }) : t("Thank you. {n} photos offered to the library; the Aircraft Media team will compare them with the current ones.", { n })) : t("Nothing new to offer (tick at least one photo that was not offered before).")));
}

/** Library review: newer photos, each replacing the library photo chosen for it (or added, or not used). */
export async function acceptLibraryUpdatesAction(fd: FormData) {
  const { admin, db, store } = await libraryAdmin();
  const choices = fd.getAll("contributionId").map(String).map((id) => ({ contributionId: id, replace: str(fd, `replace-${id}`) || "skip" }));
  let msg: string;
  try {
    const r = await library.acceptUpdates(db, store, admin, { matchKey: str(fd, "matchKey"), choices });
    msg = `Library updated: ${r.replaced} photo${r.replaced === 1 ? "" : "s"} replaced${r.added ? `, ${r.added} added` : ""}. The old ones are kept in its history.`;
  } catch (e) {
    redirect(withParam("/library/review", "error", (e as Error).message));
  }
  revalidatePath("/library");
  redirect(withParam("/library/review", "ok", msg));
}

/** Library import: the admin loads a pack (pack.json plus its photos) straight into the library. */
export async function importLibraryPackAction(fd: FormData) {
  const { admin, db, store } = await libraryAdmin();
  let jobId: string;
  try {
    const { pack, files } = await readPackFiles(fd.getAll("files"));
    // The work goes on after this answer, so the page can show progress instead of a form that seems stuck.
    jobId = startPackImport(db, store, admin, pack, files).id;
  } catch (e) {
    redirect(withParam("/library/import", "error", (e as Error).message));
  }
  redirect(withParam("/library/import", "job", jobId));
}

/**
 * Review: take an unwanted photo out of a set waiting for review (e.g. a logo or a person pulled out of a PDF).
 * It is marked rejected, so it leaves Review and is never used; it stays under Rejected, where it can be reopened.
 */
export async function removeReviewPhotoAction(mediaId: string): Promise<{ ok: boolean; message: string }> {
  let actor: Actor;
  try {
    ({ actor } = await requireWriter());
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, message: e.message };
    throw e;
  }
  const db = await getDb();
  const [m] = await db.select({ version: mediaTable.version, tenantId: mediaTable.tenantId }).from(mediaTable).where(eq(mediaTable.id, mediaId));
  if (!m || m.tenantId !== actor.tenantId) return { ok: false, message: (await serverT())("That photo is no longer here.") };
  try {
    await media.rejectMedia(db, actor, randomUUID(), { mediaId, expectedVersion: m.version, reason: "Removed in Review" });
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, message: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: (await serverT())("Removed") };
}

/** Settings: the workspace's logo and colour on its quotes (PDF and client page). */
export async function saveBrandAction(fd: FormData) {
  const back = (k: "error" | "ok", msg: string) => redirect(`${withParam("/settings", k, msg)}#branding`);
  let s;
  try {
    s = await requireWriter();
  } catch (e) {
    if (e instanceof DomainError) back("error", e.message);
    throw e;
  }
  const db = await getDb();
  try {
    if (str(fd, "removeLogo") === "1") await branding.removeBrandLogo(db, s.actor.tenantId);
    const logo = fd.get("logo");
    if (logo instanceof File && logo.size > 0) await branding.setBrandLogo(db, s.actor.tenantId, new Uint8Array(await logo.arrayBuffer()));
    const color = str(fd, "color");
    if (color) await branding.setBrandColor(db, s.actor.tenantId, color);
    const format = str(fd, "versionFormat");
    if (format) await branding.setVersionFormat(db, s.actor.tenantId, format);
  } catch (e) {
    back("error", (e as Error).message);
  }
  back("ok", (await serverT())("Branding saved. Your PDFs and client links now use it."));
}
