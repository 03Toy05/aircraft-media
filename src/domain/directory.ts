import { and, asc, eq } from "drizzle-orm";
import {
  aircraft,
  aircraftBases,
  aircraftInformationVersions,
  aircraftRegistrations,
  aircraftTypeAliases,
  aircraftTypes,
  organisationAircraftRelationships,
  organisationAliases,
  organisationRoles,
  organisations,
  sourceEvidence,
} from "../db/schema";
import type { Db } from "../db/client";
import { runAction, type Actor, type Tx } from "./action";
import { STANDARD_AIRCRAFT_TYPES, STANDARD_LIST_VERSION } from "./standardTypes";
import {
  AIRCRAFT_CATEGORIES,
  normalizeKey,
  normalizeRegistration,
  type BaseMode,
  type OrgRole,
  type WifiStatus,
  WIFI_STATUSES,
} from "./constants";
import { conflict, invalid, notFound } from "./errors";

type Q = Db | Tx;

// ---------------------------------------------------------------- evidence

/** Manual entry evidence: every authoritative change cites where it came from. */
export async function recordManualEvidence(tx: Q, actor: Actor, text?: string | null): Promise<string> {
  const [row] = await tx
    .insert(sourceEvidence)
    .values({
      tenantId: actor.tenantId,
      sourceKind: "manual",
      senderId: actor.id,
      originalText: text ?? null,
    })
    .returning({ id: sourceEvidence.id });
  return row.id;
}

// ---------------------------------------------------------------- organisations

export interface CreateOrganisationInput {
  name: string;
  roles?: OrgRole[];
  aliases?: string[];
  region?: string | null;
  base?: string | null;
}

export function createOrganisation(db: Db, actor: Actor, key: string, input: CreateOrganisationInput) {
  return runAction({
    db,
    actor,
    name: "organisation.create",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const name = input.name.trim();
      if (!name) throw invalid("Organisation name is required");
      const norm = normalizeKey(name);
      const dup = await tx
        .select({ id: organisations.id })
        .from(organisations)
        .where(and(eq(organisations.tenantId, actor.tenantId), eq(organisations.normalizedName, norm), eq(organisations.active, true)));
      if (dup.length) throw conflict("DUPLICATE_ORGANISATION", `Organisation "${name}" already exists`, { id: dup[0].id });

      const evidenceId = await recordManualEvidence(tx, actor);
      const [org] = await tx
        .insert(organisations)
        .values({ tenantId: actor.tenantId, canonicalName: name, normalizedName: norm, region: input.region?.trim() || null, base: input.base?.trim() || null })
        .returning({ id: organisations.id });
      for (const role of input.roles?.length ? input.roles : (["operator"] as OrgRole[])) {
        await tx.insert(organisationRoles).values({ organisationId: org.id, role, sourceEvidenceId: evidenceId });
      }
      await insertAliases(tx, "org", org.id, input.aliases ?? [], norm);
      return { organisationId: org.id };
    },
  });
}

export function setOrganisationRegion(db: Db, actor: Actor, key: string, input: { organisationId: string; region: string | null; base?: string | null }) {
  return runAction({
    db,
    actor,
    name: "organisation.setRegion",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const [org] = await tx.select().from(organisations).where(and(eq(organisations.id, input.organisationId), eq(organisations.tenantId, actor.tenantId)));
      if (!org) throw notFound("Organisation");
      await tx.update(organisations).set({ region: input.region?.trim() || null, ...(input.base !== undefined ? { base: input.base?.trim() || null } : {}), updatedAt: new Date() }).where(eq(organisations.id, org.id));
      return { organisationId: org.id };
    },
  });
}

/** The operator's usual base as a list of locations, for pre-filling a new aircraft. */
export async function getOrganisationBase(db: Q, tenantId: string, organisationId: string): Promise<string[]> {
  const [o] = await db.select({ base: organisations.base }).from(organisations).where(and(eq(organisations.id, organisationId), eq(organisations.tenantId, tenantId)));
  return (o?.base ?? "").split(/[,;/]|\r?\n/).map((x) => x.trim()).filter(Boolean);
}

