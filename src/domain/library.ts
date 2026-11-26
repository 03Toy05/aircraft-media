import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  aircraft, aircraftBases, aircraftMedia, aircraftTypes, libraryContributions, libraryCopies, mediaAssociations, mediaContentVersions,
  organisationAircraftRelationships, organisations, users,
} from "../db/schema";
import type { Actor } from "./action";
import { normalizeKey, normalizeRegistration, type Classification } from "./constants";
import {
  addInformationVersion, changeRegistration, cleanContacts, createAircraft, createAircraftType, createOrganisation, findAircraftByTail, findAircraftWithoutTail, getAircraftCard,
  loadStandardAircraftTypes, resolveAircraftTypesExact, resolveOrganisationsExact,
} from "./directory";
import { approveMedia, getLineup, ingestUpload, readContentBytes, retireMedia, setMediaAssociation, updateMediaMetadata } from "./media";
import { makeCombinedPhoto } from "./combinedPhoto";
import { STANDARD_LIST_VERSION } from "./standardTypes";
import { RememberingStore, type FileStore } from "../storage";
import { sha256 } from "../lib/hash";

/**
 * The platform library: one shared set of photos per aircraft, filled from users' approved photos.
 *  - It is a workspace of its own (LIBRARY_TENANT_ID), so every page and rule that works on a workspace works on it.
 *  - A user's photos are only offered once they turn on "Share my approved photos with the library".
 *  - Each library aircraft keeps 1 exterior, 2 cabin and 1 floor plan; the first complete set wins.
 *  - Nothing enters the library until the admin accepts it. Only the aircraft details and the photos are copied:
 *    never prices, quotes, contacts or notes. Photos marked "restricted" are never offered. (A library aircraft's notes
 *    therefore only come from the admin's own packs, so they are shown to brokers and copied with the aircraft.)
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
    try { await makeCombinedPhoto(db, store, lib, { kind: "aircraft", aircraftId: libraryAircraftId, aircraftTypeId: typeId }, { replace: true }); }
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

/**
 * What of the library someone may see. Null: the library is not shared with them at all. The admin always sees
 * everything; anyone else sees only library aircraft that already have an approved photo (the rest are still being
 * put together by the admin), of every operator or only the ones the admin picked for them, and only operators
 * with at least one such aircraft.
 */
export type LibraryScope = { all: true } | { all: false; operators: Set<string>; aircraft: Set<string> };

export async function libraryScope(db: Db, s: { isAdmin: boolean; actor: { id: string } }): Promise<LibraryScope | null> {
  if (s.isAdmin) return { all: true };
  const [u] = await db.select({ on: users.libraryAccess, ops: users.libraryOperators }).from(users).where(eq(users.id, s.actor.id));
  if (!u?.on) return null;
  const chosen = u.ops == null ? null : new Set(u.ops);
  const ready = await readyLibraryAircraft(db);
  const links = await db.select({ aircraftId: organisationAircraftRelationships.aircraftId, operatorId: organisationAircraftRelationships.organisationId })
    .from(organisationAircraftRelationships).innerJoin(aircraft, eq(aircraft.id, organisationAircraftRelationships.aircraftId))
    .where(and(eq(organisationAircraftRelationships.role, "operator"), eq(organisationAircraftRelationships.active, true), eq(aircraft.tenantId, LIBRARY_TENANT_ID)));
  const operatorOf = new Map(links.map((l) => [l.aircraftId, l.operatorId]));
  const acs = [...ready].filter((id) => !chosen || chosen.has(operatorOf.get(id) ?? "-"));
  const operators = new Set(acs.map((id) => operatorOf.get(id)).filter((o): o is string => !!o));
  return { all: false, operators, aircraft: new Set(acs) };
}

