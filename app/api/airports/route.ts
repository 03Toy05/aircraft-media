import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/session";
import { searchAirports } from "@/domain/airports";

/** Airport search for the routing: /api/airports?q=VHHH | HKG | hong kong */
export async function GET(req: Request) {
  await requireOwner();
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 60);
  const items = searchAirports(q, 10).map(({ icao, iata, name, city, cc, tz, lat, lon }) => ({ icao, iata, name, city, cc, tz, lat, lon }));
  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
