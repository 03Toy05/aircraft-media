import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getFileStore } from "@/storage";
import { readContentBytes } from "@/domain/media";
import { photoAllowed } from "@/domain/photoAccess";
import { requireOwner } from "@/lib/session";

/** Authenticated, server-side streaming of exact stored bytes. No unrestricted storage URLs are exposed. */
export async function GET(_req: Request, ctx: { params: Promise<{ versionId: string }> }) {
  const session = await requireOwner();
  const { versionId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(versionId)) return new NextResponse("Not found", { status: 404 });
  const db = await getDb();
  // Your own workspace's photos. The library's, for people it is shared with. Photos offered to it, for the admin.
  if (!(await photoAllowed(db, session, versionId))) return new NextResponse("Not found", { status: 404 });
  try {
    const { bytes, mimeType } = await readContentBytes(db, getFileStore(), versionId);
    return new NextResponse(Buffer.from(bytes), {
      headers: { "Content-Type": mimeType, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new NextResponse("File unavailable", { status: 410 });
  }
}
