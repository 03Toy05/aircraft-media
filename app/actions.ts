"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getDriveClient, getFileStore } from "@/storage";
import { importDriveFolder } from "@/domain/driveImport";
import { ingestPdf } from "@/domain/intake";
import { requireOwner } from "@/lib/session";
import { DomainError } from "@/domain/errors";
import * as dir from "@/domain/directory";
import * as media from "@/domain/media";
import * as settings from "@/domain/settings";
import { CLASSIFICATIONS, type Classification, type OrgRole, type RightsStatus, type WifiStatus } from "@/domain/constants";
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

async function ctx() {
  const { actor } = await requireOwner();
  return { actor, db: await getDb(), store: getFileStore() };
}

// ------------------------------------------------------------------ session

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

// ------------------------------------------------------------------ intake

export async function uploadMediaAction(fd: FormData) {
  const { actor, db, store } = await ctx();
  const cardText = optStr(fd, "cardText");
  const results: { name: string; status: "new" | "duplicate" | "failed" | "partial"; mediaId?: string; error?: string; detail?: string }[] = [];
  for (const f of fd.getAll("files")) {
    if (!(f instanceof File) || f.size === 0) continue;
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        const r = await ingestPdf(db, store, actor, { filename: f.name, bytes, cardText });
        const x = r.result;
        const detail =
          x.status === "no_images"
            ? `PDF kept. No embedded photos were found in its ${x.pageCount} page(s) — page rendering is not supported; export the pages as images and upload those.`
            : `${x.extracted.length} photo(s) extracted from ${x.pageCount} page(s)` + (x.skipped.length ? `; skipped ${x.skipped.length}: ${x.skipped.map((k) => `p${k.page} ${k.reason}`).join("; ")}` : "");
        results.push({ name: f.name, status: r.replayed ? "duplicate" : x.status === "partially_processed" ? "partial" : "new", mediaId: x.extracted[0]?.mediaId, detail });
      } else {
        const r = await media.ingestUpload(db, store, actor, { filename: f.name, bytes, cardText });
        results.push({ name: f.name, status: r.replayed ? "duplicate" : "new", mediaId: r.result.mediaId });
      }
    } catch (e) {
      if (e instanceof DomainError) results.push({ name: f.name, status: "failed", error: e.message });
      else throw e;
    }
  }
  revalidatePath("/", "layout");
  redirect(withParam("/intake", "r", JSON.stringify(results)));
}

export async function driveImportAction(fd: FormData) {
  const { actor, db, store } = await ctx();
  const client = getDriveClient();
  let error: string | null = null;
  let summary: unknown = null;
  try {
    if (!client) throw new DomainError("DRIVE_NOT_CONNECTED", "Google Drive is not connected yet (see the configuration guide).");
    const s = await importDriveFolder(db, client, store, actor, str(fd, "folder") || client.rootFolderId);
    summary = { ...s, items: s.items.filter((i) => i.outcome !== "already_imported").slice(0, 25) };
  } catch (e) {
    if (e instanceof DomainError) error = e.message;
    else throw e;
  }
  revalidatePath("/", "layout");
  if (error) redirect(withParam("/intake", "error", error));
  redirect(withParam("/intake", "d", JSON.stringify(summary)));
}

// ------------------------------------------------------------------ organisations & types

export async function createOrganisationAction(fd: FormData) {
  const { actor, db } = await ctx();
  const roles = fd.getAll("roles").map(String) as OrgRole[];
  await run("/organisations", "Organisation created", () =>
    dir.createOrganisation(db, actor, key(fd), { name: str(fd, "name"), roles, aliases: list(str(fd, "aliases")) }),
  );
}

/** One-click "create this operator" from a photo's card text; returns to the same photo so it now matches. */
export async function createOperatorFromCardAction(fd: FormData) {
  const { actor, db } = await ctx();
  const mediaId = str(fd, "mediaId");
  await run(`/review/${mediaId}`, "Operator created", () =>
    dir.createOrganisation(db, actor, key(fd), { name: str(fd, "name"), roles: ["operator"], aliases: [] }),
  );
}

export async function addOrgAliasAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "organisationId");
  await run(`/organisations/${id}`, "Alias added", () => dir.addOrganisationAlias(db, actor, key(fd), { organisationId: id, alias: str(fd, "alias") }));
}

export async function createTypeAction(fd: FormData) {
  const { actor, db } = await ctx();
  await run("/aircraft", "Aircraft type created", () =>
    dir.createAircraftType(db, actor, key(fd), { manufacturer: str(fd, "manufacturer"), model: str(fd, "model"), aliases: list(str(fd, "aliases")), category: optStr(fd, "category") }),
  );
}

export async function loadStandardTypesAction(fd: FormData) {
  const { actor, db } = await ctx();
  const r = await dir.loadStandardAircraftTypes(db, actor, key(fd));
  revalidatePath("/", "layout");
  const x = r.result;
  redirect(withParam("/aircraft", "ok", `Standard types loaded: ${x.added} added, ${x.categorised} given a category, ${x.skipped} already there`));
}

export async function setTypeCategoryAction(fd: FormData) {
  const { actor, db } = await ctx();
  await run("/aircraft", "Category saved", () => dir.setAircraftTypeCategory(db, actor, key(fd), { aircraftTypeId: str(fd, "aircraftTypeId"), category: optStr(fd, "category") }));
}

