import { and, asc, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import type { Db } from "../db/client";
import {
  aircraft,
  aircraftBases,
  aircraftInformationVersions,
  aircraftMedia,
  aircraftRegistrations,
  aircraftTypes,
  cbosExports,
  mediaAssociations,
  mediaContentVersions,
  organisationAircraftRelationships,
  organisations,
  sourceEvidence,
} from "../db/schema";
import type { DriveClient } from "../storage/drive";
import type { FileStore } from "../storage";
import { CLASSIFICATION_LABEL, type Classification } from "./constants";
import { readContentBytes } from "./media";

/**
 * Export of approved photos for CBOS (Rulebook-aligned):
 *  - a data sheet (aircraft-media.csv) carrying every record's stable IDs and details, which is what lets CBOS reuse them;
 *  - CBOS-named copies in Drive, in the layout CBOS's media importer already reads. Names are import assistance only,
 *    never identity; originals, their names and source folders are left untouched.
 */

/** The view words CBOS's importer reads in file names ("Interior" is the Rulebook's alias for Cabin). */
const FILE_VIEW: Partial<Record<Classification, string>> = { exterior: "Exterior", cabin: "Interior", floor_plan: "Floorplan" };

/** CBOS photo-library category folders. */
const CATEGORY_FOLDER: Record<string, string> = {
  very_light_jet: "Very Light Jets",
  light_jet: "Light Jets",
  midsize_jet: "Midsize Jets",
  super_midsize_jet: "Super Midsize Jets",
  heavy_jet: "Heavy Jets",
  ultra_long_range_jet: "Ultra Long Range Jets",
  executive_airliner: "Executive Airliners",
  turboprop: "Turboprops",
  helicopter: "Helicopters",
};

/** "Bombardier", "Challenger 650" -> "BOMBARDIER_CHALLENGER_650" (the CBOS library's MANUFACTURER_MODEL). */
export function typeToken(manufacturer: string, model: string): string {
  return `${manufacturer} ${model}`.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Safe as one Drive folder/file name segment. */
const segment = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "-";

export interface ExportRow {
  mediaId: string;
  contentVersionId: string;
  contentSha256: string;
  mimeType: string;
  classification: Classification;
  displayLabel: string;
  association: string;
  aircraftId: string | null;
  registration: string | null;
  aircraftTypeId: string | null;
  manufacturer: string | null;
  model: string | null;
  category: string | null;
  operatorId: string | null;
  operatorName: string | null;
  operatorRegion: string | null;
  yom: number | null;
  yor: number | null;
  capacity: number | null;
  wifi: string | null;
  base: string | null;
  rightsStatus: string;
  sourceKind: string | null;
  originalFilename: string | null;
  originalDriveFileId: string | null;
  sourceFolder: string | null;
  receivedAt: Date;
  updatedAt: Date;
  /** Folder segments below the export root, and the CBOS file name. Null when the photo can't be filed (no view). */
  folder: string[] | null;
  fileName: string | null;
}

/** Every approved, active photo in the workspace with what CBOS needs, numbered per aircraft (or type) and view. */
export async function listExportRows(db: Db, tenantId: string): Promise<ExportRow[]> {
  const rows = await db
    .select({ m: aircraftMedia, a: mediaAssociations, cv: mediaContentVersions, ev: sourceEvidence })
    .from(aircraftMedia)
    .innerJoin(mediaAssociations, and(eq(mediaAssociations.aircraftMediaId, aircraftMedia.id), eq(mediaAssociations.active, true)))
    .innerJoin(mediaContentVersions, eq(mediaContentVersions.id, aircraftMedia.currentContentVersionId))
    .leftJoin(sourceEvidence, eq(sourceEvidence.id, aircraftMedia.createdSourceEvidenceId))
    .where(and(eq(aircraftMedia.tenantId, tenantId), eq(aircraftMedia.reviewState, "approved"), eq(aircraftMedia.lifecycleState, "active")))
    .orderBy(asc(aircraftMedia.displayOrder), asc(aircraftMedia.createdAt));

  const acIds = [...new Set(rows.map((r) => r.a.aircraftId).filter(Boolean))] as string[];
  const acs = acIds.length ? await db.select().from(aircraft).where(and(eq(aircraft.tenantId, tenantId), inArray(aircraft.id, acIds))) : [];
  const typeIds = [...new Set([...rows.map((r) => r.a.aircraftTypeId), ...acs.map((a) => a.aircraftTypeId)].filter(Boolean))] as string[];
  const types = new Map((typeIds.length ? await db.select().from(aircraftTypes).where(and(eq(aircraftTypes.tenantId, tenantId), inArray(aircraftTypes.id, typeIds))) : []).map((t) => [t.id, t]));
  const regs = new Map((acIds.length ? await db.select().from(aircraftRegistrations).where(and(inArray(aircraftRegistrations.aircraftId, acIds), eq(aircraftRegistrations.isCurrent, true))) : []).map((r) => [r.aircraftId, r.registration]));
  const infos = new Map((acIds.length ? await db.select().from(aircraftInformationVersions).where(and(inArray(aircraftInformationVersions.aircraftId, acIds), eq(aircraftInformationVersions.isCurrent, true))) : []).map((i) => [i.aircraftId, i]));
  const baseRows = acIds.length ? await db.select().from(aircraftBases).where(and(inArray(aircraftBases.aircraftId, acIds), eq(aircraftBases.active, true))).orderBy(asc(aircraftBases.displayOrder)) : [];
  const bases = new Map<string, string>();
  for (const b of baseRows) bases.set(b.aircraftId, b.mode === "floating" ? "Floating" : [bases.get(b.aircraftId), b.location].filter(Boolean).join(" / "));
  const ops = new Map(
    (acIds.length
      ? await db
          .select({ aircraftId: organisationAircraftRelationships.aircraftId, o: organisations })
          .from(organisationAircraftRelationships)
          .innerJoin(organisations, eq(organisations.id, organisationAircraftRelationships.organisationId))
          .where(and(inArray(organisationAircraftRelationships.aircraftId, acIds), eq(organisationAircraftRelationships.role, "operator"), eq(organisationAircraftRelationships.active, true), eq(organisations.tenantId, tenantId)))
      : []
    ).map((r) => [r.aircraftId, r.o]),
  );
  const acById = new Map(acs.map((a) => [a.id, a]));

  const counters = new Map<string, number>();
  return rows.map(({ m, a, cv, ev }) => {
    const ac = a.aircraftId ? acById.get(a.aircraftId) ?? null : null;
    const t = types.get(ac?.aircraftTypeId ?? a.aircraftTypeId ?? "") ?? null;
    const op = ac ? ops.get(ac.id) ?? null : null;
    const reg = ac ? regs.get(ac.id) ?? null : null;
    const info = ac ? infos.get(ac.id) : undefined;
    const view = FILE_VIEW[m.primaryClassification];
    const token = t ? typeToken(t.manufacturer, t.model) : "UNKNOWN_TYPE";
    // Actual aircraft: Operator Aircraft/<Operator>/<Registration>/Exterior_01.jpg (CBOS ticket 015's layout).
    // Representative of a type: Private Aircraft/<Category>/MANUFACTURER_MODEL_Exterior_01.jpg (CBOS media library layout).
    let folder: string[] | null = null;
    let prefix = "";
    if (view && ac) folder = ["Operator Aircraft", segment(op?.canonicalName ?? "No operator"), segment(reg ?? `${token} (no tail ${ac.id.slice(0, 8)})`)];
    else if (view && t) {
      folder = ["Private Aircraft", CATEGORY_FOLDER[t.category ?? ""] ?? "Other"];
      prefix = `${token}_`;
    }
    const group = `${folder?.join("/")}|${prefix}|${m.primaryClassification}`;
    const n = (counters.get(group) ?? 0) + 1;
    counters.set(group, n);
    const ext = cv.mimeType === "image/png" ? "png" : "jpg"; // WebP becomes JPG: CBOS reads .jpg/.jpeg/.png only
    const meta = (ev?.metadata ?? {}) as { batchLabel?: string };
    return {
      mediaId: m.id,
      contentVersionId: cv.id,
      contentSha256: cv.contentHash,
      mimeType: cv.mimeType,
      classification: m.primaryClassification,
      displayLabel: `${CLASSIFICATION_LABEL[m.primaryClassification]} ${n}`,
      association: a.associationStatus,
      aircraftId: ac?.id ?? null,
      registration: reg,
      aircraftTypeId: t?.id ?? null,
      manufacturer: t?.manufacturer ?? null,
      model: t?.model ?? null,
      category: t?.category ?? null,
      operatorId: op?.id ?? null,
      operatorName: op?.canonicalName ?? null,
      operatorRegion: op?.region ?? null,
      yom: info?.yom ?? null,
      yor: info?.yor ?? null,
      capacity: info?.capacity ?? null,
      wifi: info?.wifiStatus ?? null,
      base: ac ? bases.get(ac.id) ?? null : null,
      rightsStatus: m.rightsStatus,
      sourceKind: ev?.sourceKind ?? null,
      originalFilename: ev?.originalFilename ?? null,
      originalDriveFileId: ev?.originalDriveFileId ?? null,
      sourceFolder: meta.batchLabel ?? null,
      receivedAt: m.createdAt,
      updatedAt: m.updatedAt,
      folder,
      fileName: folder && view ? `${prefix}${view}_${String(n).padStart(2, "0")}.${ext}` : null,
    };
  });
}

const COLUMNS: [string, (r: ExportRow & { exportPath: string | null; exportDriveFileId: string | null }) => unknown][] = [
  ["media_id", (r) => r.mediaId],
  ["media_reference", () => ""], // MED-… once approved (docs/PROPOSED-REFERENCES.md)
  ["content_version_id", (r) => r.contentVersionId],
  ["content_sha256", (r) => r.contentSha256],
  ["classification", (r) => r.classification],
  ["display_label", (r) => r.displayLabel],
  ["association", (r) => r.association],
  ["aircraft_id", (r) => r.aircraftId],
  ["aircraft_reference", () => ""],
  ["registration", (r) => r.registration],
  ["aircraft_type_id", (r) => r.aircraftTypeId],
  ["manufacturer", (r) => r.manufacturer],
  ["model", (r) => r.model],
  ["category", (r) => r.category],
  ["operator_id", (r) => r.operatorId],
  ["operator_reference", () => ""],
  ["operator_name", (r) => r.operatorName],
  ["operator_region", (r) => r.operatorRegion],
  ["yom", (r) => r.yom],
  ["yor", (r) => r.yor],
  ["passenger_capacity", (r) => r.capacity],
  ["wifi", (r) => r.wifi],
  ["base", (r) => r.base],
  ["rights_status", (r) => r.rightsStatus],
  ["source_kind", (r) => r.sourceKind],
  ["original_filename", (r) => r.originalFilename],
  ["original_drive_file_id", (r) => r.originalDriveFileId],
  ["source_folder", (r) => r.sourceFolder],
  ["received_at", (r) => r.receivedAt.toISOString()],
  ["updated_at", (r) => r.updatedAt.toISOString()],
  ["export_path", (r) => r.exportPath],
  ["export_drive_file_id", (r) => r.exportDriveFileId],
];

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The data sheet, with the copies' paths where they exist. */
export async function buildExportCsv(db: Db, tenantId: string, rows?: ExportRow[]): Promise<string> {
  const list = rows ?? (await listExportRows(db, tenantId));
  const copies = new Map((await db.select().from(cbosExports).where(eq(cbosExports.tenantId, tenantId))).map((c) => [c.aircraftMediaId, c]));
  const lines = [COLUMNS.map(([h]) => h).join(",")];
  for (const r of list) {
    const c = copies.get(r.mediaId);
    const full = { ...r, exportPath: c?.path ?? null, exportDriveFileId: c?.driveFileId ?? null };
    lines.push(COLUMNS.map(([, f]) => cell(f(full))).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM so Excel reads names in any language
}

export interface ExportSummary {
  added: number;
  updated: number;
  moved: number;
  removed: number;
  unchanged: number;
  skipped: number;
  failed: { mediaId: string; error: string }[];
  root: string;
}

/**
 * Bring the Drive export folder in line with the approved photos: copy new ones, refresh re-cropped ones, rename/move
 * ones whose aircraft, operator, view or order changed, bin copies of photos no longer approved, then write the sheet.
 * Each photo is independent: one failure is reported and the rest carry on. Safe to run again at any time.
 */
export async function exportToDrive(db: Db, client: DriveClient, store: FileStore, tenantId: string, rootPath: string[]): Promise<ExportSummary> {
  const sum: ExportSummary = { added: 0, updated: 0, moved: 0, removed: 0, unchanged: 0, skipped: 0, failed: [], root: rootPath.join("/") };
  const folderOf = async (segments: string[]) => {
    let id = client.rootFolderId;
    for (const s of segments) id = await client.ensureFolder(id, s);
    return id;
  };
  const rows = await listExportRows(db, tenantId);
  const existing = new Map((await db.select().from(cbosExports).where(eq(cbosExports.tenantId, tenantId))).map((c) => [c.aircraftMediaId, c]));
  const wanted = new Set<string>();

  for (const r of rows) {
    if (!r.folder || !r.fileName) {
      sum.skipped++;
      continue;
    }
    wanted.add(r.mediaId);
    const segments = [...rootPath, ...r.folder];
    const path = [...segments, r.fileName].join("/");
    const prev = existing.get(r.mediaId);
    try {
      if (prev && prev.contentVersionId === r.contentVersionId && prev.path === path) {
        sum.unchanged++;
        continue;
      }
      const folderId = await folderOf(segments);
      if (prev && prev.contentVersionId === r.contentVersionId) {
        await client.renameMove(prev.driveFileId, r.fileName, prev.driveFolderId, folderId);
        await db.update(cbosExports).set({ path, driveFolderId: folderId, updatedAt: new Date() }).where(eq(cbosExports.id, prev.id));
        sum.moved++;
        continue;
      }
      let { bytes, mimeType } = await readContentBytes(db, store, r.contentVersionId);
      if (mimeType !== "image/png" && mimeType !== "image/jpeg") {
        bytes = new Uint8Array(await sharp(bytes).jpeg({ quality: 90 }).toBuffer());
        mimeType = "image/jpeg";
      }
      const fileId = await client.upload(folderId, r.fileName, mimeType, bytes);
      if (prev) {
        await client.trash(prev.driveFileId).catch(() => undefined); // the old copy held an earlier crop
        await db.update(cbosExports).set({ contentVersionId: r.contentVersionId, driveFileId: fileId, driveFolderId: folderId, path, updatedAt: new Date() }).where(eq(cbosExports.id, prev.id));
        sum.updated++;
      } else {
        await db.insert(cbosExports).values({ tenantId, aircraftMediaId: r.mediaId, contentVersionId: r.contentVersionId, driveFileId: fileId, driveFolderId: folderId, path });
        sum.added++;
      }
    } catch (e) {
      sum.failed.push({ mediaId: r.mediaId, error: e instanceof Error ? e.message : "export failed" });
    }
  }

  // Photos retired, rejected or back in review: their copies go to Drive's bin (recoverable), so CBOS won't import them.
  for (const [mediaId, prev] of existing) {
    if (wanted.has(mediaId)) continue;
    try {
      await client.trash(prev.driveFileId);
      await db.delete(cbosExports).where(eq(cbosExports.id, prev.id));
      sum.removed++;
    } catch (e) {
      sum.failed.push({ mediaId, error: e instanceof Error ? e.message : "could not remove the old copy" });
    }
  }

  const csv = new TextEncoder().encode(await buildExportCsv(db, tenantId, rows));
  const rootId = await folderOf(rootPath);
  const sheet = await client.findChild(rootId, "aircraft-media.csv");
  if (sheet) await client.replaceContent(sheet.id, "text/csv", csv);
  else await client.upload(rootId, "aircraft-media.csv", "text/csv", csv);
  return sum;
}

/** Where a workspace's export goes: the admin's at "CBOS Export", everyone else's in their own folder under it. */
export function exportRootFor(isAdmin: boolean, email: string): string[] {
  return isAdmin ? ["CBOS Export"] : ["CBOS Export", "Users", segment(email)];
}
