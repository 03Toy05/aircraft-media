/**
 * How Toy and the busiest pages slow down as a workspace grows. Run: npx tsx scripts/bench-growth.ts
 * Fills an in-memory database with N aircraft (6 approved photos each) and times the work behind a Toy quote.
 * Production adds a few milliseconds of network per database query on top of these numbers.
 */
import { randomUUID } from "node:crypto";
import { createMemoryDb } from "../src/db/client";
import { aircraft, aircraftMedia, aircraftRegistrations, aircraftTypes, mediaAssociations, mediaContentVersions, organisationAircraftRelationships, organisations, users } from "../src/db/schema";
import { getCatalogue } from "../src/domain/catalogue";
import { findAircraftsForShare } from "../src/domain/chocksShare";
import { converse, emptyDraft } from "../src/domain/chocks";

const KINDS = ["exterior", "cabin", "cabin", "floor_plan", "combined", "cabin"] as const;
const TYPES = ["G280", "G450", "G550", "G650ER", "Global 6000", "Global 7500", "Challenger 350", "Legacy 650E"];

async function seed(n: number) {
  const db = await createMemoryDb();
  const tenantId = randomUUID();
  const [u] = await db.insert(users).values({ tenantId, email: `b${n}@example.test`, displayName: "Bench" }).returning({ id: users.id });
  const types = await db.insert(aircraftTypes).values(TYPES.map((m) => ({ tenantId, manufacturer: "Make", model: m, normalizedName: `make${m.toLowerCase().replace(/\W/g, "")}` }))).returning({ id: aircraftTypes.id });
  const orgs = await db.insert(organisations).values(Array.from({ length: Math.max(1, Math.ceil(n / 10)) }, (_, i) => ({ tenantId, canonicalName: `Operator ${i}`, normalizedName: `operator${i}` }))).returning({ id: organisations.id });
  for (let start = 0; start < n; start += 200) {
    const count = Math.min(200, n - start);
    const acs = await db.insert(aircraft).values(Array.from({ length: count }, (_, i) => ({ tenantId, aircraftTypeId: types[(start + i) % types.length].id }))).returning({ id: aircraft.id, t: aircraft.aircraftTypeId });
    await db.insert(aircraftRegistrations).values(acs.map((a, i) => ({ aircraftId: a.id, registration: `N${start + i}AB`, normalizedRegistration: `N${start + i}AB`, recordedBy: u.id })));
    await db.insert(organisationAircraftRelationships).values(acs.map((a, i) => ({ aircraftId: a.id, organisationId: orgs[(start + i) % orgs.length].id, role: "operator" as const, recordedBy: u.id })));
    const media = await db.insert(aircraftMedia).values(acs.flatMap(() => KINDS.map((k) => ({ tenantId, primaryClassification: k, reviewState: "approved" as const, associationStatus: "actual_aircraft" as const })))).returning({ id: aircraftMedia.id });
    const cvs = await db.insert(mediaContentVersions).values(media.map((m) => ({ aircraftMediaId: m.id, versionNumber: 1, storageRef: "x", contentHash: randomUUID(), mimeType: "image/jpeg", sizeBytes: 1, createdBy: u.id }))).returning({ id: mediaContentVersions.id, m: mediaContentVersions.aircraftMediaId });
    for (const cv of cvs) await db.update(aircraftMedia).set({ currentContentVersionId: cv.id }).where((await import("drizzle-orm")).eq(aircraftMedia.id, cv.m));
    await db.insert(mediaAssociations).values(media.map((m, i) => ({ aircraftMediaId: m.id, aircraftId: acs[Math.floor(i / KINDS.length)].id, associationStatus: "actual_aircraft" as const })));
  }
  return { db, tenantId };
}

async function time(label: string, fn: () => Promise<unknown>, runs = 3) {
  await fn();
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) await fn();
  return [label, Math.round((performance.now() - t0) / runs)] as const;
}

for (const n of (process.argv.slice(2).map(Number).filter(Boolean).length ? process.argv.slice(2).map(Number) : [50, 500, 2000])) {
  const { db, tenantId } = await seed(n);
  const out = [
    await time("catalogue (Fleet, Quote page)", () => getCatalogue(db, tenantId)),
    await time("Toy finds an aircraft", () => findAircraftsForShare(db, tenantId, "Operator 3 G650ER")),
    await time("Toy drafts a quote", () => converse(db, tenantId, { ...emptyDraft(randomUUID()), lang: "en" }, "Operator 3 G650ER quote USD 90,000", [])),
  ];
  console.log(`${n} aircraft, ${n * KINDS.length} photos: ` + out.map(([l, ms]) => `${l} ${ms} ms`).join(" | "));
}
