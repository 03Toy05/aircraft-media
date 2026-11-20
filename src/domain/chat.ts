import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { aircraft, aircraftMedia, aircraftTypes, organisationAircraftRelationships } from "../db/schema";
import type { Actor } from "./action";
import type { ParsedCard } from "./card";
import { guessClassificationFromFilename, CLASSIFICATIONS, type Classification, type WifiStatus, type YesNoStatus } from "./constants";
import { addInformationVersion, addOrganisationAlias, setOrganisationRegion, createAircraft, createOrganisation, findAircraftByTail, getAircraftCard, resolveAircraftTypes, resolveAircraftTypesExact, resolveOrganisations, setBases, setOperator } from "./directory";
import { DomainError } from "./errors";
import { approveMedia, setMediaAssociation, updateMediaMetadata } from "./media";

type Q = Parameters<typeof findAircraftByTail>[0];

export interface CardMatches {
  tailMatches: string[];
  opMatches: { id: string; canonicalName: string }[];
  typeMatches: { id: string; manufacturer: string; model: string }[];
  operatorText: string;
  operatorLoose: boolean;
  aircraftText: string;
  leftover: string[];
}

/**
 * Match what a card says against the directory (names and aliases; all matches are returned, never guessed).
 * Unlabelled lines are tried against operators and aircraft types; if nothing matches and exactly one line is left,
 * it is offered as a new operator name (never created without confirmation).
 */
export async function matchCard(db: Q, tenantId: string, parsed: ParsedCard): Promise<CardMatches> {
  const r: CardMatches = { tailMatches: [], opMatches: [], typeMatches: [], operatorText: parsed.operator ?? "", operatorLoose: false, aircraftText: parsed.aircraft ?? "", leftover: [] };
  if (parsed.tail) r.tailMatches = (await findAircraftByTail(db, tenantId, parsed.tail)).map((x) => x.aircraftId);
  if (r.operatorText) r.opMatches = await resolveOrganisations(db, tenantId, r.operatorText);
  if (r.aircraftText) {
    // "G650ER" also partly matches "G650": an exact name wins outright.
    const exact = await resolveAircraftTypesExact(db, tenantId, r.aircraftText);
    r.typeMatches = exact.length === 1 ? exact : await resolveAircraftTypes(db, tenantId, r.aircraftText);
  }
  for (const line of parsed.unrecognised ?? []) {
    if (!r.operatorText) {
      const o = await resolveOrganisations(db, tenantId, line);
      if (o.length) { r.operatorText = line; r.opMatches = o; r.operatorLoose = true; continue; }
    }
    if (!r.aircraftText) {
      const t = await resolveAircraftTypes(db, tenantId, line);
      if (t.length) { r.aircraftText = line; r.typeMatches = t; continue; }
    }
    r.leftover.push(line);
  }
  if (!r.operatorText && r.leftover.length >= 1) { r.operatorText = r.leftover[0]; r.operatorLoose = true; r.leftover = r.leftover.slice(1); }
  return r;
}

export interface ApplyInput {
  mediaIds: string[];
  /** Per photo: the classification to set (unclassified = leave it for review). */
  classifications: Record<string, Classification>;
  operatorId?: string | null;
  newOperatorName?: string | null;
  /** Saved on the operator (new or existing) when given. */
  region?: string | null;
  aircraftTypeId?: string | null;
  /** The operator name was given as another name for this existing operator: remember it as an alias. */
  aliasOf?: { organisationId: string; alias: string } | null;
  aircraft: { mode: "existing"; aircraftId: string } | { mode: "new"; registration: string; serialNumber?: string | null; distinct?: boolean } | { mode: "none" };
  info: { yom: number | null; yor: number | null; capacity: number | null; wifiStatus: WifiStatus; wifiDetail?: string | null; smoking?: YesNoStatus; pets?: YesNoStatus; cleaningFee?: string | null; notes: string | null };
  base?: { mode: "based" | "floating"; locations: string[] };
  evidenceText?: string | null;
}

export interface ApplyResult {
  steps: string[];
  aircraftId: string | null;
  photos: { mediaId: string; outcome: "approved" | "left_in_review" | "failed"; detail: string }[];
}

/**
 * Applies a confirmed chat proposal using the normal domain actions (each idempotent, each recorded).
 * Steps are independent: a failure is reported and the remaining steps still run, so nothing is silently lost.
 */
