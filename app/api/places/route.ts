import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/session";
import { searchBases, searchRegions } from "@/domain/places";

/** Suggestions for the city / region pickers: /api/places?kind=base|region&q=hk */
export async function GET(req: Request) {
  await requireOwner();
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").slice(0, 60);
  const kind = u.searchParams.get("kind") === "region" ? "region" : "base";
  const items = kind === "region" ? searchRegions(q) : searchBases(q);
  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
