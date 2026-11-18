// Adds Asian business-jet operators to the directory (name, region, other spellings).
//   npx tsx scripts/import-operators.ts           -> dry run: shows what would happen
//   npx tsx scripts/import-operators.ts --apply   -> does it
// Safe to run again: an operator that already exists (by name or other name) is not duplicated, and an existing
// region is never overwritten. Stop the dev server first when using the local database (it allows one process).
import { and, eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { organisationAliases, organisations, users } from "../src/db/schema";
import { FIXED_TENANT_ID, normalizeKey } from "../src/domain/constants";
import { addOrganisationAlias, createOrganisation, setOrganisationRegion } from "../src/domain/directory";

interface Entry { name: string; region?: string; aliases?: string[] }

const OPERATORS: Entry[] = [
  // Hong Kong
  { name: "Metrojet", region: "Hong Kong", aliases: ["Metro Jet"] },
  { name: "Ever Jet", region: "Hong Kong" },
  { name: "Hongkong Jet", region: "Hong Kong", aliases: ["Hong Kong Jet"] },
  { name: "Phenix Jet", region: "Hong Kong" },
  // Taiwan
  { name: "Win Air", region: "Taiwan" },
  { name: "EATC", region: "Taiwan" },
  { name: "Sky Vision Aviation", region: "Taiwan" },
  // Korea
  { name: "Korean Air", region: "Korea", aliases: ["Korean Air Lines"] },
  // Japan
  { name: "Aeroasahi", region: "Japan" },
  { name: "Aero Toyota", region: "Japan" },
  // Indonesia (JetSetGo is placed here as listed by the owner; public sources describe it as an Indian company)
  { name: "Premier Air", region: "Indonesia" },
  { name: "JetSetGo", region: "Indonesia" },
  // Thailand
  { name: "Siam Lands", region: "Thailand" },
  { name: "MJets", region: "Thailand" },
  { name: "Advance Aviation", region: "Thailand" },
  // Malaysia
  { name: "AsiaJet", region: "Malaysia" },
  { name: "Smooth Route", region: "Malaysia" },
  // Singapore
  { name: "Pacific Flight Service", region: "Singapore", aliases: ["Pacific Flight Services"] },
  { name: "Air7", region: "Singapore" },
  { name: "Seletar Jet", region: "Singapore", aliases: ["Seletar Jet Charter"] },
  { name: "CapaJet", region: "Singapore" },
  { name: "Executive Jets Asia", region: "Singapore" },
  { name: "Asia Corporate Jet", region: "Singapore" },
  // China
  { name: "Sino Jet", region: "China" },
  { name: "Deer Jet", region: "China" },
  // India
  { name: "Karnavati Aviation", region: "India" },
  { name: "Club One Air", region: "India" },
  { name: "VSR Ventures", region: "India" },
  { name: "Taj Air", region: "India" },
  // Other places
  { name: "Vietstar Airlines", region: "Vietnam", aliases: ["Vietstar Aviation"] },
  { name: "Asian Aerospace", region: "Philippines" },
  { name: "Challenger Aero Air", region: "Philippines" },
  { name: "Australian Corporate Jet Centres", region: "Australia" },
  // In the Asian Sky Group ranking; the sources do not say where they are based, so no region is set
  { name: "Tag Aviation", aliases: ["TAG Aviation"] },
  { name: "Jet Aviation" },
  { name: "ACAM" },
  { name: "BAA" },
  { name: "Luxaviation" },
  { name: "Titan Aviation" },
  { name: "Global Jet International" },
  { name: "AVCAIR" },
  { name: "Lily Jet" },
  { name: "Amber Aviation" },
  { name: "Air Link" },
  { name: "ExecuJet" },
];

const apply = process.argv.includes("--apply");
const db = await getDb();
const [owner] = await db.select().from(users).where(and(eq(users.tenantId, FIXED_TENANT_ID), eq(users.role, "owner")));
if (!owner) {
  console.error("No owner user yet. Sign in to the app once, then run this again.");
  process.exit(1);
}
const actor = { id: owner.id, tenantId: FIXED_TENANT_ID };

const orgs = await db.select().from(organisations).where(and(eq(organisations.tenantId, FIXED_TENANT_ID), eq(organisations.active, true)));
const aliases = await db.select().from(organisationAliases);
const findExisting = (name: string) => {
  const n = normalizeKey(name);
  return orgs.find((o) => o.normalizedName === n) ?? orgs.find((o) => aliases.some((a) => a.organisationId === o.id && a.normalizedAlias === n));
};

let created = 0, existing = 0, regionSet = 0, aliasAdded = 0;
for (const e of OPERATORS) {
  const key = `import:operators:v1:${normalizeKey(e.name)}`;
  const found = findExisting(e.name);
  if (found) {
    existing++;
    const needsRegion = !!e.region && !found.region;
    console.log(`= ${e.name}: already there as "${found.canonicalName}"${found.region ? ` (region ${found.region})` : ""}${needsRegion ? ` -> set region ${e.region}` : ""}`);
    if (apply && needsRegion) { await setOrganisationRegion(db, actor, `${key}:region`, { organisationId: found.id, region: e.region! }); regionSet++; }
    for (const a of e.aliases ?? []) {
      const taken = findExisting(a);
      if (!taken && apply) { await addOrganisationAlias(db, actor, `${key}:alias:${normalizeKey(a)}`, { organisationId: found.id, alias: a }); aliasAdded++; }
    }
    continue;
  }
  // Names that differ only slightly from one you already have are listed so you can decide.
  const near = orgs.filter((o) => { const a = normalizeKey(o.canonicalName), b = normalizeKey(e.name); return a !== b && (a.includes(b) || b.includes(a)); });
  console.log(`+ ${e.name}${e.region ? ` (${e.region})` : ""}${e.aliases?.length ? ` also written ${e.aliases.join(", ")}` : ""}${near.length ? `   NOTE: similar to existing ${near.map((o) => `"${o.canonicalName}"`).join(", ")}` : ""}`);
  if (apply) {
    await createOrganisation(db, actor, key, { name: e.name, roles: ["operator"], aliases: e.aliases ?? [], region: e.region ?? null });
    created++;
  }
}
console.log(apply ? `\nDone. Created ${created}, already there ${existing}, regions set on existing ${regionSet}, other names added ${aliasAdded}.` : `\nDry run only. ${OPERATORS.length - existing} would be created, ${existing} already exist. Run with --apply to do it.`);
process.exit(0);
