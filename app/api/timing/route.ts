import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/session";
import { recordTimings, type TimingEvent } from "@/domain/timings";

/** The browser reports how long pages, buttons and Toy took (batched, sent with sendBeacon). */
export async function POST(req: Request) {
  const s = await requireOwner();
  if (s.viewingAs) return new NextResponse(null, { status: 204 }); // the admin looking at someone's workspace
  let events: TimingEvent[] = [];
  try {
    const body = (await req.json()) as { events?: TimingEvent[] };
    events = Array.isArray(body.events) ? body.events : [];
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  await recordTimings(await getDb(), { tenantId: s.actor.tenantId, userId: s.actor.id }, events);
  return new NextResponse(null, { status: 204 });
}
