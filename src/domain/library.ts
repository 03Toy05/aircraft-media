import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  aircraft, aircraftBases, aircraftMedia, aircraftTypes, libraryContributions, libraryCopies, mediaAssociations, mediaContentVersions,
  organisationAircraftRelationships, organisations, users,
} from "../db/schema";
import type { Actor } from "./action";
import { normalizeKey, normalizeRegistration, type Classification } from "./constants";
import {
  addInformationVersion, createAircraft, createAircraftType, createOrganisation, findAircraftByTail, findAircraftWithoutTail, getAircraftCard,
  loadStandardAircraftTypes, resolveAircraftTypesExact, resolveOrganisationsExact,
} from "./directory";
import { approveMedia, getLineup, ingestUpload, readContentBytes, retireMedia, setMediaAssociation, updateMediaMetadata } from "./media";
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
    .where(and(inArray(libraryContributions.matchKey, keys), inArray(libraryContributions.status, ["pending", "accepted"]), eq(libraryContributions.kind, "new")));
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
    .select({ m: aircraftMedia, a: mediaAssociations, hash: mediaContentVersions.contentHash })
    .from(aircraftMedia)
    .innerJoin(mediaAssociations, and(eq(mediaAssociations.aircraftMediaId, aircraftMedia.id), eq(mediaAssociations.active, true)))
    .innerJoin(mediaContentVersions, eq(mediaContentVersions.id, aircraftMedia.currentContentVersionId))
    .where(and(
      eq(aircraftMedia.tenantId, tenantId), eq(aircraftMedia.reviewState, "approved"), eq(aircraftMedia.lifecycleState, "active"),
      eq(mediaAssociations.associationStatus, "actual_aircraft"), inArray(aircraftMedia.primaryClassification, KINDS),
    ))
    .orderBy(asc(aircraftMedia.displayOrder), asc(aircraftMedia.createdAt));
  // Photos that came from the library itself ("Add to my workspace") are never offered back.
  const fromLibrary = await libraryHashes(db, photos.map((p) => p.hash));
  const usable = photos.filter(({ m, a, hash }) => m.rightsStatus !== "restricted" && m.currentContentVersionId && a.aircraftId && !fromLibrary.has(hash));
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

  // Refurbished aircraft: when this workspace has a later refurbishment year than the library for the same tail,
  // its photos (not offered above) are offered as newer ones, for the admin to compare side by side.
  const left = await db.select({ id: libraryContributions.sourceMediaId }).from(libraryContributions)
    .where(inArray(libraryContributions.sourceMediaId, usable.map(({ m }) => m.id)));
  const nowOffered = new Set(left.map((r) => r.id));
  for (const [aircraftId, list] of byAircraft) {
    const card = cards.get(aircraftId);
    if (!card?.tail) continue;
    const libAc = (await findAircraftByTail(db, LIBRARY_TENANT_ID, card.tail))[0]?.aircraftId;
    if (!libAc) continue;
    const [mine, theirs] = [await getAircraftCard(db, aircraftId), await getAircraftCard(db, libAc)];
    if (!mine?.yor || (theirs?.yor != null && theirs.yor >= mine.yor)) continue;
    for (const kind of KINDS) {
      for (const { m } of list.filter((p) => p.m.primaryClassification === kind && !nowOffered.has(p.m.id)).slice(0, LIBRARY_NEEDS[kind] ?? 0)) {
        const inserted = await db.insert(libraryContributions).values({
          sourceTenantId: tenantId, contributorUserId: userId, sourceMediaId: m.id, sourceContentVersionId: m.currentContentVersionId!,
          sourceAircraftId: aircraftId, classification: kind, matchKey: card.key, operatorName: card.operator, aircraftType: card.aircraft, tail: card.tail,
          kind: "update", note: `Refurbished ${mine.yor} (library has ${theirs?.yor ?? "no year"})`,
        }).onConflictDoNothing().returning({ id: libraryContributions.id });
        if (inserted.length) n++;
      }
    }
  }
  return n;
}

