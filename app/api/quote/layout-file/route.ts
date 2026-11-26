import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/session";
import { getQuoteLayoutFile } from "@/domain/quoteLayout";

/** The Word file the broker's layout was read from, as they uploaded it. */
export async function GET() {
  const { actor } = await requireOwner();
  const f = await getQuoteLayoutFile(await getDb(), actor.tenantId);
  if (!f) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(Buffer.from(f.bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${f.fileName.replace(/[^\x20-\x7e]|"/g, "") || "Quote.docx"}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
