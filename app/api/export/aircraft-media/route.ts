import { getDb } from "@/db/client";
import { requireUser } from "@/lib/session";
import { buildExportCsv } from "@/domain/cbosExport";

/** The CBOS data sheet for the signed-in workspace: every approved photo with its stable IDs and details. Read-only. */
export async function GET() {
  const { actor } = await requireUser();
  const csv = await buildExportCsv(await getDb(), actor.tenantId);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="aircraft-media-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
