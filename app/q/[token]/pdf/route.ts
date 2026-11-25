import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getFileStore } from "@/storage";
import { readContentBytes } from "@/domain/media";
import { openLink, quotePhotoIds } from "@/domain/quoteLinks";
import { pdfSupported, quotePdf } from "@/domain/quotePdf";

/** The client's PDF of the quote their link shows (latest version), with only that quote's photos. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const db = await getDb();
  const q = await openLink(db, token);
  if (!q) return new NextResponse("Not found", { status: 404 });
  if (!pdfSupported(q.quote.lang)) return new NextResponse("A PDF isn't available in this language yet; the page itself shows the full quote.", { status: 404 });
  const allowed = quotePhotoIds(q.quote);
  const store = getFileStore();
  const pdf = await quotePdf(q, async (id) => (allowed.has(id) ? readContentBytes(db, store, id) : null));
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${q.reference}-v${q.version}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
