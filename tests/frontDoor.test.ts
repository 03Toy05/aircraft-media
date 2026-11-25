import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

const at = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "https://www.aircraftmedia.my"), cookie ? { headers: { cookie } } : undefined);
const rewrittenTo = (r: Response) => r.headers.get("x-middleware-rewrite");

describe("Front door", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("shows visitors the welcome page at /, keeping the question and language", () => {
    vi.stubEnv("DEV_AUTH_BYPASS", "");
    expect(rewrittenTo(proxy(at("/")))).toBe("https://www.aircraftmedia.my/welcome");
    expect(rewrittenTo(proxy(at("/?q=what&lang=zh-hant")))).toBe("https://www.aircraftmedia.my/welcome?q=what&lang=zh-hant");
  });
  it("leaves / to the dashboard for signed-in brokers", () => {
    vi.stubEnv("DEV_AUTH_BYPASS", "");
    expect(rewrittenTo(proxy(at("/", "__Secure-authjs.session-token=abc")))).toBeNull();
    expect(rewrittenTo(proxy(at("/", "authjs.session-token.0=abc")))).toBeNull();
  });
});
