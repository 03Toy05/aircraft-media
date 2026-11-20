import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  aircraft, aircraftBases, aircraftMedia, aircraftTypes, libraryContributions, mediaAssociations,
  organisationAircraftRelationships, organisations, users,
} from "../db/schema";
import type { Actor } from "./action";
import { normalizeKey, normalizeRegistration, type Classification } from "./constants";
import {
  createAircraft, createAircraftType, createOrganisation, findAircraftByTail, findAircraftWithoutTail, getAircraftCard,
  loadStandardAircraftTypes, resolveAircraftTypesExact, resolveOrganisationsExact,
} from "./directory";
import { approveMedia, ingestUpload, readContentBytes, setMediaAssociation, updateMediaMetadata } from "./media";
import { makeCombinedPhoto } from "./combinedPhoto";
import { STANDARD_LIST_VERSION } from "./standardTypes";
import type { FileStore } from "../storage";

/**
 * The platform library: one shared set of photos per aircraft, filled from users' approved photos.
 *  - It is a workspace of its own (LIBRARY_TENANT_ID), so every page and rule that works on a workspace works on it.
 *  - A user's photos are only offered once they turn on "Share my approved photos with the library".
 *  - Each library aircraft keeps 1 exterior, 2 cabin and 1 floor plan; the first complete set wins.
 *  - Nothing enters the library until the admin accepts it. Only the aircraft details and the photos are copied:
 *    never prices, quotes, contacts or notes. Photos marked "restricted" are never offered.
 */
export const LIBRARY_TENANT_ID = "00000000-0000-0000-0000-0000000000b1";
export const LIBRARY_NEEDS: Partial<Record<Classification, number>> = { exterior: 1, cabin: 2, floor_plan: 1 };
const KINDS = Object.keys(LIBRARY_NEEDS) as Classification[];

/** Which library aircraft a workspace aircraft is: by tail number, or by operator and type when it has no tail. */
export function libraryMatchKey(a: { tail: string | null; operator: string | null; aircraft: string }): string | null {
  const tail = a.tail ? normalizeRegistration(a.tail) : "";
  if (tail) return `tail:${tail}`;
  if (!a.operator) return null; // no tail and no operator: it cannot be told apart from others of its type
  return `op:${normalizeKey(a.operator)}|type:${normalizeKey(a.aircraft)}`;
}

/** Photos the library already has (accepted) or has been offered (pending), per kind, for each match key. */
async function slotsTaken(db: Db, keys: string[]): Promise<Map<string, Record<string, number>>> {
  const out = new Map<string, Record<string, number>>();
  if (!keys.length) return out;
  const rows = await db
    .select({ k: libraryContributions.matchKey, c: libraryContributions.classification })
    .from(libraryContributions)
    .where(and(inArray(libraryContributions.matchKey, keys), inArray(libraryContributions.status, ["pending", "accepted"])));
  for (const r of rows) {
    const m = out.get(r.k) ?? {};
    m[r.c] = (m[r.c] ?? 0) + 1;
    out.set(r.k, m);
  }
  return out;
}

/**
 * Offers a workspace's approved photos to the library where the library still needs them. Safe to run any time:
 * a photo is offered once, and nothing is offered for an aircraft whose set is already full or waiting for review.
 * Returns how many photos were offered.
 */
