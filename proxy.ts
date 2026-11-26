import { NextResponse, type NextRequest } from "next/server";

/**
 * The front door: visitors who are not signed in see the public welcome page at "/"; signed-in brokers get their
 * dashboard there as before. This is only a quick look at the sign-in cookie: the app still checks the session
 * properly (a stale cookie lands on the sign-in page, as before).
 */
/** The front page's languages (?lang=) as the app's screen languages. */
const SITE_TO_UI: Record<string, string> = { en: "en", "zh-hant": "zh-Hant", "zh-hans": "zh-Hans" };

export function proxy(request: NextRequest) {
  // From the front page to the free trial in the visitor's language: remember it as the screen language (as the
  // EN / 繁 / 简 switch does) and open /start without it, so the switch there keeps working.
  if (request.nextUrl.pathname === "/start") {
    const lang = SITE_TO_UI[request.nextUrl.searchParams.get("lang") ?? ""];
    if (!lang) return NextResponse.next();
    const to = request.nextUrl.clone();
    to.searchParams.delete("lang");
    const res = NextResponse.redirect(to);
    res.cookies.set("am_lang", lang, { path: "/", maxAge: 31_536_000, sameSite: "lax" });
    return res;
  }
  const signedIn = request.cookies.getAll().some((c) => /^(__Secure-)?authjs\.session-token(\.\d+)?$/.test(c.name));
  const devBypass = process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "1";
  if (signedIn || devBypass) return NextResponse.next();
  return NextResponse.rewrite(new URL(`/welcome${request.nextUrl.search}`, request.url));
}

export const config = { matcher: ["/", "/start"] };
