/**
 * Live Google Drive verification. Run: npm run drive:check
 * Uses the real credentials from .env.local, an in-memory database, and prints no secrets.
 * It imports a folder named "Test" (or the folder given as the first argument) from inside the Aircraft Media root.
 * Side effect in Drive: derivatives (e.g. photos extracted from a PDF) and one tiny probe file are written under
 * Processing/ and Sources/ in the root. They can be deleted by hand.
 */
import { createMemoryDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { FIXED_TENANT_ID } from "../src/domain/constants";
import { driveClientFromEnv, DriveFileStore, FOLDER_MIME } from "../src/storage/drive";
import { StorageRouter } from "../src/storage";
import { importDriveFolder } from "../src/domain/driveImport";
import { aircraftMedia, mediaContentVersions } from "../src/db/schema";
import { readContentBytes } from "../src/domain/media";

const client = driveClientFromEnv();
if (!client) {
  console.error("Missing Drive settings. Need AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN, GOOGLE_DRIVE_ROOT_FOLDER_ID.");
  process.exit(1);
}
const ok = (m: string) => console.log("  ✓ " + m);
const bad = (m: string) => {
  console.log("  ✗ " + m);
  process.exitCode = 1;
};

console.log("1. Authorisation and root folder");
const root = await client.getFile(client.rootFolderId).catch((e) => {
  bad(`Could not open the root folder: ${(e as Error).message}`);
  process.exit(1);
});
ok(`Authorised. Root folder name: "${root.name}"`);

console.log("2. Folders inside the root");
const kids = await client.listChildren(client.rootFolderId);
const folders = kids.filter((k) => k.mimeType === FOLDER_MIME);
console.log("   " + (folders.map((f) => f.name).join(", ") || "(none)") + `  [${kids.length - folders.length} loose file(s)]`);
const target = process.argv[2] ?? "Test";
const folder = folders.find((f) => f.name.toLowerCase() === target.toLowerCase()) ?? (await client.getFile(target).catch(() => null));
if (!folder || folder.mimeType !== FOLDER_MIME) {
  bad(`No folder called "${target}" inside the root. Create it in Drive and add some test files.`);
  process.exit(1);
}
ok(`Found folder "${folder.name}"`);

console.log("3. Import (twice)");
const db = await createMemoryDb();
const [u] = await db.insert(users).values({ tenantId: FIXED_TENANT_ID, email: "check@local", displayName: "check" }).returning();
const actor = { id: u.id, tenantId: FIXED_TENANT_ID };
const store = new StorageRouter(new DriveFileStore(client));
const first = await importDriveFolder(db, client, store, actor, folder.id);
console.log(`   imported ${first.imported}, already ${first.alreadyImported}, unsupported ${first.unsupported}, failed ${first.failed}`);
for (const i of first.items) console.log(`   - ${i.name}: ${i.outcome}${i.error ? ` (${i.error})` : ""}`);
first.failed === 0 && first.imported > 0 ? ok("First import completed") : bad("First import had failures or imported nothing");
const second = await importDriveFolder(db, client, store, actor, folder.id);
second.imported === 0 && second.alreadyImported === first.imported ? ok(`Second import skipped all ${second.alreadyImported} already-imported files`) : bad(`Second import: imported ${second.imported}, already ${second.alreadyImported}`);

console.log("4. Read the photos back from Drive");
const versions = await db.select().from(mediaContentVersions);
for (const v of versions) {
  try {
    const { bytes } = await readContentBytes(db, store, v.id);
    ok(`${v.storageKind} ${v.isDerivative ? "derivative" : "original"} ${v.width}x${v.height} -> ${bytes.byteLength} bytes`);
  } catch (e) {
    bad(`Could not read ${v.id}: ${(e as Error).message}`);
  }
}
console.log(`   media records: ${(await db.select().from(aircraftMedia)).length}`);

console.log("5. Safety: a folder outside the root must be refused");
const outside = await client.isWithinRoot("root"); // "root" is the My Drive top folder, not inside Aircraft Media
outside === false ? ok("My Drive top folder is correctly treated as outside the Aircraft Media root") : bad("My Drive top folder was wrongly treated as inside the root");

console.log("6. Write a tiny probe file into Sources/ (delete it by hand afterwards)");
const probe = await store.put(new TextEncoder().encode("aircraft-media live check"), "aircraft-media-live-check.txt", "Sources", "text/plain");
const back = new TextDecoder().decode(await store.get(probe));
back === "aircraft-media live check" ? ok("Uploaded and downloaded the probe file under Sources/") : bad("Probe file content did not match");

console.log(process.exitCode ? "\nSome checks FAILED." : "\nAll live checks passed.");
process.exit(process.exitCode ?? 0);