export function addOrganisationAlias(db: Db, actor: Actor, key: string, input: { organisationId: string; alias: string }) {
  return runAction({
    db,
    actor,
    name: "organisation.addAlias",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const [org] = await tx.select().from(organisations).where(and(eq(organisations.id, input.organisationId), eq(organisations.tenantId, actor.tenantId)));
      if (!org) throw notFound("Organisation");
      await insertAliases(tx, "org", org.id, [input.alias], org.normalizedName);
      return { organisationId: org.id };
    },
  });
}

async function insertAliases(tx: Q, kind: "org" | "type", ownerId: string, aliases: string[], skipNorm: string) {
  const seen = new Set<string>([skipNorm]);
  for (const alias of aliases.map((a) => a.trim()).filter(Boolean)) {
    const n = normalizeKey(alias);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    if (kind === "org") {
      await tx.insert(organisationAliases).values({ organisationId: ownerId, alias, normalizedAlias: n }).onConflictDoNothing();
    } else {
      await tx.insert(aircraftTypeAliases).values({ aircraftTypeId: ownerId, alias, normalizedAlias: n }).onConflictDoNothing();
    }
  }
}

// ---------------------------------------------------------------- aircraft types

export interface CreateAircraftTypeInput {
  manufacturer: string;
  model: string;
  aliases?: string[];
  category?: string | null;
}

function checkCategory(c: string | null | undefined) {
  if (c && !(AIRCRAFT_CATEGORIES as readonly string[]).includes(c)) throw invalid(`Unknown aircraft category "${c}"`);
  return c || null;
}

export function setAircraftTypeCategory(db: Db, actor: Actor, key: string, input: { aircraftTypeId: string; category: string | null }) {
  return runAction({
    db,
    actor,
    name: "aircraftType.setCategory",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const category = checkCategory(input.category);
      const [t] = await tx.select().from(aircraftTypes).where(and(eq(aircraftTypes.id, input.aircraftTypeId), eq(aircraftTypes.tenantId, actor.tenantId)));
      if (!t) throw notFound("Aircraft type");
      await tx.update(aircraftTypes).set({ category, updatedAt: new Date() }).where(eq(aircraftTypes.id, t.id));
      return { aircraftTypeId: t.id };
    },
  });
}

/**
 * Adds every type from the starter list that is not already present (matched by normalised name).
 * Existing types, their aliases and their categories are never changed; types that exist without a category get one.
 */
export function loadStandardAircraftTypes(db: Db, actor: Actor, key: string) {
  return runAction({
    db,
    actor,
    name: "aircraftType.loadStandard",
    idempotencyKey: key,
    input: { list: STANDARD_LIST_VERSION },
    handler: async (tx) => {
      let added = 0;
      let categorised = 0;
      let skipped = 0;
      for (const s of STANDARD_AIRCRAFT_TYPES) {
        const norm = normalizeKey(`${s.manufacturer} ${s.model}`);
        const [existing] = await tx
          .select()
          .from(aircraftTypes)
          .where(and(eq(aircraftTypes.tenantId, actor.tenantId), eq(aircraftTypes.normalizedName, norm), eq(aircraftTypes.active, true)));
        if (existing) {
          if (!existing.category) {
            await tx.update(aircraftTypes).set({ category: s.category, updatedAt: new Date() }).where(eq(aircraftTypes.id, existing.id));
            categorised++;
          } else skipped++;
          continue;
        }
        const [row] = await tx
          .insert(aircraftTypes)
          .values({ tenantId: actor.tenantId, manufacturer: s.manufacturer, model: s.model, normalizedName: norm, category: s.category })
          .returning({ id: aircraftTypes.id });
        await insertAliases(tx, "type", row.id, [s.model, ...(s.aliases ?? [])], norm);
        added++;
      }
      return { added, categorised, skipped };
    },
  });
}