/** Library aircraft with at least one approved, active photo: the ones ready to show to brokers. */
export async function readyLibraryAircraft(db: Db): Promise<Set<string>> {
  const rows = await db.selectDistinct({ id: mediaAssociations.aircraftId }).from(aircraftMedia)
    .innerJoin(mediaAssociations, and(eq(mediaAssociations.aircraftMediaId, aircraftMedia.id), eq(mediaAssociations.active, true)))
    .innerJoin(aircraft, and(eq(aircraft.id, mediaAssociations.aircraftId), eq(aircraft.active, true)))
    .where(and(eq(aircraftMedia.tenantId, LIBRARY_TENANT_ID), eq(aircraft.tenantId, LIBRARY_TENANT_ID), eq(aircraftMedia.reviewState, "approved"), eq(aircraftMedia.lifecycleState, "active")));
  return new Set(rows.map((r) => r.id).filter((id): id is string => !!id));
}

/** Whether this library operator is open to them. */
export function scopeHasOperator(scope: LibraryScope | null, operatorId: string | null): boolean {
  return !!scope && (scope.all || (!!operatorId && scope.operators.has(operatorId)));
}

/** Whether this library aircraft is open to them. */
export function scopeHasAircraft(scope: LibraryScope | null, aircraftId: string): boolean {
  return !!scope && (scope.all || scope.aircraft.has(aircraftId));
}

/** Leaves out library aircraft they may not see (their own workspace's aircraft are kept). */
export async function withinLibraryScope(db: Db, scope: LibraryScope | null, ids: string[]): Promise<string[]> {
  if (scope?.all || !ids.length) return ids;
  const lib = new Set((await db.select({ id: aircraft.id }).from(aircraft).where(and(inArray(aircraft.id, ids), eq(aircraft.tenantId, LIBRARY_TENANT_ID)))).map((r) => r.id));
  return ids.filter((id) => !lib.has(id) || scopeHasAircraft(scope, id));
}

/** The admin picks which library operators someone may see: null = all of them. */
export async function setLibraryOperators(db: Db, userId: string, operatorIds: string[] | null) {
  await db.update(users).set({ libraryOperators: operatorIds, updatedAt: new Date() }).where(eq(users.id, userId));
}

// ---------------------------------------------------------------- "Add to my workspace"

/** Whether a photo is attached to this aircraft now. */
async function isOn(db: Db, mediaId: string, aircraftId: string): Promise<boolean> {
  const [a] = await db.select({ id: mediaAssociations.id }).from(mediaAssociations)
    .where(and(eq(mediaAssociations.aircraftMediaId, mediaId), eq(mediaAssociations.aircraftId, aircraftId), eq(mediaAssociations.active, true)));
  return !!a;
}