export async function applyChatProposal(db: Db, actor: Actor, key: string, input: ApplyInput): Promise<ApplyResult> {
  const out: ApplyResult = { steps: [], aircraftId: null, photos: [] };
  const fail = (what: string, e: unknown) => {
    if (e instanceof DomainError) out.steps.push(`${what}: ${e.message}`);
    else throw e;
  };

  let operatorId = input.operatorId || null;
  if (!operatorId && input.newOperatorName?.trim()) {
    try {
      operatorId = (await createOrganisation(db, actor, `${key}:operator`, { name: input.newOperatorName.trim(), roles: ["operator"], aliases: [], region: input.region ?? null })).result.organisationId;
      out.steps.push(`Operator “${input.newOperatorName.trim()}” created`);
    } catch (e) {
      fail("Operator not created", e);
    }
  }

  if (operatorId && input.region?.trim() && !input.newOperatorName?.trim()) {
    try {
      await setOrganisationRegion(db, actor, `${key}:region`, { organisationId: operatorId, region: input.region });
      out.steps.push(`Region set to ${input.region.trim()}`);
    } catch (e) {
      fail("Region not saved", e);
    }
  }

  if (input.aliasOf) {
    try {
      await addOrganisationAlias(db, actor, `${key}:alias`, { organisationId: input.aliasOf.organisationId, alias: input.aliasOf.alias });
      out.steps.push(`“${input.aliasOf.alias}” saved as another name for that operator`);
    } catch (e) {
      fail("Other name not saved", e);
    }
  }

  let aircraftId: string | null = null;
  if (input.aircraft.mode === "existing") {
    const [own] = await db.select({ id: aircraft.id }).from(aircraft).where(and(eq(aircraft.id, input.aircraft.aircraftId), eq(aircraft.tenantId, actor.tenantId), eq(aircraft.active, true)));
    if (own) {
      aircraftId = own.id;
      out.steps.push(...(await updateExistingAircraft(db, actor, key, aircraftId, operatorId, input)));
    } else out.steps.push("Aircraft not found");
  } else if (input.aircraft.mode === "new") {
    try {
      if (!input.aircraftTypeId) throw new DomainError("INVALID", "Choose an aircraft type to create the aircraft");
      const r = await createAircraft(db, actor, `${key}:aircraft`, {
        aircraftTypeId: input.aircraftTypeId,
        registration: input.aircraft.registration,
        serialNumber: input.aircraft.serialNumber ?? null,
        operatorId,
        base: input.base,
        tailResolution: input.aircraft.distinct ? "distinct_aircraft" : undefined,
        info: input.info,
        evidenceText: input.evidenceText ?? null,
      });
      aircraftId = r.result.aircraftId;
      out.steps.push(input.aircraft.registration.trim() ? `Aircraft ${input.aircraft.registration} created` : "Aircraft created (no tail number yet)");
    } catch (e) {
      fail("Aircraft not created", e);
    }
  }
  out.aircraftId = aircraftId;

  for (const mediaId of input.mediaIds) {
    try {
      const cls = input.classifications[mediaId];
      const reasons: string[] = [];
      let [m] = await db.select().from(aircraftMedia).where(eq(aircraftMedia.id, mediaId));
      if (!m || m.tenantId !== actor.tenantId) throw new DomainError("NOT_FOUND", "Photo not found");
      if (cls && (CLASSIFICATIONS as readonly string[]).includes(cls) && cls !== "unclassified") {
        await updateMediaMetadata(db, actor, `${key}:meta:${mediaId}`, { mediaId, expectedVersion: m.version, classification: cls });
        [m] = await db.select().from(aircraftMedia).where(eq(aircraftMedia.id, mediaId));
      } else reasons.push("no classification chosen");
      if (aircraftId) {
        await setMediaAssociation(db, actor, `${key}:assoc:${mediaId}`, { mediaId, expectedVersion: m.version, status: "actual_aircraft", aircraftId });
      } else if (input.aircraftTypeId) {
        await setMediaAssociation(db, actor, `${key}:assoc:${mediaId}`, { mediaId, expectedVersion: m.version, status: "representative_type", aircraftTypeId: input.aircraftTypeId });
      } else reasons.push("no aircraft or type to attach it to");
      [m] = await db.select().from(aircraftMedia).where(eq(aircraftMedia.id, mediaId));
      if (reasons.length === 0 && m.reviewState === "needs_review" && m.currentContentVersionId) {
        await approveMedia(db, actor, { mediaId, contentVersionId: m.currentContentVersionId, expectedVersion: m.version });
        out.photos.push({ mediaId, outcome: "approved", detail: aircraftId ? "approved as this aircraft" : "approved as representative of the type" });
      } else {
        out.photos.push({ mediaId, outcome: "left_in_review", detail: reasons.length ? `left in Review: ${reasons.join(", ")}` : `already ${m.reviewState.replace(/_/g, " ")}` });
      }
    } catch (e) {
      if (e instanceof DomainError) out.photos.push({ mediaId, outcome: "failed", detail: e.message });
      else throw e;
    }
  }
  return out;
}

