import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { sampleWordTemplate } from "@/domain/wordSample";

/** A sample Word layout with every tag, to restyle and upload. */
export async function GET() {
  await requireUser();
  return new NextResponse(Buffer.from(sampleWordTemplate()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": 'attachment; filename="Aircraft Media sample quote.docx"',
      "Cache-Control": "private, no-store",
    },
  });
}
