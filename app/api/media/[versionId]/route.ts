import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftMedia, mediaContentVersions } from "@/db/schema";
import { getFileStore } from "@/storage";
import { readContentBytes } from "@/domain/media";
import { requireOwner } from "@/lib/session";

/** Authenticated, server-side streaming of exact stored bytes. No unrestricted storage URLs are exposed. */
export async function GET(_req: Request, ctx: { params: Promise<{ versionId: string }> }) {
  const { actor } = await requireOwner();
  const { versionId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(versionId)) return new NextResponse("Not found", { status: 404 });
  const db = await getDb();
  const [row] = await db
    .select({ tenantId: aircraftMedia.tenantId })
    .from(mediaContentVersions)
    .innerJoin(aircraftMedia, eq(aircraftMedia.id, mediaContentVersions.aircraftMediaId))
    .where(eq(mediaContentVersions.id, versionId));
  if (!row || row.tenantId !== actor.tenantId) return new NextResponse("Not found", { status: 404 });
  try {
    const { bytes, mimeType } = await readContentBytes(db, getFileStore(), versionId);
    return new NextResponse(Buffer.from(bytes), {
      headers: { "Content-Type": mimeType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new NextResponse("File unavailable", { status: 410 });
  }
}
