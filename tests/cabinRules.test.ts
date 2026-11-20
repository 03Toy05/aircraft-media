import { describe, expect, it } from "vitest";
import { setup, key } from "./helpers";
import { addInformationVersion, createAircraft, createAircraftType, getAircraftCard } from "../src/domain/directory";
import { formatAircraftCard, parseAircraftCard } from "../src/domain/card";
import { buildQuote } from "../src/domain/quote";
import { applyChatProposal } from "../src/domain/chat";
import { quoteShareStats, recordQuoteShare } from "../src/domain/quoteShares";

describe("Smoking, pets and cleaning fee", () => {
  it("reads them from a card, in English and Chinese", () => {
    const c = parseAircraftCard("Aircraft: G280\nSmoking: No\nPets: Yes, cleaning fee USD 500");
    expect([c.smoking, c.pets, c.cleaningFee]).toEqual(["no", "yes", "USD 500"]);
    const z = parseAircraftCard("機型：G280\n吸煙：禁止\n寵物：可以\n清潔費：HKD 3,000");
    expect([z.smoking, z.pets, z.cleaningFee]).toEqual(["no", "yes", "HKD 3,000"]);
  });

  it("saves them, shows them on the card and in the quote, and keeps them when the chat updates other details", async () => {
    const t = await setup();
    const g280 = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G280", category: "super_midsize_jet" })).result.aircraftTypeId;
    const id = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g280, registration: "B-SMK", info: { yom: 2015 } })).result.aircraftId;
    await addInformationVersion(t.db, t.actor, key(), { aircraftId: id, expectedVersion: 1, info: { yom: 2015, smoking: "no", pets: "yes", cleaningFee: "USD 500" } });
    const card = (await getAircraftCard(t.db, id))!;
    expect([card.smoking, card.pets, card.cleaningFee]).toEqual(["no", "yes", "USD 500"]);
    expect(formatAircraftCard(card)).toContain("Smoking: No\nPets: Yes\nCleaning fee: USD 500");

    const q = buildQuote([{ type: card.aircraft, yom: card.yom, yor: null, capacity: null, wifi: "unknown", smoking: card.smoking, pets: card.pets, cleaningFee: card.cleaningFee }], { language: "en" });
    expect(q).toContain("Smoking: Not allowed\nPets: Allowed\nCleaning fee: USD 500");
    const zh = buildQuote([{ type: card.aircraft, yom: null, yor: null, capacity: null, wifi: "unknown", smoking: "yes" }], { language: "zh-Hant" });
    expect(zh).toContain("吸煙：可以");
    expect(zh).not.toContain("寵物"); // unknown: no line

    // A chat update that only changes the YOM must not reset smoking, pets or the fee.
    await applyChatProposal(t.db, t.actor, key(), { mediaIds: [], classifications: {}, aircraft: { mode: "existing", aircraftId: id }, info: { yom: 2016, yor: null, capacity: null, wifiStatus: "unknown", notes: null } });
    const after = (await getAircraftCard(t.db, id))!;
    expect([after.yom, after.smoking, after.pets, after.cleaningFee]).toEqual([2016, "no", "yes", "USD 500"]);
  });
});

describe("Quotes shared out", () => {
  it("counts each quote once, however many times it is shared", async () => {
    const t = await setup();
    await recordQuoteShare(t.db, t.actor, { quoteKey: "q1", how: "share", options: 2 });
    await recordQuoteShare(t.db, t.actor, { quoteKey: "q1", how: "share", options: 2 }); // option 2 of the same quote
    await recordQuoteShare(t.db, t.actor, { quoteKey: "q2", how: "copy", options: 1 });
    const s = (await quoteShareStats(t.db)).get(t.actor.tenantId)!;
    expect([s.quotes, s.last30]).toEqual([2, 2]);
    expect(s.lastAt).toBeInstanceOf(Date);
  });
});
