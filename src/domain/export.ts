import { zipSync } from "fflate";
import { and, eq } from "drizzle-orm";
import { aircraft } from "../db/schema";
import type { Db } from "../db/client";
import type { Actor } from "./action";
import { formatAircraftCard } from "./card";
import { CLASSIFICATIONS, type Classification } from "./constants";
import { getAircraftCard } from "./directory";
import { notFound } from "./errors";
import { getLineup, readContentBytes } from "./media";
import type { FileStore } from "../storage";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export interface ExportFile {
  name: string; // e.g. "CABIN 1 - B-KXX.jpg"
  mimeType: string;
  bytes: Uint8Array;
  representative: boolean;
}

export interface AircraftExport {
  aircraftId: string;
  cardText: string;
  files: ExportFile[];
  /** items that were approved but whose bytes could not be read; they are now flagged unavailable */
  unavailable: string[];
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").trim();

/**
 * Everything needed to send an aircraft to a client: the compact card plus the approved, active,
 * permitted photos (optionally limited to some classifications), in lineup order with display labels.
 * Representative (type-level) photos are marked as such in the file name so they are never passed off
 * as the exact aircraft.
 */
export async function buildAircraftExport(db: Db, store: FileStore, actor: Actor, aircraftId: string, views?: Classification[]): Promise<AircraftExport> {
  const [ac] = await db.select().from(aircraft).where(and(eq(aircraft.id, aircraftId), eq(aircraft.tenantId, actor.tenantId)));
  if (!ac || !ac.active) throw notFound("Aircraft");
  const card = (await getAircraftCard(db, aircraftId))!;
  const want = views?.length ? new Set(views.filter((v) => CLASSIFICATIONS.includes(v))) : null;
  const lineup = (await getLineup(db, { aircraftId, aircraftTypeId: ac.aircraftTypeId })).filter((l) => !want || want.has(l.classification));

  const files: ExportFile[] = [];
  const unavailable: string[] = [];
  for (const item of lineup) {
    try {
      const { bytes, mimeType } = await readContentBytes(db, store, item.contentVersionId);
      const representative = item.associationStatus === "representative_type";
      files.push({
        name: `${safe(item.label)}${representative ? " (representative)" : ""} - ${safe(card.tailNumber ?? "aircraft")}.${EXT[mimeType] ?? "bin"}`,
        mimeType,
        bytes,
        representative,
      });
    } catch {
      unavailable.push(item.label);
    }
  }
  return { aircraftId, cardText: formatAircraftCard(card), files, unavailable };
}

export function zipExport(exp: AircraftExport): Uint8Array {
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  for (const f of exp.files) entries[f.name] = [f.bytes, { level: 0 }]; // photos are already compressed
  entries["aircraft-card.txt"] = new TextEncoder().encode(exp.cardText + "\n");
  if (exp.unavailable.length) entries["MISSING.txt"] = new TextEncoder().encode(`Could not be retrieved: ${exp.unavailable.join(", ")}\n`);
  return zipSync(entries);
}
