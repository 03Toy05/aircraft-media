import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getFileStore } from "@/storage";
import { readContentBytes } from "@/domain/media";
import { openLink, quotePhotoIds } from "@/domain/quoteLinks";

/** A photo of the quote a client link shows; nothing else is reachable this way, and nothing once the link is off. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await ctx.params;
  const db = await getDb();
  const q = await openLink(db, token);
  if (!q || !quotePhotoIds(q.quote).has(id)) return new NextResponse("Not found", { status: 404 });
  try {
    const { bytes, mimeType } = await readContentBytes(db, getFileStore(), id);
    return new NextResponse(Buffer.from(bytes), {
      headers: { "Content-Type": mimeType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" },
    });
  } catch {
    return new NextResponse("File unavailable", { status: 410 });
  }
}