/** Copies the library aircraft's approved photos (and its combined photo) onto an aircraft in the user's workspace. */
async function copyPhotosInto(db: Db, store: FileStore, actor: Actor, libraryAircraftId: string, targetAircraftId: string, only?: Set<string>) {
  const [la] = await db.select({ t: aircraft.aircraftTypeId }).from(aircraft).where(eq(aircraft.id, libraryAircraftId));
  const lineup = (await getLineup(db, { aircraftId: libraryAircraftId, aircraftTypeId: la.t })).filter((l) => l.associationStatus === "actual_aircraft" && (!only || only.has(l.mediaId)));
  const pairs: { libraryMediaId: string; mediaId: string }[] = [];
  for (const l of lineup) {
    const { bytes } = await readContentBytes(db, store, l.contentVersionId);
    let up = (await ingestUpload(db, store, actor, { filename: `${l.label}.jpg`, bytes, batchLabel: "From the Aircraft Media library" })).result;
    let [cur] = await db.select().from(aircraftMedia).where(eq(aircraftMedia.id, up.mediaId));
    // The workspace already has this exact photo, but retired or on another aircraft (e.g. it was wrongly put on a
    // sister aircraft and taken off again): a photo belongs to one aircraft, so this one gets its own copy.
    if (cur.lifecycleState !== "active" || (cur.reviewState === "approved" && !(await isOn(db, cur.id, targetAircraftId)))) {
      const copy = new Uint8Array(await sharp(bytes).jpeg({ quality: 92 }).toBuffer());
      up = (await ingestUpload(db, store, actor, { filename: `${l.label}.jpg`, bytes: copy, batchLabel: "From the Aircraft Media library" })).result;
      [cur] = await db.select().from(aircraftMedia).where(eq(aircraftMedia.id, up.mediaId));
    }
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
    await copyMissingContacts(db, org.o, operatorId);
  }
  const typeName = `${src.t.manufacturer} ${src.t.model}`;
  const typeId = (await resolveAircraftTypesExact(db, actor.tenantId, typeName))[0]?.id
    ?? (await resolveAircraftTypesExact(db, actor.tenantId, src.t.model))[0]?.id
    ?? (await createAircraftType(db, actor, randomUUID(), { manufacturer: src.t.manufacturer, model: src.t.model, category: src.t.category })).result.aircraftTypeId;

  let aircraftId: string | undefined;
  if (card.tailNumber && !isMaskedTail(card.tailNumber)) aircraftId = (await findAircraftByTail(db, actor.tenantId, card.tailNumber))[0]?.aircraftId;
  else {
    // A hidden tail (two TAG G650ERs are both "VP-CXX") or none: the same aircraft is the one with the same base and YOM.
    const candidates = card.tailNumber
      ? (await findAircraftByTail(db, actor.tenantId, card.tailNumber)).map((x) => x.aircraftId)
      : operatorId ? await findAircraftWithoutTail(db, actor.tenantId, typeId, operatorId) : [];
    aircraftId = await sameAircraft(db, libraryAircraftId, candidates);
  }
  const existed = !!aircraftId;
  if (!aircraftId) {
    const base = bases.length === 0 ? undefined : bases[0].mode === "floating" ? { mode: "floating" as const, locations: [] } : { mode: "based" as const, locations: bases.map((b) => b.location).filter((l): l is string => !!l) };
    aircraftId = (await createAircraft(db, actor, randomUUID(), {
      aircraftTypeId: typeId, registration: card.tailNumber, operatorId, base, tailResolution: "distinct_aircraft",
      // Notes too: a library aircraft's notes are the admin's (from a pack), e.g. "Owner's approval required".
      info: { yom: card.yom, yor: card.yor, capacity: card.capacity, wifiStatus: card.wifi, wifiDetail: card.wifiDetail, smoking: card.smoking, pets: card.pets, cleaningFee: card.cleaningFee, notes: card.notes },
    })).result.aircraftId;
  }
  const pairs = await copyPhotosInto(db, store, actor, libraryAircraftId, aircraftId);
  await db.insert(libraryCopies).values({ tenantId: actor.tenantId, aircraftId, libraryAircraftId, copied: pairs })
    .onConflictDoUpdate({ target: [libraryCopies.tenantId, libraryCopies.aircraftId], set: { libraryAircraftId, copied: pairs, updatedAt: new Date() } });
  return { aircraftId, photos: pairs.length, existed };
}

/** The library aircraft of one library operator. */
export async function libraryOperatorAircraft(db: Db, libraryOrganisationId: string): Promise<string[]> {
  const acs = await db.select({ id: organisationAircraftRelationships.aircraftId }).from(organisationAircraftRelationships)
    .innerJoin(aircraft, eq(aircraft.id, organisationAircraftRelationships.aircraftId))
    .where(and(eq(organisationAircraftRelationships.organisationId, libraryOrganisationId), eq(organisationAircraftRelationships.role, "operator"),
      eq(organisationAircraftRelationships.active, true), eq(aircraft.tenantId, LIBRARY_TENANT_ID), eq(aircraft.active, true)));
  return acs.map((a) => a.id);
}

/** Every aircraft of a library operator, added to the user's workspace. */
export async function addOperatorToWorkspace(db: Db, store: FileStore, actor: Actor, libraryOrganisationId: string): Promise<number> {
  const ids = await libraryOperatorAircraft(db, libraryOrganisationId);
  for (const id of ids) await addToWorkspace(db, store, actor, id);
  return ids.length;
}