export function createAircraftType(db: Db, actor: Actor, key: string, input: CreateAircraftTypeInput) {
  return runAction({
    db,
    actor,
    name: "aircraftType.create",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const manufacturer = input.manufacturer.trim();
      const model = input.model.trim();
      if (!manufacturer || !model) throw invalid("Manufacturer and model are required");
      const category = checkCategory(input.category);
      const norm = normalizeKey(`${manufacturer} ${model}`);
      const dup = await tx
        .select({ id: aircraftTypes.id })
        .from(aircraftTypes)
        .where(and(eq(aircraftTypes.tenantId, actor.tenantId), eq(aircraftTypes.normalizedName, norm), eq(aircraftTypes.active, true)));
      if (dup.length) throw conflict("DUPLICATE_AIRCRAFT_TYPE", `Aircraft type "${manufacturer} ${model}" already exists`, { id: dup[0].id });
      const [t] = await tx
        .insert(aircraftTypes)
        .values({ tenantId: actor.tenantId, manufacturer, model, normalizedName: norm, category })
        .returning({ id: aircraftTypes.id });
      // "G650ER" alone must resolve to "Gulfstream G650ER".
      await insertAliases(tx, "type", t.id, [model, ...(input.aliases ?? [])], norm);
      return { aircraftTypeId: t.id };
    },
  });
}

export function addAircraftTypeAlias(db: Db, actor: Actor, key: string, input: { aircraftTypeId: string; alias: string }) {
  return runAction({
    db,
    actor,
    name: "aircraftType.addAlias",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const [t] = await tx.select().from(aircraftTypes).where(and(eq(aircraftTypes.id, input.aircraftTypeId), eq(aircraftTypes.tenantId, actor.tenantId)));
      if (!t) throw notFound("Aircraft type");
      await insertAliases(tx, "type", t.id, [input.alias], t.normalizedName);
      return { aircraftTypeId: t.id };
    },
  });
}

// ---------------------------------------------------------------- aircraft

export interface BaseInput {
  mode: BaseMode;
  locations?: string[];
}

export interface InformationInput {
  yom?: number | null;
  yor?: number | null;
  capacity?: number | null;
  wifiStatus?: WifiStatus;
  wifiDetail?: string | null;
  notes?: string | null;
}

export interface CreateAircraftInput {
  aircraftTypeId: string;
  /** Optional: an aircraft can be recorded before its tail number is known (add it later with "Change tail"). */
  registration?: string | null;
  serialNumber?: string | null;
  operatorId?: string | null;
  base?: BaseInput;
  info?: InformationInput;
  /** Required to proceed when the tail is currently registered to another aircraft. */
  tailResolution?: "distinct_aircraft";
  evidenceText?: string | null;
}

export function createAircraft(db: Db, actor: Actor, key: string, input: CreateAircraftInput) {
  return runAction({
    db,
    actor,
    name: "aircraft.create",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const [type] = await tx.select().from(aircraftTypes).where(and(eq(aircraftTypes.id, input.aircraftTypeId), eq(aircraftTypes.tenantId, actor.tenantId)));
      if (!type || !type.active) throw notFound("Aircraft type");
      const reg = (input.registration ?? "").trim();
      const serial = input.serialNumber?.trim() || null;

      if (serial) {
        const dup = await tx
          .select({ id: aircraft.id })
          .from(aircraft)
          .where(and(eq(aircraft.tenantId, actor.tenantId), eq(aircraft.aircraftTypeId, type.id), eq(aircraft.serialNumber, serial), eq(aircraft.active, true)));
        if (dup.length) throw conflict("DUPLICATE_AIRCRAFT", `An aircraft of this type with serial ${serial} already exists`, { aircraftId: dup[0].id });
      }
      if (reg) await assertTailFree(tx, actor, reg, undefined, input.tailResolution);

      const evidenceId = await recordManualEvidence(tx, actor, input.evidenceText);
      const [ac] = await tx
        .insert(aircraft)
        .values({ tenantId: actor.tenantId, aircraftTypeId: type.id, serialNumber: serial, createdSourceEvidenceId: evidenceId })
        .returning({ id: aircraft.id });

      if (reg) {
        await tx.insert(aircraftRegistrations).values({
          aircraftId: ac.id,
          registration: reg,
          normalizedRegistration: normalizeRegistration(reg),
          isCurrent: true,
          sourceEvidenceId: evidenceId,
          recordedBy: actor.id,
        });
      }
      if (input.info) await insertInformationVersion(tx, actor, ac.id, 1, input.info, evidenceId, null);
      if (input.base) await replaceBases(tx, actor, ac.id, input.base, evidenceId, null);
      if (input.operatorId) await replaceOperator(tx, actor, ac.id, input.operatorId, evidenceId, null);
      return { aircraftId: ac.id };
    },
  });
}

