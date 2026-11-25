import { NextResponse, type NextRequest } from "next/server";

/**
 * The front door: visitors who are not signed in see the public welcome page at "/"; signed-in brokers get their
 * dashboard there as before. This is only a quick look at the sign-in cookie: the app still checks the session
 * properly (a stale cookie lands on the sign-in page, as before).
 */
export function proxy(request: NextRequest) {
  const signedIn = request.cookies.getAll().some((c) => /^(__Secure-)?authjs\.session-token(\.\d+)?$/.test(c.name));
  const devBypass = process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "1";
  if (signedIn || devBypass) return NextResponse.next();
  return NextResponse.rewrite(new URL(`/welcome${request.nextUrl.search}`, request.url));
}

export const config = { matcher: "/" };
