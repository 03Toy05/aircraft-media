import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import type { Actor } from "./action";
import { importLibraryPack, type LibraryPack } from "./library";
import { startImportJob, type ImportJob } from "./importJobs";
import type { FileStore } from "../storage";

/** The most one upload may carry (the same as the Import page). */
export const MAX_PACK_BYTES = 45 * 1024 * 1024;
/** A key shorter than this is treated as not set, so a weak one can't switch the upload address on. */
export const MIN_KEY_LENGTH = 32;

/**
 * Whether `given` is the library upload key (LIBRARY_UPLOAD_KEY). With no key set (or a short one) nothing matches,
 * so the upload address stays off. Compared in constant time.
 */
export function uploadKeyMatches(given: string | null | undefined, key = process.env.LIBRARY_UPLOAD_KEY): boolean {
  if (!key || key.length < MIN_KEY_LENGTH || !given) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(key));
}

export const uploadKeySet = (key = process.env.LIBRARY_UPLOAD_KEY) => !!key && key.length >= MIN_KEY_LENGTH;

/** The platform admin (OWNER_EMAIL) as the one doing the import; they must have signed in once. */
export async function adminActor(db: Db, ownerEmail = process.env.OWNER_EMAIL): Promise<Actor | null> {
  const email = ownerEmail?.trim().toLowerCase();
  if (!email) return null;
  const [u] = await db.select({ id: users.id, tenantId: users.tenantId }).from(users).where(eq(users.email, email));
  return u ? { id: u.id, tenantId: u.tenantId } : null;
}

/** pack.json and its photos, read from uploaded files. Throws a plain message when something is missing. */
export async function readPackFiles(list: Iterable<unknown>): Promise<{ pack: LibraryPack; files: Map<string, Uint8Array> }> {
  const files = new Map<string, Uint8Array>();
  let pack: LibraryPack | null = null;
  let bytesTotal = 0;
  for (const f of list) {
    if (!(f instanceof File) || f.size === 0) continue;
    bytesTotal += f.size;
    if (bytesTotal > MAX_PACK_BYTES) throw new Error("That is more than 45 MB. Import the pack in parts.");
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.json$/i.test(f.name)) {
      try { pack = JSON.parse(new TextDecoder().decode(bytes)) as LibraryPack; }
      catch { throw new Error("pack.json isn't valid JSON."); }
    } else files.set(f.name, bytes);
  }
  if (!pack) throw new Error("Choose pack.json together with its photos.");
  if (!pack.operator?.trim() || !Array.isArray(pack.aircraft) || !pack.aircraft.length) throw new Error("The pack needs an operator name and its aircraft.");
  return { pack, files };
}

/** Starts the import in the background and returns its job (progress, then the result message). */
export function startPackImport(db: Db, store: FileStore, admin: Actor, pack: LibraryPack, files: Map<string, Uint8Array>): ImportJob {
  return startImportJob(pack.operator, pack.aircraft.length, async (job) => {
    const r = await importLibraryPack(db, store, admin, pack, files, {
      onProgress: (x) => { job.done = x.done; job.total = x.total; job.current = x.current; },
    });
    return `${pack.operator}: ${r.created} aircraft added, ${r.matched} already there, ${r.photos} photo${r.photos === 1 ? "" : "s"} added.${r.retailed.length ? ` Updated: ${r.retailed.join("; ")}.` : ""}${r.skipped.length ? ` Passed over: ${r.skipped.join("; ")}.` : ""}`;
  });
}