/** A tail is never assumed to mean the same aircraft: reuse needs explicit resolution. */
async function assertTailFree(tx: Q, actor: Actor, registration: string, exceptAircraftId: string | undefined, resolution?: "distinct_aircraft") {
  const norm = normalizeRegistration(registration);
  const rows = await tx
    .select({ aircraftId: aircraftRegistrations.aircraftId })
    .from(aircraftRegistrations)
    .innerJoin(aircraft, eq(aircraft.id, aircraftRegistrations.aircraftId))
    .where(
      and(
        eq(aircraft.tenantId, actor.tenantId),
        eq(aircraft.active, true),
        eq(aircraftRegistrations.normalizedRegistration, norm),
        eq(aircraftRegistrations.isCurrent, true),
      ),
    );
  const others = rows.filter((r) => r.aircraftId !== exceptAircraftId);
  if (others.length && resolution !== "distinct_aircraft") {
    throw conflict(
      "TAIL_IN_USE",
      `Tail ${registration} is currently registered to another aircraft. Confirm it is a distinct aircraft to continue.`,
      { aircraftIds: others.map((o) => o.aircraftId) },
    );
  }
}

export function changeRegistration(
  db: Db,
  actor: Actor,
  key: string,
  input: { aircraftId: string; newRegistration: string; effectiveDate?: string | null; tailResolution?: "distinct_aircraft" },
) {
  return runAction({
    db,
    actor,
    name: "aircraft.changeRegistration",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      await requireAircraft(tx, actor, input.aircraftId);
      const reg = input.newRegistration.trim();
      if (!reg) throw invalid("Tail number is required");
      const [current] = await tx
        .select()
        .from(aircraftRegistrations)
        .where(and(eq(aircraftRegistrations.aircraftId, input.aircraftId), eq(aircraftRegistrations.isCurrent, true)));
      if (current && current.normalizedRegistration === normalizeRegistration(reg)) {
        throw invalid("That tail number is already the current registration");
      }
      await assertTailFree(tx, actor, reg, input.aircraftId, input.tailResolution);
      const evidenceId = await recordManualEvidence(tx, actor);
      if (current) {
        await tx
          .update(aircraftRegistrations)
          .set({ isCurrent: false, validTo: input.effectiveDate ?? null })
          .where(eq(aircraftRegistrations.id, current.id));
      }
      const [row] = await tx
        .insert(aircraftRegistrations)
        .values({
          aircraftId: input.aircraftId,
          registration: reg,
          normalizedRegistration: normalizeRegistration(reg),
          validFrom: input.effectiveDate ?? null,
          isCurrent: true,
          sourceEvidenceId: evidenceId,
          version: (current?.version ?? 0) + 1,
          recordedBy: actor.id,
        })
        .returning({ id: aircraftRegistrations.id });
      return { aircraftId: input.aircraftId, registrationId: row.id };
    },
  });
}

async function requireAircraft(tx: Q, actor: Actor, aircraftId: string) {
  const [row] = await tx.select().from(aircraft).where(and(eq(aircraft.id, aircraftId), eq(aircraft.tenantId, actor.tenantId)));
  if (!row || !row.active) throw notFound("Aircraft");
  return row;
}