export async function collectContributions(db: Db, tenantId: string, userId: string): Promise<number> {
  if (tenantId === LIBRARY_TENANT_ID) return 0;
  const photos = await db
    .select({ m: aircraftMedia, a: mediaAssociations })
    .from(aircraftMedia)
    .innerJoin(mediaAssociations, and(eq(mediaAssociations.aircraftMediaId, aircraftMedia.id), eq(mediaAssociations.active, true)))
    .where(and(
      eq(aircraftMedia.tenantId, tenantId), eq(aircraftMedia.reviewState, "approved"), eq(aircraftMedia.lifecycleState, "active"),
      eq(mediaAssociations.associationStatus, "actual_aircraft"), inArray(aircraftMedia.primaryClassification, KINDS),
    ))
    .orderBy(asc(aircraftMedia.displayOrder), asc(aircraftMedia.createdAt));
  const usable = photos.filter(({ m, a }) => m.rightsStatus !== "restricted" && m.currentContentVersionId && a.aircraftId);
  if (!usable.length) return 0;

  const offered = new Set((await db.select({ id: libraryContributions.sourceMediaId }).from(libraryContributions)
    .where(inArray(libraryContributions.sourceMediaId, usable.map(({ m }) => m.id)))).map((r) => r.id));
  const byAircraft = new Map<string, typeof usable>();
  for (const p of usable) if (!offered.has(p.m.id)) byAircraft.set(p.a.aircraftId!, [...(byAircraft.get(p.a.aircraftId!) ?? []), p]);

  const cards = new Map<string, { key: string; operator: string | null; aircraft: string; tail: string | null }>();
  for (const id of byAircraft.keys()) {
    const card = await getAircraftCard(db, id);
    const key = card && libraryMatchKey({ tail: card.tailNumber, operator: card.operator, aircraft: card.aircraft });
    if (card && key) cards.set(id, { key, operator: card.operator, aircraft: card.aircraft, tail: card.tailNumber });
  }
  const taken = await slotsTaken(db, [...new Set([...cards.values()].map((c) => c.key))]);

  let n = 0;
  for (const [aircraftId, list] of byAircraft) {
    const card = cards.get(aircraftId);
    if (!card) continue;
    const have = taken.get(card.key) ?? {};
    for (const kind of KINDS) {
      const room = (LIBRARY_NEEDS[kind] ?? 0) - (have[kind] ?? 0);
      for (const { m } of list.filter((p) => p.m.primaryClassification === kind).slice(0, Math.max(0, room))) {
        const inserted = await db.insert(libraryContributions).values({
          sourceTenantId: tenantId, contributorUserId: userId, sourceMediaId: m.id, sourceContentVersionId: m.currentContentVersionId!,
          sourceAircraftId: aircraftId, classification: kind, matchKey: card.key, operatorName: card.operator, aircraftType: card.aircraft, tail: card.tail,
        }).onConflictDoNothing().returning({ id: libraryContributions.id });
        if (inserted.length) { n++; have[kind] = (have[kind] ?? 0) + 1; }
      }
    }
    taken.set(card.key, have);
  }
  return n;
}

/** Every opted-in workspace, offered again (the admin's "check now" button, and after someone turns sharing on). */
export async function collectAll(db: Db): Promise<number> {
  const people = await db.select({ id: users.id, tenantId: users.tenantId }).from(users).where(eq(users.libraryOptIn, true));
  let n = 0;
  for (const u of people) n += await collectContributions(db, u.tenantId, u.id);
  return n;
}

export async function isOptedIn(db: Db, userId: string): Promise<boolean> {
  const [u] = await db.select({ on: users.libraryOptIn }).from(users).where(eq(users.id, userId));
  return !!u?.on;
}

export async function setOptIn(db: Db, userId: string, on: boolean) {
  await db.update(users).set({ libraryOptIn: on, updatedAt: new Date() }).where(eq(users.id, userId));
}

// ---------------------------------------------------------------- review

export interface ReviewGroup {
  matchKey: string;
  operatorName: string | null;
  aircraftType: string;
  tail: string | null;
  contributor: string;
  createdAt: Date;
  /** The library aircraft this would go to, if it exists already. */
  libraryAircraft: { id: string; label: string } | null;
  /** The library operator whose name or alias matches, if any. */
  libraryOperator: { id: string; name: string } | null;
  /** Accepted photos already in the library for this aircraft, per kind. */
  have: Record<string, number>;
  photos: { id: string; classification: string; contentVersionId: string }[];
}

