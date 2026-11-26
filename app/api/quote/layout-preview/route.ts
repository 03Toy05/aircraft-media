import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/session";
import { getQuoteLayout, layoutValues } from "@/domain/quoteLayout";
import { layoutPdf } from "@/domain/layoutPdf";
import { sampleLayoutQuote } from "@/domain/layoutSample";

/** Settings: the broker's layout filled with a made-up two-aircraft quote, to check what Toy read. No photos. */
export async function GET() {
  const { actor, email } = await requireOwner();
  const l = await getQuoteLayout(await getDb(), actor.tenantId);
  if (!l) return new NextResponse("Not found", { status: 404 });
  const q = sampleLayoutQuote(email);
  const bytes = await layoutPdf(l.layout, layoutValues(q), "en", async () => null, { title: "Sample quote", author: email });
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Sample quote in your layout.pdf"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
