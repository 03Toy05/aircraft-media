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
  it("opens the free trial in the front page's language", () => {
    const r = proxy(at("/start?lang=zh-hant"));
    expect(r.headers.get("location")).toBe("https://www.aircraftmedia.my/start");
    expect(r.headers.get("set-cookie")).toContain("am_lang=zh-Hant");
    expect(proxy(at("/start?lang=zh-hans")).headers.get("set-cookie")).toContain("am_lang=zh-Hans");
    expect(proxy(at("/start")).headers.get("location")).toBeNull();
    expect(proxy(at("/start?lang=xx")).headers.get("location")).toBeNull();
  });
  it("leaves / to the dashboard for signed-in brokers", () => {
    vi.stubEnv("DEV_AUTH_BYPASS", "");
    expect(rewrittenTo(proxy(at("/", "__Secure-authjs.session-token=abc")))).toBeNull();
    expect(rewrittenTo(proxy(at("/", "authjs.session-token.0=abc")))).toBeNull();
  });
});