/** Suggest a classification per file name; "unclassified" when the name gives no clear hint. */
export function suggestClassification(filename: string): Classification {
  return guessClassificationFromFilename(filename) ?? "unclassified";
}

export async function listTypeOptions(db: Q, tenantId: string) {
  const rows = await db.select().from(aircraftTypes).where(and(eq(aircraftTypes.tenantId, tenantId), eq(aircraftTypes.active, true)));
  return rows.map((t) => ({ id: t.id, label: `${t.manufacturer} ${t.model}`, category: t.category })).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The owner chose an existing aircraft and gave details: save exactly what they gave, nothing else.
 * Fields they did not mention keep their current values. Changes are saved as new versions, so earlier values stay in history.
 */
async function updateExistingAircraft(db: Db, actor: Actor, key: string, aircraftId: string, operatorId: string | null, input: ApplyInput): Promise<string[]> {
  const steps: string[] = [];
  try {
    const card = await getAircraftCard(db, aircraftId);
    if (!card) throw new DomainError("NOT_FOUND", "Aircraft not found");
    const next = {
      yom: input.info.yom ?? card.yom,
      yor: input.info.yor ?? card.yor,
      capacity: input.info.capacity ?? card.capacity,
      wifiStatus: input.info.wifiStatus !== "unknown" ? input.info.wifiStatus : card.wifi,
      wifiDetail: input.info.wifiDetail ?? card.wifiDetail,
      // Not mentioned = kept as it is (a new version must not reset them).
      smoking: input.info.smoking && input.info.smoking !== "unknown" ? input.info.smoking : card.smoking,
      pets: input.info.pets && input.info.pets !== "unknown" ? input.info.pets : card.pets,
      cleaningFee: input.info.cleaningFee ?? card.cleaningFee,
      notes: input.info.notes ?? card.notes,
    };
    const changed = [
      next.yom !== card.yom && "YOM",
      next.yor !== card.yor && "YOR",
      next.capacity !== card.capacity && "capacity",
      (next.wifiStatus !== card.wifi || next.wifiDetail !== card.wifiDetail) && "WIFI",
      next.smoking !== card.smoking && "smoking",
      next.pets !== card.pets && "pets",
      next.cleaningFee !== card.cleaningFee && "cleaning fee",
      next.notes !== card.notes && "notes",
    ].filter(Boolean) as string[];
    if (changed.length) {
      await addInformationVersion(db, actor, `${key}:info`, { aircraftId, expectedVersion: card.informationVersion, info: next });
      steps.push(`Existing aircraft updated: ${changed.join(", ")} (earlier values are kept in its history)`);
    }
    if (input.base) {
      const label = input.base.mode === "floating" ? "Floating" : input.base.locations.join(" / ");
      if (label !== (card.base ?? "")) {
        await setBases(db, actor, `${key}:base`, { aircraftId, base: input.base });
        steps.push(`Existing aircraft updated: base (${label})`);
      }
    }
    if (operatorId) {
      const current = await db
        .select({ id: organisationAircraftRelationships.organisationId })
        .from(organisationAircraftRelationships)
        .where(and(eq(organisationAircraftRelationships.aircraftId, aircraftId), eq(organisationAircraftRelationships.role, "operator"), eq(organisationAircraftRelationships.active, true)));
      if (!current.some((c) => c.id === operatorId)) {
        await setOperator(db, actor, `${key}:operator-set`, { aircraftId, organisationId: operatorId });
        steps.push("Existing aircraft updated: operator");
      }
    }
  } catch (e) {
    if (e instanceof DomainError) steps.push(`Existing aircraft not fully updated: ${e.message}`);
    else throw e;
  }
  return steps;
}
