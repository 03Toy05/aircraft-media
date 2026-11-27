import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { countSiteEvent, isSiteEvent, siteLang, underSiteLimit } from "@/domain/siteEvents";

/**
 * The public website counts how far visitors get: POST {"event": "demo_play", "lang": "zh-hant"}.
 * Counts per day and language only; no cookies are set and no IP address or browser details are kept.
 * Accepts JSON or a sendBeacon text body. Always answers 204 (unknown events are ignored), so the page never waits on it.
 */
export async function POST(req: Request) {
  let body: { event?: unknown; lang?: unknown } = {};
  try {
    const text = await req.text();
    if (text.length <= 500) body = JSON.parse(text);
  } catch {
    /* ignore what isn't JSON */
  }
  if (isSiteEvent(body.event) && underSiteLimit()) {
    try {
      await countSiteEvent(await getDb(), body.event, siteLang(body.lang));
    } catch (e) {
      console.error("site event not counted", e);
    }
  }
  return new NextResponse(null, { status: 204 });
}
