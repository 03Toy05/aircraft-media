import { and, eq, inArray } from "drizzle-orm";
import {
  aircraft,
  aircraftBases,
  aircraftMedia,
  aircraftRegistrations,
  aircraftTypes,
  mediaAssociations,
  mediaContentVersions,
  organisationAircraftRelationships,
  organisationAliases,
  organisations,
} from "../db/schema";
import { normalizeKey as nk } from "./constants";
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

  // Child tables have no tenant column: reach them through this workspace's aircraft.
  const regs = (await db.select({ r: aircraftRegistrations }).from(aircraftRegistrations).innerJoin(aircraft, eq(aircraft.id, aircraftRegistrations.aircraftId)).where(and(eq(aircraft.tenantId, tenantId), eq(aircraftRegistrations.isCurrent, true)))).map((x) => x.r);
  const bases = (await db.select({ b: aircraftBases }).from(aircraftBases).innerJoin(aircraft, eq(aircraft.id, aircraftBases.aircraftId)).where(and(eq(aircraft.tenantId, tenantId), eq(aircraftBases.active, true)))).map((x) => x.b);
  const ops = await db
    .select({ aircraftId: organisationAircraftRelationships.aircraftId, orgId: organisations.id, name: organisations.canonicalName })
    .from(organisationAircraftRelationships)
    .innerJoin(organisations, eq(organisations.id, organisationAircraftRelationships.organisationId))
    .where(and(eq(organisations.tenantId, tenantId), eq(organisationAircraftRelationships.role, "operator"), eq(organisationAircraftRelationships.active, true)));

  // Only the fields the counts need: loading whole rows for every photo was most of the time on a big workspace.
  const media = await db
    .select({
      m: { primaryClassification: aircraftMedia.primaryClassification, reviewState: aircraftMedia.reviewState, rightsStatus: aircraftMedia.rightsStatus, updatedAt: aircraftMedia.updatedAt },
      a: { aircraftId: mediaAssociations.aircraftId, aircraftTypeId: mediaAssociations.aircraftTypeId, associationStatus: mediaAssociations.associationStatus },
      cv: { id: mediaContentVersions.id, unavailableAt: mediaContentVersions.unavailableAt },
    })
    .from(aircraftMedia)
    .innerJoin(mediaAssociations, and(eq(mediaAssociations.aircraftMediaId, aircraftMedia.id), eq(mediaAssociations.active, true)))
    .leftJoin(mediaContentVersions, eq(mediaContentVersions.id, aircraftMedia.currentContentVersionId))
    .where(and(eq(aircraftMedia.tenantId, tenantId), eq(aircraftMedia.lifecycleState, "active")));

  // Grouped once by aircraft (and by type for representative photos), so the work grows with the data, not with
  // aircraft × photos: 2,000 aircraft took 3 seconds the other way.
  const group = <T, K>(list: T[], keyOf: (x: T) => K | null | undefined) => {
    const m = new Map<K, T[]>();
    for (const x of list) { const k = keyOf(x); if (k == null) continue; const l = m.get(k); if (l) l.push(x); else m.set(k, [x]); }
    return m;
  };
  const regBy = new Map(regs.map((r) => [r.aircraftId, r]));
  const basesBy = group(bases, (b) => b.aircraftId);
  const opBy = new Map<string, (typeof ops)[number]>();
  for (const o of ops) if (!opBy.has(o.aircraftId)) opBy.set(o.aircraftId, o);
  const mediaByAircraft = group(media, (x) => (x.a.associationStatus === "actual_aircraft" ? x.a.aircraftId : null));
  const mediaByType = group(media, (x) => (x.a.associationStatus === "representative_type" ? x.a.aircraftTypeId : null));

  const rows: CatalogueRow[] = [];
  for (const { a, t } of acs) {
    const reg = regBy.get(a.id);
    const myBases = [...(basesBy.get(a.id) ?? [])].sort((x, y) => x.displayOrder - y.displayOrder);
    const op = opBy.get(a.id);

    const cells = Object.fromEntries(
      CLASSIFICATIONS.map((c) => [c, { actual: 0, representative: 0, pending: 0, status: "missing" } as ClassCell]),
    ) as Record<Classification, ClassCell>;
    const unavailable = new Set<Classification>();
    const processing = new Set<Classification>();
    let lastApproved: Date | null = null;

    for (const { m, a: assoc, cv } of [...(mediaByAircraft.get(a.id) ?? []), ...(mediaByType.get(t.id) ?? [])]) {
      const mine = assoc.aircraftId === a.id;
      const ofType = assoc.associationStatus === "representative_type" && assoc.aircraftTypeId === t.id;
      if (!(mine && assoc.associationStatus === "actual_aircraft") && !ofType) continue;
      const cell = cells[m.primaryClassification];
      if (m.reviewState === "approved") {
        if (m.rightsStatus === "restricted") continue;
        if (!cv?.id || cv.unavailableAt) {
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

/**
 * Other names of operators ("VJ" for Vista Jet), keyed by the operator's normalised name. Keyed by name, not id, so a
 * broker's own short name also finds a library aircraft whose operator has the same name.
 */
export async function operatorAliasesByName(db: Db, tenantIds: string[]): Promise<Map<string, string[]>> {
  const rows = await db.select({ alias: organisationAliases.alias, name: organisations.canonicalName }).from(organisationAliases)
    .innerJoin(organisations, eq(organisations.id, organisationAliases.organisationId)).where(inArray(organisations.tenantId, tenantIds));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(nk(r.name), [...(out.get(nk(r.name)) ?? []), r.alias]);
  return out;
}

export interface AircraftName { aircraftId: string; aircraftTypeId: string; aircraft: string; tail: string | null; operatorId: string | null; operator: string | null }

/**
 * Just the names of a workspace's aircraft (type, tail, operator): what Toy needs to find "Tag G650ER". Three small
 * queries and no photos, so it stays quick as a workspace grows; getCatalogue also counts every photo.
 */
export async function getAircraftNames(db: Db, tenantId: string): Promise<AircraftName[]> {
  const acs = await db.select({ id: aircraft.id, typeId: aircraftTypes.id, make: aircraftTypes.manufacturer, model: aircraftTypes.model })
    .from(aircraft).innerJoin(aircraftTypes, eq(aircraftTypes.id, aircraft.aircraftTypeId))
    .where(and(eq(aircraft.tenantId, tenantId), eq(aircraft.active, true)));
  const regs = await db.select({ id: aircraftRegistrations.aircraftId, reg: aircraftRegistrations.registration }).from(aircraftRegistrations)
    .innerJoin(aircraft, eq(aircraft.id, aircraftRegistrations.aircraftId)).where(and(eq(aircraft.tenantId, tenantId), eq(aircraftRegistrations.isCurrent, true)));
  const ops = await db.select({ id: organisationAircraftRelationships.aircraftId, orgId: organisations.id, name: organisations.canonicalName })
    .from(organisationAircraftRelationships).innerJoin(organisations, eq(organisations.id, organisationAircraftRelationships.organisationId))
    .where(and(eq(organisations.tenantId, tenantId), eq(organisationAircraftRelationships.role, "operator"), eq(organisationAircraftRelationships.active, true)));
  const regBy = new Map(regs.map((r) => [r.id, r.reg]));
  const opBy = new Map(ops.map((o) => [o.id, o]));
  return acs.map((a) => ({
    aircraftId: a.id, aircraftTypeId: a.typeId, aircraft: `${a.make} ${a.model}`, tail: regBy.get(a.id) ?? null,
    operatorId: opBy.get(a.id)?.orgId ?? null, operator: opBy.get(a.id)?.name ?? null,
  }));
}