/** Waiting contributions, one group per library aircraft, oldest first. */
export async function reviewGroups(db: Db): Promise<ReviewGroup[]> {
  const rows = await db.select().from(libraryContributions).where(eq(libraryContributions.status, "pending")).orderBy(asc(libraryContributions.createdAt));
  if (!rows.length) return [];
  const emails = new Map((await db.select({ id: users.id, email: users.email }).from(users)
    .where(inArray(users.id, [...new Set(rows.map((r) => r.contributorUserId))]))).map((u) => [u.id, u.email]));
  const accepted = await db.select().from(libraryContributions).where(and(inArray(libraryContributions.matchKey, [...new Set(rows.map((r) => r.matchKey))]), eq(libraryContributions.status, "accepted")));
  const groups = new Map<string, ReviewGroup>();
  for (const r of rows) {
    let g = groups.get(r.matchKey);
    if (!g) {
      const libAc = await findLibraryAircraft(db, r);
      const op = r.operatorName ? (await resolveOrganisationsExact(db, LIBRARY_TENANT_ID, r.operatorName))[0] : undefined;
      const have: Record<string, number> = {};
      for (const a of accepted.filter((x) => x.matchKey === r.matchKey)) have[a.classification] = (have[a.classification] ?? 0) + 1;
      g = {
        matchKey: r.matchKey, operatorName: r.operatorName, aircraftType: r.aircraftType, tail: r.tail,
        contributor: emails.get(r.contributorUserId) ?? "unknown", createdAt: r.createdAt,
        libraryAircraft: libAc ? { id: libAc, label: [r.operatorName, r.aircraftType, r.tail].filter(Boolean).join(" · ") } : null,
        libraryOperator: op ? { id: op.id, name: op.canonicalName } : null,
        have, photos: [],
      };
      groups.set(r.matchKey, g);
    }
    g.photos.push({ id: r.id, classification: r.classification, contentVersionId: r.sourceContentVersionId });
  }
  return [...groups.values()];
}

/** The library aircraft a contribution belongs to, if the library has it already (by tail; else by operator and type). */
async function findLibraryAircraft(db: Db, r: { tail: string | null; operatorName: string | null; aircraftType: string; libraryAircraftId?: string | null }, operatorId?: string | null): Promise<string | null> {
  if (r.tail) return (await findAircraftByTail(db, LIBRARY_TENANT_ID, r.tail))[0]?.aircraftId ?? null;
  const [type] = await resolveAircraftTypesExact(db, LIBRARY_TENANT_ID, r.aircraftType);
  const opId = operatorId ?? (r.operatorName ? (await resolveOrganisationsExact(db, LIBRARY_TENANT_ID, r.operatorName))[0]?.id : null);
  if (!type || !opId) return null;
  return (await findAircraftWithoutTail(db, LIBRARY_TENANT_ID, type.id, opId))[0] ?? null;
}

/** Approved, active photos of each kind on a library aircraft. */
async function libraryCounts(db: Db, aircraftId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ c: aircraftMedia.primaryClassification })
    .from(aircraftMedia)
    .innerJoin(mediaAssociations, and(eq(mediaAssociations.aircraftMediaId, aircraftMedia.id), eq(mediaAssociations.active, true)))
    .where(and(eq(aircraftMedia.tenantId, LIBRARY_TENANT_ID), eq(mediaAssociations.aircraftId, aircraftId), eq(aircraftMedia.reviewState, "approved"), eq(aircraftMedia.lifecycleState, "active")));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.c] = (out[r.c] ?? 0) + 1;
  return out;
}

export interface AcceptResult { accepted: number; skipped: string[]; libraryAircraftId: string }

/**
 * Accepts the chosen photos of one group into the library: finds or creates the library operator (the one the admin
 * picked, or a new one), the type and the aircraft (details copied from the contributor's aircraft only when it is
 * new), then copies each photo in as approved. Photos beyond the 1 / 2 / 1 set, or no longer approved in the
 * contributor's workspace, are passed over. Other waiting photos for a kind that is now full are marked superseded.
 */
