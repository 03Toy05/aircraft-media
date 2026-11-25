import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getFileStore } from "@/storage";
import { requireOwner } from "@/lib/session";
import { brokerQuotePdf } from "@/domain/quotePdf";

/** The broker's PDF of one saved version: /api/requests/<id>/pdf?version=3 (the latest without a version). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireOwner();
  const { id } = await ctx.params;
  const version = Number(new URL(req.url).searchParams.get("version") ?? "") || undefined;
  const pdf = await brokerQuotePdf(await getDb(), getFileStore(), session, id, version);
  if (!pdf) return new NextResponse("No PDF for that quote (not saved yet, or its language has no PDF yet: send the client link instead).", { status: 404 });
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdf.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