/*
 * Adding from the library copies every photo through the file store (Google Drive), which takes a while, so it runs
 * after the page has answered. Per workspace, adds run one after another (so two adds never both create the same
 * operator), and an aircraft already being added is not queued twice. This server runs as one process, so the
 * bookkeeping lives in memory: after a restart, "In your workspace" on the Library page is the source of truth.
 */
const adding = new Map<string, Set<string>>();
const queues = new Map<string, Promise<void>>();

/** Library aircraft being added to this workspace right now. */
export function addingNow(tenantId: string): Set<string> {
  return new Set(adding.get(tenantId) ?? []);
}

/**
 * Queues library aircraft to be added to a workspace; returns the ones newly queued and a promise that settles once
 * they are all in. Aircraft already queued are left out; one failing does not stop the rest.
 */
export function queueAdds(db: Db, store: FileStore, actor: Actor, libraryAircraftIds: string[]): { queued: string[]; done: Promise<void> } {
  const set = adding.get(actor.tenantId) ?? new Set<string>();
  adding.set(actor.tenantId, set);
  const queued = libraryAircraftIds.filter((id) => !set.has(id));
  for (const id of queued) set.add(id);
  const prev = queues.get(actor.tenantId) ?? Promise.resolve();
  const done = prev.then(async () => {
    for (const id of queued) {
      try { await addToWorkspace(db, store, actor, id); }
      catch (e) { console.error("Adding from the library failed", id, e); }
      finally { set.delete(id); }
    }
  });
  queues.set(actor.tenantId, done);
  return { queued, done };
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
  const found = (await findAircraftByTail(db, LIBRARY_TENANT_ID, card.tailNumber)).map((x) => x.aircraftId);
  if (!isMaskedTail(card.tailNumber)) return found[0] ?? null;
  return (await sameAircraft(db, aircraftId, found)) ?? null;
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

/* ------------------------------------------------------------------------------------------------------------- */
/* Library import: the admin loads an operator's fleet straight into the library (e.g. from an operator brochure) */
/* ------------------------------------------------------------------------------------------------------------- */

export interface PackAircraft {
  type: string; // e.g. "Gulfstream G650ER"
  tail?: string | null; // leave out when the brochure hides it (e.g. "VP-CXX")
  base?: string[];
  /** No fixed base (e.g. AirX's jets): shown as "Floating". */
  floating?: boolean;
  /** Notes every broker should see ("Owner's approval required"). Library notes come only from these packs. */
  notes?: string | null;
  yom?: number | null;
  yor?: number | null;
  capacity?: number | null;
  wifi?: "yes" | "no" | "tbc" | "unknown";
  wifiDetail?: string | null;
  smoking?: "yes" | "no" | "unknown";
  pets?: "yes" | "no" | "unknown";
  photos: Partial<Record<"exterior" | "cabin" | "floor_plan", string[]>>; // file names in the pack
  /** The tail is real even though it looks hidden (Mexico's XA-UXX): matched by tail, never renamed. */
  realTail?: boolean;
  /** Kinds whose current library photos these replace: those are retired (kept in history) before these go in. */
  replace?: ("exterior" | "cabin" | "floor_plan")[];
}
export interface LibraryPack {
  operator: string; region?: string | null; base?: string | null;
  /** How to reach the operator, shown with it in the library (and copied with it into workspaces). */
  website?: string | null; email?: string | null; salesContact?: string | null;
  aircraft: PackAircraft[];
}

/** Gives a workspace's operator the library operator's contact details, field by field, where it has none of its own. */
async function copyMissingContacts(db: Db, from: { website: string | null; email: string | null; salesContact: string | null }, toId: string) {
  const [to] = await db.select().from(organisations).where(eq(organisations.id, toId));
  if (!to) return;
  const set = {
    ...(!to.website && from.website ? { website: from.website } : {}),
    ...(!to.email && from.email ? { email: from.email } : {}),
    ...(!to.salesContact && from.salesContact ? { salesContact: from.salesContact } : {}),
  };
  if (Object.keys(set).length) await db.update(organisations).set({ ...set, updatedAt: new Date() }).where(eq(organisations.id, toId));
}
export interface PackResult { created: number; matched: number; photos: number; skipped: string[]; retailed: string[] }

/**
 * A tail a brochure has partly hidden ("T7-GXXX", "VP-CXX*"). It is kept as the tail until the real one is known,
 * but two aircraft can share it (TAG lists two G650ERs as VP-CXX), so these are told apart by base as well.
 */
export function isMaskedTail(tail: string | null | undefined): boolean {
  return !!tail && /X{2,}|\*/i.test(tail.replace(/^[A-Z0-9]{1,2}-/i, ""));
}

const basesOf = async (db: Db, aircraftId: string) =>
  (await db.select().from(aircraftBases).where(and(eq(aircraftBases.aircraftId, aircraftId), eq(aircraftBases.active, true)))).map((b) => b.location ?? "");

/**
 * Of several aircraft that could be the same one (same hidden tail, or no tail), the one with the same base and the
 * same YOM as `aircraftId`. A YOM that one side does not know does not rule it out; a different one does.
 */
async function sameAircraft(db: Db, aircraftId: string, candidates: string[]): Promise<string | undefined> {
  if (!candidates.length) return undefined;
  const me = await getAircraftCard(db, aircraftId);
  const myBases = await basesOf(db, aircraftId);
  for (const id of candidates) {
    const c = await getAircraftCard(db, id);
    if (me?.yom != null && c?.yom != null && me.yom !== c.yom) continue;
    if (!sameBases(await basesOf(db, id), myBases)) continue;
    return id;
  }
  return undefined;
}

const sameBases = (a: string[], b: string[]) => a.map(normalizeKey).sort().join("|") === b.map(normalizeKey).sort().join("|");

/**
 * Loads a pack into the library: the operator (found by name, or made with its region and base), each aircraft
 * (found by tail; by tail and base when the tail is hidden like "VP-CXX"; without a tail, by operator, type and base,
 * so several of one type stay apart), its details and
 * its photos, approved straight away. The 1 EXT / 2 CABIN / 1 FLOOR PLAN set still holds: a library aircraft that
 * already has its photos keeps them, and the extra ones are listed as passed over.
 */
export interface PackProgress { done: number; total: number; current: string }
export interface PackOptions {
  /** How many aircraft are worked on at once (aircraft of one type always go one after another). */
  concurrency?: number;
  onProgress?: (p: PackProgress) => void;
}

export async function importLibraryPack(
  db: Db, store: FileStore, admin: Actor, pack: LibraryPack, files: Map<string, Uint8Array>, opts: PackOptions = {},
): Promise<PackResult> {
  const lib: Actor = { id: admin.id, tenantId: LIBRARY_TENANT_ID };
  const operatorName = pack.operator?.trim();
  if (!operatorName) throw new Error("The pack needs an operator name.");
  if (!Array.isArray(pack.aircraft) || !pack.aircraft.length) throw new Error("The pack lists no aircraft.");
  await loadStandardAircraftTypes(db, lib, `auto:${STANDARD_LIST_VERSION}`);
  const operatorId = (await resolveOrganisationsExact(db, LIBRARY_TENANT_ID, operatorName))[0]?.id
    ?? (await createOrganisation(db, lib, randomUUID(), { name: operatorName, region: pack.region ?? null, base: pack.base ?? null })).result.organisationId;
  // Contact details in the pack replace the library's (a field the pack leaves out is kept).
  if (pack.website != null || pack.email != null || pack.salesContact != null) {
    const [cur] = await db.select().from(organisations).where(eq(organisations.id, operatorId));
    const c = cleanContacts({ website: pack.website ?? cur.website, email: pack.email ?? cur.email, salesContact: pack.salesContact ?? cur.salesContact });
    await db.update(organisations).set({ ...c, updatedAt: new Date() }).where(eq(organisations.id, operatorId));
  }

  const realTails = new Set(pack.aircraft.filter((x) => x.realTail && x.tail).map((x) => x.tail!.trim().toUpperCase()));
  const hidden = (t: string | null | undefined) => isMaskedTail(t) && !realTails.has((t ?? "").trim().toUpperCase());

  // The same photo bytes can serve several aircraft (one seating plan for a fleet): one at a time, so each aircraft
  // sees the earlier one's approved photo and makes its own copy.
  const locks = new Map<string, Promise<unknown>>();
  const oneAtATime = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
    locks.set(key, run.catch(() => undefined));
    return run;
  };

  const importOne = async (a: PackAircraft, type: { id: string } | undefined, out: PackResult, store: FileStore) => {
    const label = `${a.type}${a.base?.length ? ` (${a.base.join(" / ")})` : ""}`;
    const tail = a.tail?.replace(/\*+$/, "").trim().toUpperCase() || null;
    if (!type) { out.skipped.push(`${label}: unknown aircraft type "${a.type}"`); return; }
    const bases = (a.base ?? []).map((b) => b.trim()).filter(Boolean);

    let aircraftId: string | null = null;
    if (tail && !hidden(tail)) {
      aircraftId = (await findAircraftByTail(db, LIBRARY_TENANT_ID, tail))[0]?.aircraftId ?? null;
      // The real tail of an aircraft the library only knew by a hidden one ("VP-CXX" turns out to be VP-CTL): the
      // same operator's aircraft of this type, base and YOM gets the real tail (the old one is kept in its history).
      if (!aircraftId) {
        for (const id of await findAircraftWithoutTail(db, LIBRARY_TENANT_ID, type.id, operatorId, { includeHiddenTails: true })) {
          const c = await getAircraftCard(db, id);
          if (!c?.tailNumber || !hidden(c.tailNumber)) continue;
          if (a.yom != null && c.yom != null && a.yom !== c.yom) continue;
          if (!sameBases(await basesOf(db, id), bases)) continue;
          await changeRegistration(db, lib, randomUUID(), { aircraftId: id, newRegistration: tail });
          out.retailed.push(`${label}: ${c.tailNumber} is now ${tail}`);
          aircraftId = id;
          break;
        }
      }
    } else {
      const candidates = tail ? (await findAircraftByTail(db, LIBRARY_TENANT_ID, tail)).map((x) => x.aircraftId) : await findAircraftWithoutTail(db, LIBRARY_TENANT_ID, type.id, operatorId);
      // Same base, and no clash in YOM or seats: an operator's two G650ERs without tails (13 and 14 seats) stay apart.
      for (const id of candidates) {
        if (!sameBases(await basesOf(db, id), bases)) continue;
        const c = await getAircraftCard(db, id);
        if (a.yom != null && c?.yom != null && a.yom !== c.yom) continue;
        if (a.capacity != null && c?.capacity != null && a.capacity !== c.capacity) continue;
        aircraftId = id;
        break;
      }
    }
    const info = { yom: a.yom ?? null, yor: a.yor ?? null, capacity: a.capacity ?? null, wifiStatus: a.wifi ?? "unknown", wifiDetail: a.wifiDetail ?? null, smoking: a.smoking ?? "unknown", pets: a.pets ?? "unknown", notes: a.notes ?? null } as const;
    if (aircraftId) {
      out.matched++;
      // Already in the library: the pack's details win where it gives them (e.g. WIFI corrected to No); the rest stay.
      const card = await getAircraftCard(db, aircraftId);
      if (card) {
        const next = {
          yom: a.yom !== undefined ? a.yom : card.yom, yor: a.yor !== undefined ? a.yor : card.yor, capacity: a.capacity !== undefined ? a.capacity : card.capacity,
          wifiStatus: a.wifi ?? card.wifi, wifiDetail: a.wifiDetail !== undefined ? a.wifiDetail : card.wifiDetail,
          smoking: a.smoking ?? card.smoking, pets: a.pets ?? card.pets, cleaningFee: card.cleaningFee, notes: a.notes !== undefined ? a.notes : card.notes,
        };
        const fields: [string, unknown, unknown][] = [
          ["YOM", next.yom, card.yom], ["YOR", next.yor, card.yor], ["seats", next.capacity, card.capacity], ["WIFI", next.wifiStatus, card.wifi],
          ["WIFI details", next.wifiDetail, card.wifiDetail], ["smoking", next.smoking, card.smoking], ["pets", next.pets, card.pets], ["notes", next.notes, card.notes],
        ];
        const changed = fields.filter(([, x, y]) => (x ?? null) !== (y ?? null)).map(([name]) => name);
        if (changed.length) {
          await addInformationVersion(db, lib, randomUUID(), { aircraftId, expectedVersion: card.informationVersion, info: next });
          out.retailed.push(`${label}${tail ? ` ${tail}` : ""}: ${changed.join(", ")} updated`);
        }
      }
    } else {
      aircraftId = (await createAircraft(db, lib, randomUUID(), {
        aircraftTypeId: type.id, registration: tail, operatorId, info,
        base: a.floating ? { mode: "floating", locations: [] } : bases.length ? { mode: "based", locations: bases } : undefined,
        tailResolution: "distinct_aircraft",
      })).result.aircraftId;
      out.created++;
    }
    const acId = aircraftId;

    let replaced = 0;
    if (a.replace?.length) {
      const [t2] = await db.select({ t: aircraft.aircraftTypeId }).from(aircraft).where(eq(aircraft.id, acId));
      for (const p of await getLineup(db, { aircraftId: acId, aircraftTypeId: t2.t })) {
        if (p.associationStatus !== "actual_aircraft") continue;
        if (!(a.replace as string[]).includes(p.classification) && p.classification !== "combined") continue;
        await retireMedia(db, lib, randomUUID(), { mediaId: p.mediaId });
        if (p.classification !== "combined") replaced++;
      }
    }
    const have = await libraryCounts(db, acId);
    const photosBefore = out.photos;

    /** One photo onto this aircraft, approved. Returns why it was passed over, or null once it is in. */
    const addPhoto = async (kind: Classification, name: string, bytes: Uint8Array): Promise<string | null> => {
      const onThis = async (mediaId: string) => !!(await db.select({ id: mediaAssociations.id }).from(mediaAssociations)
        .where(and(eq(mediaAssociations.aircraftMediaId, mediaId), eq(mediaAssociations.aircraftId, acId), eq(mediaAssociations.active, true))))[0];
      let up = await ingestUpload(db, store, lib, { filename: `${operatorName} ${label} ${name}`, bytes, batchLabel: "Platform library" });
      let [cur] = await db.select().from(aircraftMedia).where(eq(aircraftMedia.id, up.result.mediaId));
      if (cur.reviewState === "approved") {
        if (await onThis(cur.id)) return `${label}: ${name} is already in the library`;
        // The same photo serves a sister aircraft too (e.g. one exterior for the Challenger 300 and 350, or one
        // seating plan for a whole fleet of a type): a photo belongs to one aircraft, so this one gets its own copy.
        // Each sister needs different bytes, so the copy steps down in quality until it is one the library lacks.
        for (let quality = 92; quality > 60 && cur.reviewState === "approved"; quality--) {
          const copy = new Uint8Array(await sharp(bytes).jpeg({ quality }).toBuffer());
          up = await ingestUpload(db, store, lib, { filename: `${operatorName} ${label} ${name}`, bytes: copy, batchLabel: "Platform library" });
          [cur] = await db.select().from(aircraftMedia).where(eq(aircraftMedia.id, up.result.mediaId));
          if (cur.reviewState !== "approved" || (await onThis(cur.id))) break;
        }
        if (cur.reviewState === "approved") return `${label}: ${name} is already in the library`;
      }
      const mediaId = up.result.mediaId;
      const version = async () => (await db.select({ v: aircraftMedia.version }).from(aircraftMedia).where(eq(aircraftMedia.id, mediaId)))[0].v;
      await updateMediaMetadata(db, lib, randomUUID(), { mediaId, expectedVersion: cur.version, classification: kind, rightsStatus: "unknown" });
      await setMediaAssociation(db, lib, randomUUID(), { mediaId, expectedVersion: await version(), status: "actual_aircraft", aircraftId: acId });
      await approveMedia(db, lib, { mediaId, contentVersionId: up.result.contentVersionId, expectedVersion: await version() });
      return null;
    };

    for (const kind of KINDS) {
      for (const name of (a.photos as Record<string, string[] | undefined>)[kind] ?? []) {
        const bytes = files.get(name);
        if (!bytes) { out.skipped.push(`${label}: ${name} is not among the uploaded files`); continue; }
        if ((have[kind] ?? 0) >= (LIBRARY_NEEDS[kind] ?? 0)) { out.skipped.push(`${label}: ${name} (the library already has its ${kind.replace("_", " ")})`); continue; }
        const skip = await oneAtATime(sha256(bytes), () => addPhoto(kind, name, bytes));
        if (skip) { out.skipped.push(skip); continue; }
        have[kind] = (have[kind] ?? 0) + 1;
        out.photos++;
      }
    }
    if (replaced) out.retailed.push(`${label}: ${replaced} older photo${replaced === 1 ? "" : "s"} replaced`);
    // A new or changed set gets a new combined photo; an unchanged one keeps its own.
    if ((out.photos > photosBefore || replaced) && KINDS.every((k) => (have[k] ?? 0) >= (LIBRARY_NEEDS[k] ?? 0))) {
      try { await makeCombinedPhoto(db, store, lib, { kind: "aircraft", aircraftId: acId, aircraftTypeId: type.id }, { replace: true }); }
      catch (e) { console.error("Library combined photo failed", e); }
    }
  };

  // Aircraft of one type are matched against each other (no tail, hidden tails), so each type is one lane worked
  // through in pack order; lanes run side by side. Results are reported in pack order whatever finishes first.
  const typeOf = new Map<string, { id: string } | undefined>();
  for (const a of pack.aircraft) if (!typeOf.has(a.type)) typeOf.set(a.type, (await resolveAircraftTypesExact(db, LIBRARY_TENANT_ID, a.type))[0]);
  const lanes = new Map<string, number[]>();
  pack.aircraft.forEach((a, i) => {
    const key = typeOf.get(a.type)?.id ?? `unknown:${i}`;
    lanes.set(key, [...(lanes.get(key) ?? []), i]);
  });
  const results: PackResult[] = pack.aircraft.map(() => ({ created: 0, matched: 0, photos: 0, skipped: [], retailed: [] }));
  const total = pack.aircraft.length;
  let done = 0;
  opts.onProgress?.({ done, total, current: "" });
  const queue = [...lanes.values()];
  const worker = async () => {
    for (let lane = queue.shift(); lane; lane = queue.shift()) {
      for (const i of lane) {
        const a = pack.aircraft[i];
        // Each aircraft keeps the bytes it uploads, so its combined photo is built without fetching them back.
        const mine = new RememberingStore(store);
        try { await importOne(a, typeOf.get(a.type), results[i], mine); }
        catch (e) {
          // One aircraft failing does not stop the rest; running the pack again picks up where it left off.
          console.error("Library import failed for", a.type, a.tail, e);
          results[i].skipped.push(`${a.type}${a.tail ? ` ${a.tail}` : ""}: failed (${(e as Error).message})`);
        }
        finally { mine.forget(); }
        done++;
        opts.onProgress?.({ done, total, current: `${a.type}${a.tail ? ` ${a.tail}` : ""}` });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, queue.length)) }, worker));

  return results.reduce<PackResult>((o, r) => ({
    created: o.created + r.created, matched: o.matched + r.matched, photos: o.photos + r.photos,
    skipped: [...o.skipped, ...r.skipped], retailed: [...o.retailed, ...r.retailed],
  }), { created: 0, matched: 0, photos: 0, skipped: [], retailed: [] });
}
