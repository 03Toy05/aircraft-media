import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getFileStore } from "@/storage";
import { requireOwner } from "@/lib/session";
import { serverT } from "@/lib/uiLang";
import { brokerPreviewPdf } from "@/domain/quotePdf";

/** The Quote page's "Preview PDF": the PDF of the quote on screen, made from what is posted, nothing saved. */
export async function POST(req: Request) {
  const session = await requireOwner();
  const t = await serverT();
  let body: { snapshot?: unknown; requestId?: string | null };
  try { body = await req.json(); } catch { return new NextResponse(t("The preview couldn't be made. Try again."), { status: 400 }); }
  try {
    const pdf = await brokerPreviewPdf(await getDb(), getFileStore(), session, body.snapshot, typeof body.requestId === "string" ? body.requestId : null);
    if ("error" in pdf) {
      return new NextResponse(pdf.error === "language" ? t("There is no PDF in this language yet; send the client link instead.") : t("Add the routing first: a PDF needs at least one leg."), { status: 400 });
    }
    return new NextResponse(Buffer.from(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdf.filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Preview PDF failed", e);
    return new NextResponse(t.error(e, "The preview couldn't be made. Try again."), { status: 500 });
  }
}