/** Content hashes (of the given ones) that the library already holds. */
async function libraryHashes(db: Db, hashes: string[]): Promise<Set<string>> {
  if (!hashes.length) return new Set();
  const rows = await db.select({ h: mediaContentVersions.contentHash }).from(mediaContentVersions)
    .innerJoin(aircraftMedia, eq(aircraftMedia.id, mediaContentVersions.aircraftMediaId))
    .where(and(eq(aircraftMedia.tenantId, LIBRARY_TENANT_ID), inArray(mediaContentVersions.contentHash, [...new Set(hashes)])));
  return new Set(rows.map((r) => r.h));
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
  /** new: fills empty places | update: newer photos to replace library ones */
  kind: "new" | "update";
  matchKey: string;
  note: string | null;
  /** For updates: the library aircraft's current photos, to compare with. */
  current: { mediaId: string; contentVersionId: string; classification: string; label: string }[];
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
  const accepted = await db.select().from(libraryContributions).where(and(inArray(libraryContributions.matchKey, [...new Set(rows.map((r) => r.matchKey))]), eq(libraryContributions.status, "accepted"), eq(libraryContributions.kind, "new")));
  const groups = new Map<string, ReviewGroup>();
  for (const r of rows) {
    const gk = `${r.kind}|${r.matchKey}`;
    let g = groups.get(gk);
    if (!g) {
      const libAc = await findLibraryAircraft(db, r);
      const op = r.operatorName ? (await resolveOrganisationsExact(db, LIBRARY_TENANT_ID, r.operatorName))[0] : undefined;
      const have: Record<string, number> = {};
      for (const a of accepted.filter((x) => x.matchKey === r.matchKey)) have[a.classification] = (have[a.classification] ?? 0) + 1;
      const current = r.kind === "update" && libAc
        ? (await getLineup(db, { aircraftId: libAc, aircraftTypeId: (await db.select({ t: aircraft.aircraftTypeId }).from(aircraft).where(eq(aircraft.id, libAc)))[0].t }))
          .filter((l) => (KINDS as string[]).includes(l.classification))
          .map((l) => ({ mediaId: l.mediaId, contentVersionId: l.contentVersionId, classification: l.classification, label: l.label }))
        : [];
      g = {
        kind: r.kind === "update" ? "update" : "new", note: r.note, current,
        matchKey: r.matchKey, operatorName: r.operatorName, aircraftType: r.aircraftType, tail: r.tail,
        contributor: emails.get(r.contributorUserId) ?? "unknown", createdAt: r.createdAt,
        libraryAircraft: libAc ? { id: libAc, label: [r.operatorName, r.aircraftType, r.tail].filter(Boolean).join(" · ") } : null,
        libraryOperator: op ? { id: op.id, name: op.canonicalName } : null,
        have, photos: [],
      };
      groups.set(gk, g);
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
    .filter((r) => input.contributionIds.includes(r.id) && r.kind === "new");
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
      .where(and(eq(libraryContributions.matchKey, input.matchKey), eq(libraryContributions.status, "pending"), eq(libraryContributions.kind, "new"), eq(libraryContributions.classification, kind)));
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

// ---------------------------------------------------------------- who may use the library

/** The admin always; anyone else once the admin has shared the library with them. */
export async function hasLibraryAccess(db: Db, s: { isAdmin: boolean; actor: { id: string } }): Promise<boolean> {
  if (s.isAdmin) return true;
  const [u] = await db.select({ on: users.libraryAccess }).from(users).where(eq(users.id, s.actor.id));
  return !!u?.on;
}

export async function setLibraryAccess(db: Db, userId: string, on: boolean) {
  await db.update(users).set({ libraryAccess: on, updatedAt: new Date() }).where(eq(users.id, userId));
}

// ---------------------------------------------------------------- "Add to my workspace"

/** Copies the library aircraft's approved photos (and its combined photo) onto an aircraft in the user's workspace. */
async function copyPhotosInto(db: Db, store: FileStore, actor: Actor, libraryAircraftId: string, targetAircraftId: string, only?: Set<string>) {
  const [la] = await db.select({ t: aircraft.aircraftTypeId }).from(aircraft).where(eq(aircraft.id, libraryAircraftId));
  const lineup = (await getLineup(db, { aircraftId: libraryAircraftId, aircraftTypeId: la.t })).filter((l) => l.associationStatus === "actual_aircraft" && (!only || only.has(l.mediaId)));
  const pairs: { libraryMediaId: string; mediaId: string }[] = [];
  for (const l of lineup) {
    const { bytes } = await readContentBytes(db, store, l.contentVersionId);
    const up = (await ingestUpload(db, store, actor, { filename: `${l.label}.jpg`, bytes, batchLabel: "From the Aircraft Media library" })).result;
    const [cur] = await db.select().from(aircraftMedia).where(eq(aircraftMedia.id, up.mediaId));
    if (cur.reviewState !== "approved" || cur.lifecycleState !== "active") {
      const version = async () => (await db.select({ v: aircraftMedia.version }).from(aircraftMedia).where(eq(aircraftMedia.id, up.mediaId)))[0].v;
      await updateMediaMetadata(db, actor, randomUUID(), { mediaId: up.mediaId, expectedVersion: await version(), classification: l.classification });
      await setMediaAssociation(db, actor, randomUUID(), { mediaId: up.mediaId, expectedVersion: await version(), status: "actual_aircraft", aircraftId: targetAircraftId });
      await approveMedia(db, actor, { mediaId: up.mediaId, contentVersionId: up.contentVersionId, expectedVersion: await version() });
    }
    pairs.push({ libraryMediaId: l.mediaId, mediaId: up.mediaId });
  }
  return pairs;
}

export interface AddResult { aircraftId: string; photos: number; existed: boolean }

/**
 * Adds a library aircraft to the user's workspace: the operator (found by name, or created with its region and base),
 * the type, the aircraft with its details and base, and its photos. If the user already has that tail (or, without a
 * tail, that operator's aircraft of that type), only the photos are added and their details are left as they are.
 * The copy remembers where it came from, so newer library photos can be offered later.
 */
export async function addToWorkspace(db: Db, store: FileStore, actor: Actor, libraryAircraftId: string): Promise<AddResult> {
  if (actor.tenantId === LIBRARY_TENANT_ID) throw new Error("This is the library itself.");
  const [src] = await db.select({ a: aircraft, t: aircraftTypes }).from(aircraft).innerJoin(aircraftTypes, eq(aircraftTypes.id, aircraft.aircraftTypeId))
    .where(and(eq(aircraft.id, libraryAircraftId), eq(aircraft.tenantId, LIBRARY_TENANT_ID), eq(aircraft.active, true)));
  if (!src) throw new Error("That aircraft is no longer in the library.");
  const card = (await getAircraftCard(db, libraryAircraftId))!;
  const [org] = await db.select({ o: organisations }).from(organisationAircraftRelationships)
    .innerJoin(organisations, eq(organisations.id, organisationAircraftRelationships.organisationId))
    .where(and(eq(organisationAircraftRelationships.aircraftId, libraryAircraftId), eq(organisationAircraftRelationships.role, "operator"), eq(organisationAircraftRelationships.active, true)));
  const bases = await db.select().from(aircraftBases).where(and(eq(aircraftBases.aircraftId, libraryAircraftId), eq(aircraftBases.active, true))).orderBy(asc(aircraftBases.displayOrder));

  let operatorId: string | null = null;
  if (org) {
    operatorId = (await resolveOrganisationsExact(db, actor.tenantId, org.o.canonicalName))[0]?.id
      ?? (await createOrganisation(db, actor, randomUUID(), { name: org.o.canonicalName, region: org.o.region, base: org.o.base })).result.organisationId;
  }
  const typeName = `${src.t.manufacturer} ${src.t.model}`;
  const typeId = (await resolveAircraftTypesExact(db, actor.tenantId, typeName))[0]?.id
    ?? (await resolveAircraftTypesExact(db, actor.tenantId, src.t.model))[0]?.id
    ?? (await createAircraftType(db, actor, randomUUID(), { manufacturer: src.t.manufacturer, model: src.t.model, category: src.t.category })).result.aircraftTypeId;

  let aircraftId = card.tailNumber
    ? (await findAircraftByTail(db, actor.tenantId, card.tailNumber))[0]?.aircraftId
    : operatorId ? (await findAircraftWithoutTail(db, actor.tenantId, typeId, operatorId))[0] : undefined;
  const existed = !!aircraftId;
  if (!aircraftId) {
    const base = bases.length === 0 ? undefined : bases[0].mode === "floating" ? { mode: "floating" as const, locations: [] } : { mode: "based" as const, locations: bases.map((b) => b.location).filter((l): l is string => !!l) };
    aircraftId = (await createAircraft(db, actor, randomUUID(), {
      aircraftTypeId: typeId, registration: card.tailNumber, operatorId, base, tailResolution: "distinct_aircraft",
      info: { yom: card.yom, yor: card.yor, capacity: card.capacity, wifiStatus: card.wifi, wifiDetail: card.wifiDetail, smoking: card.smoking, pets: card.pets, cleaningFee: card.cleaningFee },
    })).result.aircraftId;
  }
  const pairs = await copyPhotosInto(db, store, actor, libraryAircraftId, aircraftId);
  await db.insert(libraryCopies).values({ tenantId: actor.tenantId, aircraftId, libraryAircraftId, copied: pairs })
    .onConflictDoUpdate({ target: [libraryCopies.tenantId, libraryCopies.aircraftId], set: { libraryAircraftId, copied: pairs, updatedAt: new Date() } });
  return { aircraftId, photos: pairs.length, existed };
}

/** Every aircraft of a library operator, added to the user's workspace. */
export async function addOperatorToWorkspace(db: Db, store: FileStore, actor: Actor, libraryOrganisationId: string): Promise<number> {
  const acs = await db.select({ id: organisationAircraftRelationships.aircraftId }).from(organisationAircraftRelationships)
    .innerJoin(aircraft, eq(aircraft.id, organisationAircraftRelationships.aircraftId))
    .where(and(eq(organisationAircraftRelationships.organisationId, libraryOrganisationId), eq(organisationAircraftRelationships.role, "operator"),
      eq(organisationAircraftRelationships.active, true), eq(aircraft.tenantId, LIBRARY_TENANT_ID), eq(aircraft.active, true)));
  for (const a of acs) await addToWorkspace(db, store, actor, a.id);
  return acs.length;
}

/** The library aircraft ids this workspace already holds a copy of. */
export async function copiedLibraryAircraft(db: Db, tenantId: string): Promise<Set<string>> {
  return new Set((await db.select({ id: libraryCopies.libraryAircraftId }).from(libraryCopies).where(eq(libraryCopies.tenantId, tenantId))).map((r) => r.id));
}

export interface CopyStatus { libraryAircraftId: string; addedAt: Date; newer: number }

/** For an aircraft added from the library: how many library photos are newer than the ones copied. */
export async function copyStatus(db: Db, tenantId: string, aircraftId: string): Promise<CopyStatus | null> {
  const [c] = await db.select().from(libraryCopies).where(and(eq(libraryCopies.tenantId, tenantId), eq(libraryCopies.aircraftId, aircraftId)));
  if (!c) return null;
  const [la] = await db.select({ t: aircraft.aircraftTypeId, active: aircraft.active }).from(aircraft).where(eq(aircraft.id, c.libraryAircraftId));
  if (!la?.active) return { libraryAircraftId: c.libraryAircraftId, addedAt: c.createdAt, newer: 0 };
  const have = new Set(c.copied.map((x) => x.libraryMediaId));
  const current = (await getLineup(db, { aircraftId: c.libraryAircraftId, aircraftTypeId: la.t })).filter((l) => l.associationStatus === "actual_aircraft");
  return { libraryAircraftId: c.libraryAircraftId, addedAt: c.createdAt, newer: current.filter((l) => !have.has(l.mediaId)).length };
}

/**
 * Brings a copy up to date with the library: photos the library has replaced are retired here too (only the ones that
 * were copied from the library; the user's own uploads are never touched), and the newer ones are copied in.
 */
export async function updateCopy(db: Db, store: FileStore, actor: Actor, aircraftId: string): Promise<{ added: number; retired: number }> {
  const [c] = await db.select().from(libraryCopies).where(and(eq(libraryCopies.tenantId, actor.tenantId), eq(libraryCopies.aircraftId, aircraftId)));
  if (!c) throw new Error("This aircraft was not added from the library.");
  const [la] = await db.select({ t: aircraft.aircraftTypeId }).from(aircraft).where(eq(aircraft.id, c.libraryAircraftId));
  const current = new Set((await getLineup(db, { aircraftId: c.libraryAircraftId, aircraftTypeId: la.t })).filter((l) => l.associationStatus === "actual_aircraft").map((l) => l.mediaId));
  let retired = 0;
  const kept = [];
  for (const pair of c.copied) {
    if (current.has(pair.libraryMediaId)) { kept.push(pair); continue; }
    const [m] = await db.select().from(aircraftMedia).where(and(eq(aircraftMedia.id, pair.mediaId), eq(aircraftMedia.tenantId, actor.tenantId)));
    if (m && m.lifecycleState === "active") { await retireMedia(db, actor, randomUUID(), { mediaId: m.id }); retired++; }
  }
  const have = new Set(kept.map((x) => x.libraryMediaId));
  const added = await copyPhotosInto(db, store, actor, c.libraryAircraftId, aircraftId, new Set([...current].filter((id) => !have.has(id))));
  await db.update(libraryCopies).set({ copied: [...kept, ...added], updatedAt: new Date() }).where(eq(libraryCopies.id, c.id));
  return { added: added.length, retired };
}

// ---------------------------------------------------------------- newer photos for the library

/** The library aircraft with the same tail as this workspace aircraft, if any (updates need a tail). */
export async function libraryTwin(db: Db, tenantId: string, aircraftId: string): Promise<string | null> {
  const card = await getAircraftCard(db, aircraftId);
  if (!card?.tailNumber || tenantId === LIBRARY_TENANT_ID) return null;
  return (await findAircraftByTail(db, LIBRARY_TENANT_ID, card.tailNumber))[0]?.aircraftId ?? null;
}

/**
 * The user offers some of their approved photos as newer ones for the library aircraft with the same tail.
 * An explicit offer, so it does not need the sharing setting. Photos already offered, restricted, or copied from
 * the library are passed over. Returns how many were offered.
 */
export async function offerUpdate(db: Db, actor: Actor, aircraftId: string, mediaIds: string[]): Promise<number> {
  const card = await getAircraftCard(db, aircraftId);
  if (!card?.tailNumber || !(await libraryTwin(db, actor.tenantId, aircraftId))) throw new Error("The library has no aircraft with this tail number.");
  const key = libraryMatchKey({ tail: card.tailNumber, operator: card.operator, aircraft: card.aircraft })!;
  const rows = await db.select({ m: aircraftMedia, a: mediaAssociations, hash: mediaContentVersions.contentHash }).from(aircraftMedia)
    .innerJoin(mediaAssociations, and(eq(mediaAssociations.aircraftMediaId, aircraftMedia.id), eq(mediaAssociations.active, true)))
    .innerJoin(mediaContentVersions, eq(mediaContentVersions.id, aircraftMedia.currentContentVersionId))
    .where(and(eq(aircraftMedia.tenantId, actor.tenantId), inArray(aircraftMedia.id, mediaIds.length ? mediaIds : ["00000000-0000-0000-0000-000000000000"]),
      eq(aircraftMedia.reviewState, "approved"), eq(aircraftMedia.lifecycleState, "active"), eq(mediaAssociations.aircraftId, aircraftId)));
  const fromLibrary = await libraryHashes(db, rows.map((r) => r.hash));
  let n = 0;
  for (const { m, hash } of rows) {
    if (m.rightsStatus === "restricted" || fromLibrary.has(hash) || !(KINDS as string[]).includes(m.primaryClassification)) continue;
    const inserted = await db.insert(libraryContributions).values({
      sourceTenantId: actor.tenantId, contributorUserId: actor.id, sourceMediaId: m.id, sourceContentVersionId: m.currentContentVersionId!,
      sourceAircraftId: aircraftId, classification: m.primaryClassification, matchKey: key, operatorName: card.operator, aircraftType: card.aircraft, tail: card.tailNumber,
      kind: "update", note: "Offered as newer photos",
    }).onConflictDoNothing().returning({ id: libraryContributions.id });
    if (inserted.length) n++;
  }
  return n;
}

/** This workspace's photos that can be offered as newer ones (approved, own uploads, the three kinds), and which already were. */
export async function offerablePhotos(db: Db, tenantId: string, aircraftId: string) {
  const rows = await db.select({ m: aircraftMedia, hash: mediaContentVersions.contentHash, cv: mediaContentVersions.id }).from(aircraftMedia)
    .innerJoin(mediaAssociations, and(eq(mediaAssociations.aircraftMediaId, aircraftMedia.id), eq(mediaAssociations.active, true)))
    .innerJoin(mediaContentVersions, eq(mediaContentVersions.id, aircraftMedia.currentContentVersionId))
    .where(and(eq(aircraftMedia.tenantId, tenantId), eq(mediaAssociations.aircraftId, aircraftId), eq(mediaAssociations.associationStatus, "actual_aircraft"),
      eq(aircraftMedia.reviewState, "approved"), eq(aircraftMedia.lifecycleState, "active"), inArray(aircraftMedia.primaryClassification, KINDS)))
    .orderBy(asc(aircraftMedia.primaryClassification), asc(aircraftMedia.displayOrder));
  const fromLibrary = await libraryHashes(db, rows.map((r) => r.hash));
  const offered = rows.length ? new Set((await db.select({ id: libraryContributions.sourceMediaId }).from(libraryContributions)
    .where(inArray(libraryContributions.sourceMediaId, rows.map((r) => r.m.id)))).map((r) => r.id)) : new Set<string>();
  return rows.filter((r) => r.m.rightsStatus !== "restricted" && !fromLibrary.has(r.hash))
    .map((r) => ({ mediaId: r.m.id, contentVersionId: r.cv, classification: r.m.primaryClassification as string, offered: offered.has(r.m.id) }));
}

/**
 * Accepts newer photos: each chosen one replaces the library photo the admin picked (which is retired, so it stays in
 * the history), or is added when the kind still has room. The library's refurbishment year follows the contributor's
 * when it is later, and the combined photo is made again from the new set.
 */
export async function acceptUpdates(
  db: Db, store: FileStore, admin: Actor,
  input: { matchKey: string; choices: { contributionId: string; replace: string | "add" | "skip" }[] },
): Promise<{ replaced: number; added: number }> {
  const lib: Actor = { id: admin.id, tenantId: LIBRARY_TENANT_ID };
  const rows = await db.select().from(libraryContributions).where(and(eq(libraryContributions.matchKey, input.matchKey), eq(libraryContributions.status, "pending"), eq(libraryContributions.kind, "update")));
  const first = rows[0];
  if (!first?.tail) throw new Error("Nothing to accept: these photos were already decided.");
  const libAc = (await findAircraftByTail(db, LIBRARY_TENANT_ID, first.tail))[0]?.aircraftId;
  if (!libAc) throw new Error("The library no longer has this aircraft.");
  const [la] = await db.select({ t: aircraft.aircraftTypeId }).from(aircraft).where(eq(aircraft.id, libAc));
  const lineup = await getLineup(db, { aircraftId: libAc, aircraftTypeId: la.t });
  const have = await libraryCounts(db, libAc);
  const decided = { decidedBy: admin.id, decidedAt: new Date(), libraryAircraftId: libAc };
  let replaced = 0, added = 0;
  const usedTargets = new Set<string>();
  for (const choice of input.choices) {
    const r = rows.find((x) => x.id === choice.contributionId);
    if (!r) continue;
    if (choice.replace === "skip") {
      await db.update(libraryContributions).set({ ...decided, status: "rejected", note: "not used" }).where(eq(libraryContributions.id, r.id));
      continue;
    }
    const kind = r.classification as Classification;
    const target = choice.replace === "add" ? null : lineup.find((l) => l.mediaId === choice.replace && !usedTargets.has(l.mediaId));
    if (choice.replace !== "add" && !target) continue;
    if (!target && (have[kind] ?? 0) >= (LIBRARY_NEEDS[kind] ?? 0)) {
      await db.update(libraryContributions).set({ ...decided, status: "superseded", note: "no room to add; choose a photo to replace" }).where(eq(libraryContributions.id, r.id));
      continue;
    }
    const [m] = await db.select().from(aircraftMedia).where(eq(aircraftMedia.id, r.sourceMediaId));
    if (!m || m.reviewState !== "approved" || m.lifecycleState !== "active" || m.rightsStatus === "restricted") {
      await db.update(libraryContributions).set({ ...decided, status: "superseded", note: "no longer approved by the contributor" }).where(eq(libraryContributions.id, r.id));
      continue;
    }
    const { bytes } = await readContentBytes(db, store, m.currentContentVersionId ?? r.sourceContentVersionId);
    const up = (await ingestUpload(db, store, lib, { filename: `${r.aircraftType} ${r.tail} ${kind} (newer).jpg`, bytes, batchLabel: "Platform library (newer photos)" })).result;
    const [cur] = await db.select().from(aircraftMedia).where(eq(aircraftMedia.id, up.mediaId));
    if (cur.reviewState !== "approved") {
      const version = async () => (await db.select({ v: aircraftMedia.version }).from(aircraftMedia).where(eq(aircraftMedia.id, up.mediaId)))[0].v;
      const order = target ? (await db.select({ o: aircraftMedia.displayOrder }).from(aircraftMedia).where(eq(aircraftMedia.id, target.mediaId)))[0]?.o : undefined;
      await updateMediaMetadata(db, lib, randomUUID(), { mediaId: up.mediaId, expectedVersion: await version(), classification: kind, ...(order != null ? { displayOrder: order } : {}) });
      await setMediaAssociation(db, lib, randomUUID(), { mediaId: up.mediaId, expectedVersion: await version(), status: "actual_aircraft", aircraftId: libAc });
      await approveMedia(db, lib, { mediaId: up.mediaId, contentVersionId: up.contentVersionId, expectedVersion: await version() });
    }
    if (target) {
      await retireMedia(db, lib, randomUUID(), { mediaId: target.mediaId });
      usedTargets.add(target.mediaId);
      replaced++;
    } else { have[kind] = (have[kind] ?? 0) + 1; added++; }
    await db.update(libraryContributions).set({ ...decided, status: "accepted", libraryMediaId: up.mediaId, replacesMediaId: target?.mediaId ?? null }).where(eq(libraryContributions.id, r.id));
  }

  // A later refurbishment year comes along with the newer photos.
  const [mine, theirs] = [await getAircraftCard(db, first.sourceAircraftId), await getAircraftCard(db, libAc)];
  if (theirs && mine?.yor && (theirs.yor == null || mine.yor > theirs.yor) && replaced + added > 0) {
    await addInformationVersion(db, lib, randomUUID(), {
      aircraftId: libAc, expectedVersion: theirs.informationVersion,
      info: { yom: theirs.yom, yor: mine.yor, capacity: theirs.capacity, wifiStatus: theirs.wifi, wifiDetail: theirs.wifiDetail, smoking: theirs.smoking, pets: theirs.pets, cleaningFee: theirs.cleaningFee },
    });
  }
  if (replaced + added > 0) {
    try { await makeCombinedPhoto(db, store, lib, { kind: "aircraft", aircraftId: libAc, aircraftTypeId: la.t }, { replace: true }); }
    catch (e) { console.error("Library combined photo failed", e); }
  }
  return { replaced, added };
}
