import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftMedia, libraryContributions, mediaContentVersions } from "@/db/schema";
import { getFileStore } from "@/storage";
import { readContentBytes } from "@/domain/media";
import { requireOwner } from "@/lib/session";
import { LIBRARY_TENANT_ID, hasLibraryAccess } from "@/domain/library";

/** Authenticated, server-side streaming of exact stored bytes. No unrestricted storage URLs are exposed. */
export async function GET(_req: Request, ctx: { params: Promise<{ versionId: string }> }) {
  const session = await requireOwner();
  const { actor, isAdmin } = session;
  const { versionId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(versionId)) return new NextResponse("Not found", { status: 404 });
  const db = await getDb();
  const [row] = await db
    .select({ tenantId: aircraftMedia.tenantId })
    .from(mediaContentVersions)
    .innerJoin(aircraftMedia, eq(aircraftMedia.id, mediaContentVersions.aircraftMediaId))
    .where(eq(mediaContentVersions.id, versionId));
  if (!row) return new NextResponse("Not found", { status: 404 });
  // Your own workspace's photos. The library's, for people it is shared with. Photos offered to it, for the admin.
  let allowed = row.tenantId === actor.tenantId;
  // The library: everyone it is shared with.
  if (!allowed && row.tenantId === LIBRARY_TENANT_ID) allowed = await hasLibraryAccess(db, session);
  if (!allowed && isAdmin) {
    allowed = (await db.select({ id: libraryContributions.id }).from(libraryContributions).where(eq(libraryContributions.sourceContentVersionId, versionId)).limit(1)).length > 0;
  }
  if (!allowed) return new NextResponse("Not found", { status: 404 });
  try {
    const { bytes, mimeType } = await readContentBytes(db, getFileStore(), versionId);
    return new NextResponse(Buffer.from(bytes), {
      headers: { "Content-Type": mimeType, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new NextResponse("File unavailable", { status: 410 });
  }
}