// ---------------------------------------------------------------- information versions

function validateInfo(info: InformationInput) {
  const year = (v: number | null | undefined, label: string) => {
    if (v != null && (!Number.isInteger(v) || v < 1900 || v > 2100)) throw invalid(`${label} must be a year between 1900 and 2100`);
  };
  year(info.yom, "YOM");
  year(info.yor, "YOR");
  if (info.capacity != null && (!Number.isInteger(info.capacity) || info.capacity < 0 || info.capacity > 1000)) {
    throw invalid("Capacity must be a whole number between 0 and 1000");
  }
  if (info.wifiStatus && !WIFI_STATUSES.includes(info.wifiStatus)) throw invalid("Wi-Fi must be yes, no, tbc or unknown");
}

async function insertInformationVersion(
  tx: Q,
  actor: Actor,
  aircraftId: string,
  versionNumber: number,
  info: InformationInput,
  evidenceId: string,
  effectiveDate: string | null,
) {
  validateInfo(info);
  const [row] = await tx
    .insert(aircraftInformationVersions)
    .values({
      aircraftId,
      versionNumber,
      yom: info.yom ?? null,
      yor: info.yor ?? null,
      capacity: info.capacity ?? null,
      wifiStatus: info.wifiStatus ?? "unknown",
      wifiDetail: info.wifiDetail?.trim() || null,
      notes: info.notes?.trim() || null,
      sourceEvidenceId: evidenceId,
      effectiveDate,
      createdBy: actor.id,
      isCurrent: true,
    })
    .returning({ id: aircraftInformationVersions.id });
  return row.id;
}

export function addInformationVersion(
  db: Db,
  actor: Actor,
  key: string,
  input: { aircraftId: string; expectedVersion: number; info: InformationInput; effectiveDate?: string | null },
) {
  return runAction({
    db,
    actor,
    name: "aircraft.addInformationVersion",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      await requireAircraft(tx, actor, input.aircraftId);
      const [current] = await tx
        .select()
        .from(aircraftInformationVersions)
        .where(and(eq(aircraftInformationVersions.aircraftId, input.aircraftId), eq(aircraftInformationVersions.isCurrent, true)));
      const currentNumber = current?.versionNumber ?? 0;
      if (input.expectedVersion !== currentNumber) {
        throw conflict("VERSION_MISMATCH", `Aircraft information changed (now version ${currentNumber}). Reload and retry.`, { currentVersion: currentNumber });
      }
      validateInfo(input.info);
      const evidenceId = await recordManualEvidence(tx, actor);
      if (current) {
        await tx.update(aircraftInformationVersions).set({ isCurrent: false }).where(eq(aircraftInformationVersions.id, current.id));
      }
      const id = await insertInformationVersion(tx, actor, input.aircraftId, currentNumber + 1, input.info, evidenceId, input.effectiveDate ?? null);
      return { aircraftId: input.aircraftId, informationVersionId: id, versionNumber: currentNumber + 1 };
    },
  });
}

// ---------------------------------------------------------------- bases

async function replaceBases(tx: Q, actor: Actor, aircraftId: string, base: BaseInput, evidenceId: string, effectiveDate: string | null) {
  const locations = (base.locations ?? []).map((l) => l.trim()).filter(Boolean);
  if (base.mode === "floating") {
    // Floating is exclusive: it cannot coexist with active base locations.
    if (locations.length) throw invalid("An aircraft cannot be Floating and have base locations at the same time");
  } else if (locations.length === 0) {
    throw invalid("Give at least one base location, or choose Floating");
  }
  await tx
    .update(aircraftBases)
    .set({ active: false, validTo: effectiveDate })
    .where(and(eq(aircraftBases.aircraftId, aircraftId), eq(aircraftBases.active, true)));
  if (base.mode === "floating") {
    await tx.insert(aircraftBases).values({ aircraftId, mode: "floating", location: null, displayOrder: 0, validFrom: effectiveDate, sourceEvidenceId: evidenceId, recordedBy: actor.id });
  } else {
    let order = 0;
    for (const loc of locations) {
      await tx.insert(aircraftBases).values({ aircraftId, mode: "based", location: loc, displayOrder: order++, validFrom: effectiveDate, sourceEvidenceId: evidenceId, recordedBy: actor.id });
    }
  }
}

