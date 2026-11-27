import { describe, expect, it } from "vitest";
import { setup, makeImage } from "./helpers";
import { makeDemoQuote } from "../src/domain/demoQuote";
import { openLink } from "../src/domain/quoteLinks";

describe("The website's demo client link", () => {
  it("makes the quote in three languages, each with a link ending on the date, and gives the same links again", async () => {
    const t = await setup();
    const input = {
      aircraft: { manufacturer: "Hawker", model: "850XP", category: "midsize_jet", operator: "Executive Wings", base: "Bangkok", capacity: 8, price: "USD [your price]" },
      photos: [
        { name: "exterior.jpg", bytes: await makeImage(400, 300, 1), classification: "exterior" as const },
        { name: "cabin-1.jpg", bytes: await makeImage(400, 300, 2), classification: "cabin" as const },
        { name: "cabin-2.jpg", bytes: await makeImage(400, 300, 3), classification: "cabin" as const },
        { name: "floorplan.jpg", bytes: await makeImage(400, 300, 4), classification: "floor_plan" as const },
      ],
      legs: [{ from: "VHHH", to: "VTBS", date: "2027-03-12", time: "10:00", flight: 165, pax: 4 }],
      expiresAt: new Date("2027-06-30T23:59:59Z"),
    };
    const r = await makeDemoQuote(t.db, t.store, input, new Date("2026-11-27T00:00:00Z"));
    expect(r.created).toBe(true);
    for (const [lang, token] of Object.entries(r.links)) {
      const q = await openLink(t.db, token, new Date("2026-12-01T00:00:00Z"));
      expect(q, lang).not.toBeNull();
      expect(q!.link.expiresAt?.toISOString()).toBe("2027-06-30T23:59:59.000Z");
      expect(q!.quote.options[0].photos).toHaveLength(4);
      expect(q!.quote.text).toContain("USD [your price]");
      expect(q!.quote.text).not.toContain("Executive Wings"); // operator left out
      expect(q!.broker.email).toBe("demo@aircraftmedia.my");
    }
    expect((await openLink(t.db, r.links["zh-hant"]))!.quote.lang).toBe("zh-Hant");
    expect(await openLink(t.db, r.links.en, new Date("2027-07-01T00:00:00Z"))).toBeNull(); // ended
    const again = await makeDemoQuote(t.db, t.store, input);
    expect(again).toEqual({ created: false, links: r.links });
  });
});
