import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getFileStore } from "@/storage";
import { requireOwner } from "@/lib/session";
import { buildAircraftExport, zipExport } from "@/domain/export";
import { parseClassification } from "@/domain/constants";
import { DomainError } from "@/domain/errors";
import { serverT } from "@/lib/uiLang";

/**
 * Owner-only export of an aircraft's card and approved photos.
 *   ?views=cabin,floor_plan   limit to some classifications (default: all)
 *   zip download with the card as aircraft-card.txt
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { actor } = await requireOwner();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse((await serverT())("Not found"), { status: 404 });
  const url = new URL(req.url);
  const views = (url.searchParams.get("views") ?? "").split(",").map((v) => parseClassification(v.trim())).filter((v) => v !== null);
  try {
    const exp = await buildAircraftExport(await getDb(), getFileStore(), actor, id, views.length ? views : undefined);
    const zip = zipExport(exp);
    return new NextResponse(Buffer.from(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${(exp.files[0]?.name.split(" - ").pop() ?? "aircraft").replace(/\.\w+$/, "")}-photos.zip"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof DomainError) return new NextResponse((await serverT()).error(e), { status: 404 });
    throw e;
  }
}