export function setBases(db: Db, actor: Actor, key: string, input: { aircraftId: string; base: BaseInput; effectiveDate?: string | null }) {
  return runAction({
    db,
    actor,
    name: "aircraft.setBases",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      await requireAircraft(tx, actor, input.aircraftId);
      const evidenceId = await recordManualEvidence(tx, actor);
      await replaceBases(tx, actor, input.aircraftId, input.base, evidenceId, input.effectiveDate ?? null);
      return { aircraftId: input.aircraftId };
    },
  });
}

// ---------------------------------------------------------------- relationships

async function replaceOperator(tx: Q, actor: Actor, aircraftId: string, organisationId: string, evidenceId: string, validFrom: string | null) {
  const [org] = await tx.select().from(organisations).where(and(eq(organisations.id, organisationId), eq(organisations.tenantId, actor.tenantId)));
  if (!org || !org.active) throw notFound("Organisation");
  const [active] = await tx
    .select()
    .from(organisationAircraftRelationships)
    .where(and(eq(organisationAircraftRelationships.aircraftId, aircraftId), eq(organisationAircraftRelationships.role, "operator"), eq(organisationAircraftRelationships.active, true)));
  if (active?.organisationId === organisationId) return active.id;
  if (active) {
    await tx
      .update(organisationAircraftRelationships)
      .set({ active: false, validTo: validFrom })
      .where(eq(organisationAircraftRelationships.id, active.id));
  }
  const [row] = await tx
    .insert(organisationAircraftRelationships)
    .values({ organisationId, aircraftId, role: "operator", validFrom, sourceEvidenceId: evidenceId, version: (active?.version ?? 0) + 1, recordedBy: actor.id })
    .returning({ id: organisationAircraftRelationships.id });
  return row.id;
}

export function setOperator(db: Db, actor: Actor, key: string, input: { aircraftId: string; organisationId: string; validFrom?: string | null }) {
  return runAction({
    db,
    actor,
    name: "aircraft.setOperator",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      await requireAircraft(tx, actor, input.aircraftId);
      const evidenceId = await recordManualEvidence(tx, actor);
      const id = await replaceOperator(tx, actor, input.aircraftId, input.organisationId, evidenceId, input.validFrom ?? null);
      return { aircraftId: input.aircraftId, relationshipId: id };
    },
  });
}

export function addManagementCompany(db: Db, actor: Actor, key: string, input: { aircraftId: string; organisationId: string }) {
  return runAction({
    db,
    actor,
    name: "aircraft.addManagementCompany",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      await requireAircraft(tx, actor, input.aircraftId);
      const evidenceId = await recordManualEvidence(tx, actor);
      const [existing] = await tx
        .select({ id: organisationAircraftRelationships.id })
        .from(organisationAircraftRelationships)
        .where(
          and(
            eq(organisationAircraftRelationships.aircraftId, input.aircraftId),
            eq(organisationAircraftRelationships.organisationId, input.organisationId),
            eq(organisationAircraftRelationships.role, "management_company"),
            eq(organisationAircraftRelationships.active, true),
          ),
        );
      if (existing) return { relationshipId: existing.id };
      const [row] = await tx
        .insert(organisationAircraftRelationships)
        .values({ organisationId: input.organisationId, aircraftId: input.aircraftId, role: "management_company", sourceEvidenceId: evidenceId, recordedBy: actor.id })
        .returning({ id: organisationAircraftRelationships.id });
      return { relationshipId: row.id };
    },
  });
}

// ---------------------------------------------------------------- reads: card + resolution

