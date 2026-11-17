import { and, eq } from "drizzle-orm";
import {
  aircraft,
  aircraftBases,
  aircraftMedia,
  aircraftRegistrations,
  aircraftTypes,
  mediaAssociations,
  mediaContentVersions,
  organisationAircraftRelationships,
  organisations,
} from "../db/schema";
import type { Db } from "../db/client";
import { resolveAircraftTypes, resolveOrganisations } from "./directory";
import { CLASSIFICATIONS, REQUIRED_CLASSES, normalizeKey, normalizeRegistration, type Classification } from "./constants";

export const AVAILABILITY_STATUSES = [
  "actual_available",
  "representative_available",
  "partial",
  "processing",
  "needs_review",
  "missing",
  "unavailable",
] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export interface ClassCell {
  actual: number;
  representative: number;
  pending: number; // awaiting review, attributed to this aircraft/type
  status: "actual_available" | "representative_available" | "needs_review" | "processing" | "unavailable" | "missing";
}

export interface CatalogueRow {
  aircraftId: string;
  aircraftTypeId: string;
  operatorId: string | null;
  operator: string | null;
  aircraft: string;
  tail: string | null;
  base: string | null;
  floating: boolean;
  cells: Record<Classification, ClassCell>;
  status: AvailabilityStatus;
  lastApproved: Date | null;
}

export interface CatalogueFilters {
  operatorId?: string;
  aircraftTypeId?: string;
  tail?: string;
  base?: string;
  floatingOnly?: boolean;
  /** only aircraft that have approved media of this kind */
  mediaKind?: "actual" | "representative";
  /** only aircraft with no approved available media in this classification */
  missingClass?: Classification;
  status?: AvailabilityStatus;
  /** free-text search over operator (incl. aliases), type (incl. aliases), tail and base */
  q?: string;
}

/**
 * Derived catalogue: computed on read from organisations, aircraft relationships and media.
 * There is no separate manual availability list. "Available" means approved + active + not restricted
 * + content not flagged unavailable.
 */
