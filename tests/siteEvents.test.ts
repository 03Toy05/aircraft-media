import { describe, expect, it } from "vitest";
import { setup } from "./helpers";
import { countSiteEvent, isSiteEvent, resetSiteLimit, siteFunnel, siteLang, underSiteLimit } from "../src/domain/siteEvents";
import { siteEvents } from "../src/db/schema";

describe("Website counts", () => {
  it("adds one per event, day and language, and sums them for the Users page", async () => {
    const t = await setup();
    const now = new Date("2026-11-27T10:00:00Z");
    await countSiteEvent(t.db, "demo_play", "en", now);
    await countSiteEvent(t.db, "demo_play", "en", now);
    await countSiteEvent(t.db, "demo_play", "zh-hant", now);
    await countSiteEvent(t.db, "demo_play", "en", new Date("2026-11-10T10:00:00Z")); // in the 30 days, not the 7
    await countSiteEvent(t.db, "demo_play", "en", new Date("2026-09-01T10:00:00Z")); // too old
    const rows = await t.db.select().from(siteEvents);
    expect(rows.find((r) => r.day === "2026-11-27" && r.lang === "en")?.n).toBe(2);

    const funnel = await siteFunnel(t.db, "admin@example.com", now);
    const play = funnel.find((r) => r.event === "demo_play")!;
    expect(play.d7).toBe(3);
    expect(play.d30).toBe(4);
    expect(play.byLang30).toEqual({ en: 3, "zh-hant": 1, "zh-hans": 0 });
    expect(funnel.map((r) => r.event)).toContain("signup_complete");
    expect(funnel.map((r) => r.event)).toContain("first_quote");
  });

  it("takes only known events, maps languages, and stops a flood", () => {
    expect(isSiteEvent("demo_play")).toBe(true);
    expect(isSiteEvent("drop table")).toBe(false);
    expect(siteLang("zh-Hant")).toBe("zh-hant");
    expect(siteLang("zh-TW")).toBe("zh-hant");
    expect(siteLang("zh-Hans")).toBe("zh-hans");
    expect(siteLang(undefined)).toBe("en");
    resetSiteLimit();
    let ok = 0;
    for (let i = 0; i < 700; i++) if (underSiteLimit(1_000_000)) ok++;
    expect(ok).toBe(600);
    expect(underSiteLimit(1_000_000 + 60_000)).toBe(true); // a new minute
  });
});