export interface AircraftCard {
  aircraftId: string;
  operator: string | null;
  aircraft: string; // manufacturer + model
  tailNumber: string | null;
  base: string | null; // "Hong Kong / Singapore" | "Floating" | null
  yom: number | null;
  yor: number | null;
  capacity: number | null;
  wifi: WifiStatus;
  wifiDetail: string | null;
  notes: string | null;
  informationVersionId: string | null;
  informationVersion: number;
}

export async function getAircraftCard(db: Q, aircraftId: string): Promise<AircraftCard | null> {
  const [ac] = await db.select().from(aircraft).where(eq(aircraft.id, aircraftId));
  if (!ac) return null;
  const [type] = await db.select().from(aircraftTypes).where(eq(aircraftTypes.id, ac.aircraftTypeId));
  const [reg] = await db
    .select()
    .from(aircraftRegistrations)
    .where(and(eq(aircraftRegistrations.aircraftId, aircraftId), eq(aircraftRegistrations.isCurrent, true)));
  const [info] = await db
    .select()
    .from(aircraftInformationVersions)
    .where(and(eq(aircraftInformationVersions.aircraftId, aircraftId), eq(aircraftInformationVersions.isCurrent, true)));
  const bases = await db
    .select()
    .from(aircraftBases)
    .where(and(eq(aircraftBases.aircraftId, aircraftId), eq(aircraftBases.active, true)))
    .orderBy(asc(aircraftBases.displayOrder));
  const [op] = await db
    .select({ name: organisations.canonicalName })
    .from(organisationAircraftRelationships)
    .innerJoin(organisations, eq(organisations.id, organisationAircraftRelationships.organisationId))
    .where(
      and(
        eq(organisationAircraftRelationships.aircraftId, aircraftId),
        eq(organisationAircraftRelationships.role, "operator"),
        eq(organisationAircraftRelationships.active, true),
      ),
    );
  const base = bases.length === 0 ? null : bases[0].mode === "floating" ? "Floating" : bases.map((b) => b.location).join(" / ");
  return {
    aircraftId,
    operator: op?.name ?? null,
    aircraft: `${type.manufacturer} ${type.model}`,
    tailNumber: reg?.registration ?? null,
    base,
    yom: info?.yom ?? null,
    yor: info?.yor ?? null,
    capacity: info?.capacity ?? null,
    wifi: info?.wifiStatus ?? "unknown",
    wifiDetail: info?.wifiDetail ?? null,
    notes: info?.notes ?? null,
    informationVersionId: info?.id ?? null,
    informationVersion: info?.versionNumber ?? 0,
  };
}

/**
 * Resolve user text to organisations using canonical names and aliases.
 * Returns ALL matches (exact first, then partial) so callers can show every candidate.
 */
export async function resolveOrganisations(db: Q, tenantId: string, text: string) {
  const n = normalizeKey(text);
  if (!n) return [];
  const orgs = await db.select().from(organisations).where(and(eq(organisations.tenantId, tenantId), eq(organisations.active, true)));
  const aliases = await db.select().from(organisationAliases);
  const aliasesByOrg = new Map<string, string[]>();
  for (const a of aliases) aliasesByOrg.set(a.organisationId, [...(aliasesByOrg.get(a.organisationId) ?? []), a.normalizedAlias]);
  return rank(orgs.map((o) => ({ item: o, keys: [o.normalizedName, ...(aliasesByOrg.get(o.id) ?? [])] })), n);
}

export async function resolveAircraftTypes(db: Q, tenantId: string, text: string) {
  const n = normalizeKey(text);
  if (!n) return [];
  const types = await db.select().from(aircraftTypes).where(and(eq(aircraftTypes.tenantId, tenantId), eq(aircraftTypes.active, true)));
  const aliases = await db.select().from(aircraftTypeAliases);
  const byType = new Map<string, string[]>();
  for (const a of aliases) byType.set(a.aircraftTypeId, [...(byType.get(a.aircraftTypeId) ?? []), a.normalizedAlias]);
  return rank(types.map((t) => ({ item: t, keys: [t.normalizedName, ...(byType.get(t.id) ?? [])] })), n);
}

