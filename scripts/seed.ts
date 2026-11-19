/**
 * DEMO DATA ONLY. Never run against production: it refuses when NODE_ENV=production.
 * Usage: npm run db:seed   (writes to the local embedded database in .data/ unless DATABASE_URL is set)
 */
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { and, eq } from "drizzle-orm";
import { FIXED_TENANT_ID, type Classification } from "../src/domain/constants";
import { getFileStore } from "../src/storage";
import { createAircraft, createAircraftType, createOrganisation, resolveOrganisations } from "../src/domain/directory";
import { approveMedia, getMediaDetail, ingestUpload, setMediaAssociation, updateMediaMetadata } from "../src/domain/media";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");

const db = await getDb();
const store = getFileStore();
const email = (process.env.OWNER_EMAIL || "owner@localhost").toLowerCase();
let [u] = await db.select().from(users).where(and(eq(users.tenantId, FIXED_TENANT_ID), eq(users.email, email)));
if (!u) [u] = await db.insert(users).values({ tenantId: FIXED_TENANT_ID, email, displayName: "Owner" }).returning();
const actor = { id: u.id, tenantId: FIXED_TENANT_ID };

if ((await resolveOrganisations(db, FIXED_TENANT_ID, "Demo Metrojet")).length) {
  console.log("Demo data already present; nothing to do.");
  process.exit(0);
}

const k = () => randomUUID();
const org = (await createOrganisation(db, actor, k(), { name: "Demo Metrojet", aliases: ["Metrojet", "Metro Jet"] })).result.organisationId;
const org2 = (await createOrganisation(db, actor, k(), { name: "Demo Skyline Aviation", roles: ["operator", "management_company"] })).result.organisationId;
const g650 = (await createAircraftType(db, actor, k(), { manufacturer: "Gulfstream", model: "G650ER" })).result.aircraftTypeId;
const gl7500 = (await createAircraftType(db, actor, k(), { manufacturer: "Bombardier", model: "Global 7500" })).result.aircraftTypeId;

const a1 = (await createAircraft(db, actor, k(), {
  aircraftTypeId: g650, registration: "B-KXX", operatorId: org, base: { mode: "based", locations: ["Hong Kong", "Singapore"] },
  info: { yom: 2018, yor: 2024, capacity: 13, wifiStatus: "yes", notes: "Owner's approval required (DEMO)" },
})).result.aircraftId;
const a2 = (await createAircraft(db, actor, k(), {
  aircraftTypeId: g650, registration: "B-KYY", operatorId: org, base: { mode: "floating" }, info: { yom: 2020, capacity: 14, wifiStatus: "tbc" },
})).result.aircraftId;
await createAircraft(db, actor, k(), { aircraftTypeId: gl7500, registration: "VP-DEM", operatorId: org2, base: { mode: "based", locations: ["Dubai"] }, info: { yom: 2022, capacity: 17, wifiStatus: "no" } });

async function demoImage(text: string, hue: number) {
  const svg = `<svg width="800" height="520" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="hsl(${hue},45%,38%)"/><text x="400" y="270" font-size="56" fill="#fff" text-anchor="middle" font-family="sans-serif">${text}</text><text x="400" y="330" font-size="26" fill="#fffc" text-anchor="middle" font-family="sans-serif">DEMO IMAGE</text></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

async function add(text: string, hue: number, cls: Classification, assoc: { aircraftId?: string; typeId?: string }, approve: boolean) {
  const r = (await ingestUpload(db, store, actor, { filename: `demo-${text}.png`, bytes: await demoImage(text, hue) })).result;
  let v = 1;
  await updateMediaMetadata(db, actor, k(), { mediaId: r.mediaId, expectedVersion: v++, classification: cls });
  await setMediaAssociation(db, actor, k(), {
    mediaId: r.mediaId, expectedVersion: v++,
    status: assoc.aircraftId ? "actual_aircraft" : "representative_type",
    aircraftId: assoc.aircraftId ?? null, aircraftTypeId: assoc.typeId ?? null,
  });
  if (approve) {
    const d = (await getMediaDetail(db, actor.tenantId, r.mediaId))!;
    await approveMedia(db, actor, { mediaId: r.mediaId, contentVersionId: d.media.currentContentVersionId!, expectedVersion: d.media.version });
  }
}

await add("B-KXX Exterior", 210, "exterior", { aircraftId: a1 }, true);
await add("B-KXX Cabin", 30, "interior", { aircraftId: a1 }, true);
await add("B-KXX Floor plan", 140, "floor_plan", { aircraftId: a1 }, true);
await add("G650ER type exterior", 280, "exterior", { typeId: g650 }, true);
await add("B-KYY Cabin (awaiting review)", 350, "interior", { aircraftId: a2 }, false);

console.log("Demo data created: 2 operators, 2 aircraft types, 3 aircraft, 5 demo photos.");
process.exit(0);