export async function getCatalogue(db: Db, tenantId: string, filters: CatalogueFilters = {}): Promise<CatalogueRow[]> {
  const acs = await db
    .select({ a: aircraft, t: aircraftTypes })
    .from(aircraft)
    .innerJoin(aircraftTypes, eq(aircraftTypes.id, aircraft.aircraftTypeId))
    .where(and(eq(aircraft.tenantId, tenantId), eq(aircraft.active, true)));

  const regs = await db.select().from(aircraftRegistrations).where(eq(aircraftRegistrations.isCurrent, true));
  const bases = await db.select().from(aircraftBases).where(eq(aircraftBases.active, true));
  const ops = await db
    .select({ aircraftId: organisationAircraftRelationships.aircraftId, orgId: organisations.id, name: organisations.canonicalName })
    .from(organisationAircraftRelationships)
    .innerJoin(organisations, eq(organisations.id, organisationAircraftRelationships.organisationId))
    .where(and(eq(organisationAircraftRelationships.role, "operator"), eq(organisationAircraftRelationships.active, true)));

  const media = await db
    .select({ m: aircraftMedia, a: mediaAssociations, cv: mediaContentVersions })
    .from(aircraftMedia)
    .innerJoin(mediaAssociations, and(eq(mediaAssociations.aircraftMediaId, aircraftMedia.id), eq(mediaAssociations.active, true)))
    .leftJoin(mediaContentVersions, eq(mediaContentVersions.id, aircraftMedia.currentContentVersionId))
    .where(and(eq(aircraftMedia.tenantId, tenantId), eq(aircraftMedia.lifecycleState, "active")));

  const rows: CatalogueRow[] = [];
  for (const { a, t } of acs) {
    const reg = regs.find((r) => r.aircraftId === a.id);
    const myBases = bases.filter((b) => b.aircraftId === a.id).sort((x, y) => x.displayOrder - y.displayOrder);
    const op = ops.find((o) => o.aircraftId === a.id);

    const cells = Object.fromEntries(
      CLASSIFICATIONS.map((c) => [c, { actual: 0, representative: 0, pending: 0, status: "missing" } as ClassCell]),
    ) as Record<Classification, ClassCell>;
    const unavailable = new Set<Classification>();
    const processing = new Set<Classification>();
    let lastApproved: Date | null = null;

    for (const { m, a: assoc, cv } of media) {
      const mine = assoc.aircraftId === a.id;
      const ofType = assoc.associationStatus === "representative_type" && assoc.aircraftTypeId === t.id;
      if (!(mine && assoc.associationStatus === "actual_aircraft") && !ofType) continue;
      const cell = cells[m.primaryClassification];
      if (m.reviewState === "approved") {
        if (m.rightsStatus === "restricted") continue;
        if (!cv || cv.unavailableAt) {
          unavailable.add(m.primaryClassification);
          continue;
        }
        if (mine) cell.actual++;
        else cell.representative++;
        if (!lastApproved || m.updatedAt > lastApproved) lastApproved = m.updatedAt;
      } else if (m.reviewState === "needs_review") {
        cell.pending++;
      } else if (m.reviewState === "received" || m.reviewState === "processing") {
        processing.add(m.primaryClassification);
      }
    }
    for (const c of CLASSIFICATIONS) {
      const cell = cells[c];
      cell.status = cell.actual > 0
        ? "actual_available"
        : cell.representative > 0
          ? "representative_available"
          : unavailable.has(c)
            ? "unavailable"
            : cell.pending > 0
              ? "needs_review"
              : processing.has(c)
                ? "processing"
                : "missing";
    }

    const hasActual = (c: Classification) => cells[c].actual > 0;
    const hasAny = (c: Classification) => cells[c].actual > 0 || cells[c].representative > 0;
    const anyAvailable = CLASSIFICATIONS.some(hasAny);
    let status: AvailabilityStatus;
    if (REQUIRED_CLASSES.every(hasActual)) status = "actual_available";
    else if (!CLASSIFICATIONS.some(hasActual) && REQUIRED_CLASSES.every(hasAny)) status = "representative_available";
    else if (anyAvailable) status = "partial";
    else if (unavailable.size > 0) status = "unavailable";
    else if (CLASSIFICATIONS.some((c) => cells[c].pending > 0)) status = "needs_review";
    else if (processing.size > 0) status = "processing";
    else status = "missing";

    rows.push({
      aircraftId: a.id,
      aircraftTypeId: t.id,
      operatorId: op?.orgId ?? null,
      operator: op?.name ?? null,
      aircraft: `${t.manufacturer} ${t.model}`,
      tail: reg?.registration ?? null,
      base: myBases.length === 0 ? null : myBases[0].mode === "floating" ? "Floating" : myBases.map((b) => b.location).join(" / "),
      floating: myBases[0]?.mode === "floating",
      cells,
      status,
      lastApproved,
    });
  }

  const qn = filters.q ? normalizeKey(filters.q) : "";
  const qOps = new Set(filters.q ? (await resolveOrganisations(db, tenantId, filters.q)).map((o) => o.id) : []);
  const qTypes = new Set(filters.q ? (await resolveAircraftTypes(db, tenantId, filters.q)).map((t) => t.id) : []);

  return rows
    .filter((r) => {
      if (qn) {
        const hay = normalizeKey(`${r.operator ?? ""} ${r.aircraft} ${r.tail ?? ""} ${r.base ?? ""}`);
        const hit = hay.includes(qn) || (r.operatorId && qOps.has(r.operatorId)) || qTypes.has(r.aircraftTypeId);
        if (!hit) return false;
      }
      if (filters.operatorId && r.operatorId !== filters.operatorId) return false;
      if (filters.aircraftTypeId && r.aircraftTypeId !== filters.aircraftTypeId) return false;
      if (filters.tail && !(r.tail && normalizeRegistration(r.tail).includes(normalizeRegistration(filters.tail)))) return false;
      if (filters.base && !(r.base && normalizeKey(r.base).includes(normalizeKey(filters.base)))) return false;
      if (filters.floatingOnly && !r.floating) return false;
      if (filters.mediaKind === "actual" && !CLASSIFICATIONS.some((c) => r.cells[c].actual > 0)) return false;
      if (filters.mediaKind === "representative" && !CLASSIFICATIONS.some((c) => r.cells[c].representative > 0)) return false;
      if (filters.missingClass) {
        const cell = r.cells[filters.missingClass];
        if (cell.actual + cell.representative > 0) return false;
      }
      if (filters.status && r.status !== filters.status) return false;
      return true;
    })
    .sort((x, y) => (x.operator ?? "").localeCompare(y.operator ?? "") || (x.tail ?? "").localeCompare(y.tail ?? ""));
}