function rank<T>(entries: { item: T; keys: string[] }[], n: string): T[] {
  const exact: T[] = [];
  const partial: T[] = [];
  for (const { item, keys } of entries) {
    if (keys.some((k) => k === n)) exact.push(item);
    else if (n.length >= 3 && keys.some((k) => k.includes(n) || (k.length >= 3 && n.includes(k)))) partial.push(item);
  }
  return [...exact, ...partial];
}

/** Aircraft whose current tail matches (normalised). Never creates or merges identity. */
export async function findAircraftByTail(db: Q, tenantId: string, tail: string) {
  const norm = normalizeRegistration(tail);
  if (!norm) return [];
  return db
    .select({ aircraftId: aircraft.id })
    .from(aircraftRegistrations)
    .innerJoin(aircraft, eq(aircraft.id, aircraftRegistrations.aircraftId))
    .where(
      and(eq(aircraft.tenantId, tenantId), eq(aircraft.active, true), eq(aircraftRegistrations.isCurrent, true), eq(aircraftRegistrations.normalizedRegistration, norm)),
    );
}

export async function listRegistrationHistory(db: Q, aircraftId: string) {
  return db.select().from(aircraftRegistrations).where(eq(aircraftRegistrations.aircraftId, aircraftId)).orderBy(asc(aircraftRegistrations.version));
}

export async function listInformationVersions(db: Q, aircraftId: string) {
  return db.select().from(aircraftInformationVersions).where(eq(aircraftInformationVersions.aircraftId, aircraftId)).orderBy(asc(aircraftInformationVersions.versionNumber));
}

/** Only names or aliases that are exactly the text (ignoring case, spaces and punctuation); never partial matches. */
export async function resolveOrganisationsExact(db: Q, tenantId: string, text: string) {
  const n = normalizeKey(text);
  if (!n) return [];
  const orgs = await db.select().from(organisations).where(and(eq(organisations.tenantId, tenantId), eq(organisations.active, true)));
  const aliases = await db.select().from(organisationAliases);
  return orgs.filter((o) => o.normalizedName === n || aliases.some((a) => a.organisationId === o.id && a.normalizedAlias === n));
}

export async function resolveAircraftTypesExact(db: Q, tenantId: string, text: string) {
  const n = normalizeKey(text);
  if (!n) return [];
  const types = await db.select().from(aircraftTypes).where(and(eq(aircraftTypes.tenantId, tenantId), eq(aircraftTypes.active, true)));
  const aliases = await db.select().from(aircraftTypeAliases);
  return types.filter((t) => t.normalizedName === n || aliases.some((a) => a.aircraftTypeId === t.id && a.normalizedAlias === n));
}

/** Active aircraft of a type (optionally for one operator) that have no tail number recorded yet. */
export async function findAircraftWithoutTail(db: Q, tenantId: string, aircraftTypeId: string, operatorId?: string | null) {
  const acs = await db.select().from(aircraft).where(and(eq(aircraft.tenantId, tenantId), eq(aircraft.aircraftTypeId, aircraftTypeId), eq(aircraft.active, true)));
  const out: string[] = [];
  for (const a of acs) {
    const [reg] = await db.select({ id: aircraftRegistrations.id }).from(aircraftRegistrations).where(and(eq(aircraftRegistrations.aircraftId, a.id), eq(aircraftRegistrations.isCurrent, true)));
    if (reg) continue;
    if (operatorId) {
      const [rel] = await db
        .select({ id: organisationAircraftRelationships.id })
        .from(organisationAircraftRelationships)
        .where(and(eq(organisationAircraftRelationships.aircraftId, a.id), eq(organisationAircraftRelationships.organisationId, operatorId), eq(organisationAircraftRelationships.role, "operator"), eq(organisationAircraftRelationships.active, true)));
      if (!rel) continue;
    }
    out.push(a.id);
  }
  return out;
}