export async function acceptContributions(
  db: Db, store: FileStore, admin: Actor,
  input: { matchKey: string; contributionIds: string[]; operator: { kind: "existing"; id: string } | { kind: "new"; name: string } },
): Promise<AcceptResult> {
  const lib: Actor = { id: admin.id, tenantId: LIBRARY_TENANT_ID };
  const rows = (await db.select().from(libraryContributions).where(and(eq(libraryContributions.matchKey, input.matchKey), eq(libraryContributions.status, "pending"))))
    .filter((r) => input.contributionIds.includes(r.id));
  if (!rows.length) throw new Error("Nothing to accept: these photos were already decided.");
  const first = rows[0];
  await loadStandardAircraftTypes(db, lib, `auto:${STANDARD_LIST_VERSION}`);

  // The contributor's aircraft: its type, operator (for region and base), details and base.
  const [src] = await db.select({ a: aircraft, t: aircraftTypes }).from(aircraft).innerJoin(aircraftTypes, eq(aircraftTypes.id, aircraft.aircraftTypeId)).where(eq(aircraft.id, first.sourceAircraftId));
  if (!src) throw new Error("The contributor's aircraft no longer exists.");
  const card = await getAircraftCard(db, first.sourceAircraftId);
  const [srcOrg] = await db.select({ o: organisations }).from(organisationAircraftRelationships)
    .innerJoin(organisations, eq(organisations.id, organisationAircraftRelationships.organisationId))
    .where(and(eq(organisationAircraftRelationships.aircraftId, first.sourceAircraftId), eq(organisationAircraftRelationships.role, "operator"), eq(organisationAircraftRelationships.active, true)));
  const srcBases = await db.select().from(aircraftBases).where(and(eq(aircraftBases.aircraftId, first.sourceAircraftId), eq(aircraftBases.active, true))).orderBy(asc(aircraftBases.displayOrder));

  // Library operator.
  let operatorId: string;
  if (input.operator.kind === "existing") operatorId = input.operator.id;
  else {
    const name = input.operator.name.trim() || first.operatorName || "Unknown operator";
    const found = (await resolveOrganisationsExact(db, LIBRARY_TENANT_ID, name))[0];
    operatorId = found ? found.id : (await createOrganisation(db, lib, randomUUID(), { name, region: srcOrg?.o.region ?? null, base: srcOrg?.o.base ?? null })).result.organisationId;
  }

  // Library type and aircraft.
  const typeName = `${src.t.manufacturer} ${src.t.model}`;
  const type = (await resolveAircraftTypesExact(db, LIBRARY_TENANT_ID, typeName))[0]
    ?? (await resolveAircraftTypesExact(db, LIBRARY_TENANT_ID, src.t.model))[0];
  const typeId = type ? type.id : (await createAircraftType(db, lib, randomUUID(), { manufacturer: src.t.manufacturer, model: src.t.model, category: src.t.category })).result.aircraftTypeId;
  let libraryAircraftId = await findLibraryAircraft(db, { tail: first.tail, operatorName: first.operatorName, aircraftType: typeName }, operatorId);
  if (!libraryAircraftId) {
    const base = srcBases.length === 0 ? undefined : srcBases[0].mode === "floating" ? { mode: "floating" as const, locations: [] } : { mode: "based" as const, locations: srcBases.map((b) => b.location).filter((l): l is string => !!l) };
    libraryAircraftId = (await createAircraft(db, lib, randomUUID(), {
      aircraftTypeId: typeId, registration: first.tail || null, operatorId, base,
      // Details only, never notes: they may be private to the contributor.
      info: card ? { yom: card.yom, yor: card.yor, capacity: card.capacity, wifiStatus: card.wifi, wifiDetail: card.wifiDetail, smoking: card.smoking, pets: card.pets, cleaningFee: card.cleaningFee } : undefined,
      tailResolution: "distinct_aircraft",
    })).result.aircraftId;
  }

  // The photos.
  const have = await libraryCounts(db, libraryAircraftId);
  const skipped: string[] = [];
  let accepted = 0;
  const decided = { decidedBy: admin.id, decidedAt: new Date(), libraryAircraftId };
  for (const r of rows) {
    const kind = r.classification as Classification;
    const [m] = await db.select().from(aircraftMedia).where(eq(aircraftMedia.id, r.sourceMediaId));
    if (!m || m.reviewState !== "approved" || m.lifecycleState !== "active" || m.rightsStatus === "restricted") {
      skipped.push(`${kind}: no longer approved in the contributor's workspace`);
      await db.update(libraryContributions).set({ ...decided, status: "superseded", note: "no longer approved by the contributor" }).where(eq(libraryContributions.id, r.id));
      continue;
    }
    if ((have[kind] ?? 0) >= (LIBRARY_NEEDS[kind] ?? 0)) {
      skipped.push(`${kind}: the library set is already full`);
      await db.update(libraryContributions).set({ ...decided, status: "superseded", note: "library set already full" }).where(eq(libraryContributions.id, r.id));
      continue;
    }
    const { bytes } = await readContentBytes(db, store, m.currentContentVersionId ?? r.sourceContentVersionId);
    const up = await ingestUpload(db, store, lib, { filename: `${typeName}${first.tail ? ` ${first.tail}` : ""} ${kind}.jpg`, bytes, batchLabel: "Platform library" });
    const mediaId = up.result.mediaId;
    const [cur] = await db.select().from(aircraftMedia).where(eq(aircraftMedia.id, mediaId));
    if (cur.reviewState !== "approved") {
      const version = async () => (await db.select({ v: aircraftMedia.version }).from(aircraftMedia).where(eq(aircraftMedia.id, mediaId)))[0].v;
      await updateMediaMetadata(db, lib, randomUUID(), { mediaId, expectedVersion: await version(), classification: kind, rightsStatus: m.rightsStatus === "permitted" ? "permitted" : "unknown" });
      await setMediaAssociation(db, lib, randomUUID(), { mediaId, expectedVersion: await version(), status: "actual_aircraft", aircraftId: libraryAircraftId });
      await approveMedia(db, lib, { mediaId, contentVersionId: up.result.contentVersionId, expectedVersion: await version() });
    }
    await db.update(libraryContributions).set({ ...decided, status: "accepted", libraryMediaId: mediaId }).where(eq(libraryContributions.id, r.id));
    have[kind] = (have[kind] ?? 0) + 1;
    accepted++;
  }

  // Kinds now full: other waiting photos for this aircraft are no longer needed.
  for (const kind of KINDS) {
    if ((have[kind] ?? 0) < (LIBRARY_NEEDS[kind] ?? 0)) continue;
    await db.update(libraryContributions).set({ status: "superseded", note: "library set filled", decidedAt: new Date() })
      .where(and(eq(libraryContributions.matchKey, input.matchKey), eq(libraryContributions.status, "pending"), eq(libraryContributions.classification, kind)));
  }
  // A full set makes the library's combined photo too.
  if (KINDS.every((k) => (have[k] ?? 0) >= (LIBRARY_NEEDS[k] ?? 0))) {
    try { await makeCombinedPhoto(db, store, lib, { kind: "aircraft", aircraftId: libraryAircraftId, aircraftTypeId: typeId }); }
    catch (e) { console.error("Library combined photo failed", e); }
  }
  return { accepted, skipped, libraryAircraftId };
}

/** Turns the chosen photos down. Their places open again for other users' photos. */
export async function rejectContributions(db: Db, admin: Actor, contributionIds: string[], note?: string) {
  if (!contributionIds.length) return 0;
  const done = await db.update(libraryContributions).set({ status: "rejected", decidedBy: admin.id, decidedAt: new Date(), note: note ?? null })
    .where(and(inArray(libraryContributions.id, contributionIds), eq(libraryContributions.status, "pending"))).returning({ id: libraryContributions.id });
  return done.length;
}

/** How many photos are waiting for review (for the menu and the Users page). */
export async function pendingCount(db: Db): Promise<number> {
  return (await db.select({ id: libraryContributions.id }).from(libraryContributions).where(eq(libraryContributions.status, "pending"))).length;
}

/** Library operators (for the "put it under" picker). */
export async function libraryOperators(db: Db) {
  return db.select({ id: organisations.id, name: organisations.canonicalName, region: organisations.region }).from(organisations)
    .where(and(eq(organisations.tenantId, LIBRARY_TENANT_ID), eq(organisations.active, true))).orderBy(asc(organisations.canonicalName));
}