export async function addTypeAliasAction(fd: FormData) {
  const { actor, db } = await ctx();
  await run("/aircraft", "Alias added", () => dir.addAircraftTypeAlias(db, actor, key(fd), { aircraftTypeId: str(fd, "aircraftTypeId"), alias: str(fd, "alias") }));
}

// ------------------------------------------------------------------ aircraft

function infoFrom(fd: FormData) {
  return {
    yom: optNum(fd, "yom"),
    yor: optNum(fd, "yor"),
    capacity: optNum(fd, "capacity"),
    wifiStatus: (str(fd, "wifiStatus") || "unknown") as WifiStatus,
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
    const r = await dir.createAircraft(db, actor, key(fd), {
      aircraftTypeId: str(fd, "aircraftTypeId"),
      registration: str(fd, "registration"),
      serialNumber: optStr(fd, "serialNumber"),
      operatorId,
      base: baseFrom(fd),
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
  if (error) redirect(withParam("/aircraft", "error", error));
  redirect(`/aircraft/${newId}?ok=${encodeURIComponent("Aircraft created")}`);
}

export async function changeTailAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "aircraftId");
  await run(`/aircraft/${id}`, "Tail number changed; history kept", () =>
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
  await run(`/aircraft/${id}`, "New information version saved", () =>
    dir.addInformationVersion(db, actor, key(fd), { aircraftId: id, expectedVersion: Number(str(fd, "expectedVersion")), info: infoFrom(fd), effectiveDate: optStr(fd, "effectiveDate") }),
  );
}

export async function setBasesAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "aircraftId");
  const base = baseFrom(fd);
  await run(`/aircraft/${id}`, "Base updated", async () => {
    if (!base) throw new DomainError("INVALID", "Choose Based or Floating");
    return dir.setBases(db, actor, key(fd), { aircraftId: id, base });
  });
}

export async function setOperatorAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "aircraftId");
  await run(`/aircraft/${id}`, "Operator updated", () => dir.setOperator(db, actor, key(fd), { aircraftId: id, organisationId: str(fd, "organisationId"), validFrom: optStr(fd, "validFrom") }));
}

export async function addManagementAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "aircraftId");
  await run(`/aircraft/${id}`, "Management company added", () => dir.addManagementCompany(db, actor, key(fd), { aircraftId: id, organisationId: str(fd, "organisationId") }));
}

// ------------------------------------------------------------------ media review

export async function mediaMetadataAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "mediaId");
  const cls = str(fd, "classification") as Classification;
  await run(`/review/${id}`, "Saved", () =>
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
  const id = str(fd, "mediaId");
  const status = str(fd, "status") as "actual_aircraft" | "representative_type" | "unresolved";
  await run(`/review/${id}`, "Association saved", () =>
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
  const id = str(fd, "mediaId");
  // After a decision, go back to the queue so the next photo is one click away.
  await run(`/review/${id}`, "Photo approved", () =>
    media.approveMedia(db, actor, { mediaId: id, contentVersionId: str(fd, "contentVersionId"), expectedVersion: Number(str(fd, "expectedVersion")) }),
    "/review",
  );
}

export async function useVersionAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "mediaId");
  await run(`/review/${id}`, "Switched version (earlier versions are kept)", () =>
    media.useContentVersion(db, actor, key(fd), { mediaId: id, contentVersionId: str(fd, "contentVersionId"), expectedVersion: Number(str(fd, "expectedVersion")) }),
  );
}

export async function rejectAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "mediaId");
  await run(`/review/${id}`, "Photo rejected. It is listed under Rejected, where you can reopen it.", () =>
    media.rejectMedia(db, actor, key(fd), { mediaId: id, expectedVersion: Number(str(fd, "expectedVersion")), reason: str(fd, "reason") }),
    "/review",
  );
}

export async function reopenAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "mediaId");
  await run(`/review/${id}`, "Reopened for review", () => media.reopenMedia(db, actor, key(fd), { mediaId: id, expectedVersion: Number(str(fd, "expectedVersion")) }));
}

export async function retireAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "mediaId");
  await run(`/review/${id}`, "Retired", () => media.retireMedia(db, actor, key(fd), { mediaId: id }));
}

export async function restoreAction(fd: FormData) {
  const { actor, db } = await ctx();
  const id = str(fd, "mediaId");
  await run(`/review/${id}`, "Restored", () => media.restoreMedia(db, actor, key(fd), { mediaId: id }));
}

export async function cropAction(fd: FormData) {
  const { actor, db, store } = await ctx();
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
    redirect(withParam(`/review/${newId}`, "ok", "Separated into a new photo for review"));
  }
  await run(`/review/${id}`, "Crop applied as a new version", () => media.recropMedia(db, store, actor, input));
}

// ------------------------------------------------------------------ settings

export async function addNumberAction(fd: FormData) {
  const { actor, db } = await ctx();
  await run("/settings", "Number added", () => settings.addVerifiedNumber(db, actor, key(fd), { phone: str(fd, "phone") }));
}

export async function deactivateNumberAction(fd: FormData) {
  const { actor, db } = await ctx();
  await run("/settings", "Number deactivated", () => settings.deactivateNumber(db, actor, key(fd), { numberId: str(fd, "numberId") }));
}

export async function setLanguageAction(fd: FormData) {
  const { actor, db } = await ctx();
  await run("/settings", "Language saved", () => settings.setPreferredLanguage(db, actor, key(fd), { language: str(fd, "language") }));
}
