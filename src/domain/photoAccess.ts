import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { aircraftMedia, libraryContributions, mediaAssociations, mediaContentVersions } from "../db/schema";
import { LIBRARY_TENANT_ID, libraryScope, scopeHasAircraft } from "./library";

/**
 * Whether this person may see (and so send) a stored photo: their own workspace's photos; the library's, for people
 * it is shared with (only the operators opened to them); photos offered to the library, for the admin.
 * Used by the photo address and by quote emails, so both follow the same rules.
 */
export async function photoAllowed(
  db: Db,
  who: { isAdmin: boolean; actor: { id: string; tenantId: string } },
  contentVersionId: string,
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(contentVersionId)) return false;
  const [row] = await db
    .select({ tenantId: aircraftMedia.tenantId, mediaId: aircraftMedia.id })
    .from(mediaContentVersions)
    .innerJoin(aircraftMedia, eq(aircraftMedia.id, mediaContentVersions.aircraftMediaId))
    .where(eq(mediaContentVersions.id, contentVersionId));
  if (!row) return false;
  if (row.tenantId === who.actor.tenantId) return true;
  if (row.tenantId === LIBRARY_TENANT_ID) {
    const scope = await libraryScope(db, who);
    if (scope?.all) return true;
    if (scope) {
      // A type's general photos belong to no operator: those are fine.
      const links = await db.select({ aircraftId: mediaAssociations.aircraftId }).from(mediaAssociations)
        .where(and(eq(mediaAssociations.aircraftMediaId, row.mediaId), eq(mediaAssociations.active, true)));
      if (links.some((l) => !l.aircraftId || scopeHasAircraft(scope, l.aircraftId))) return true;
    }
  }
  if (who.isAdmin) {
    return (await db.select({ id: libraryContributions.id }).from(libraryContributions).where(eq(libraryContributions.sourceContentVersionId, contentVersionId)).limit(1)).length > 0;
  }
  return false;
}
