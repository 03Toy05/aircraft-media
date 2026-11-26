import { beforeEach, describe, expect, it } from "vitest";
import { setup, key } from "./helpers";
import { createAircraft, createAircraftType, createOrganisation } from "../src/domain/directory";
import { converse, emptyDraft, pickQuoteOptions } from "../src/domain/toy";
import { parseQuoteRequest, typeShortNames } from "../src/domain/toyShare";
import { optionNeedsApproval, withoutOwnerApproval } from "../src/domain/quote";

let t: Awaited<ReturnType<typeof setup>>;
const sevenX: Record<string, string> = {};
let c605 = "";

beforeEach(async () => {
  t = await setup();
  const f7x = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Dassault", model: "Falcon 7X", category: "heavy_jet" })).result.aircraftTypeId;
  const cl605 = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Bombardier", model: "Challenger 605", category: "heavy_jet" })).result.aircraftTypeId;
  const lux = (await createOrganisation(t.db, t.actor, key(), { name: "Luxaviation" })).result.organisationId;
  const vista = (await createOrganisation(t.db, t.actor, key(), { name: "VistaJet" })).result.organisationId;
  for (const reg of ["OO-FSX", "F-HECD", "OO-AIE", "OO-LAH"]) {
    sevenX[reg] = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: f7x, registration: reg, operatorId: lux, info: { capacity: 14 } })).result.aircraftId;
  }
  c605 = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: cl605, registration: "9H-VCA", operatorId: vista, info: { capacity: 12 } })).result.aircraftId;
});

const ids = (href?: string) => new URL(href ?? "/", "http://x").searchParams.get("ids")?.split(",") ?? [];

describe("Toy asks which aircraft when several fit", () => {
  it("lists the four 7X, then quotes the one the broker picks, keeping the routing and price", async () => {
    const ask = await converse(t.db, t.actor.tenantId, emptyDraft("p1"), "Lux 7X quote USD 120k\nPEK-SHA 22 Dec", []);
    expect(ask.reply.say[0]).toBe("“Lux 7X” matches 4 aircraft. Which one should I quote?");
    expect(ask.reply.say[1]).toContain("1. Luxaviation · Dassault Falcon 7X · ");
    expect(ask.reply.chips.at(-1)).toEqual({ label: "All of them", send: "all" });
    expect(ask.draft.asked?.kind).toBe("quote_pick");
    expect(ask.reply.copy).toBeUndefined(); // no quote yet

    // Something else in between: the question is asked again, not forgotten.
    const again = await converse(t.db, t.actor.tenantId, ask.draft, "hmm", []);
    expect(again.reply.say[0]).toBe("Which one? Reply with its number or tail number, or “all”.");

    const done = await converse(t.db, t.actor.tenantId, again.draft, "OO-AIE", []);
    expect(ids(done.reply.link?.href)).toEqual([sevenX["OO-AIE"]]);
    expect(done.reply.copy).toContain("Price: USD 120k");
    expect(done.draft.quote?.legs?.[0]).toMatchObject({ from: "ZBAA", to: "ZSSS" });
    expect(done.draft.asked).toBeNull();

    // And the chat carries on from that quote: a price change applies to it.
    const follow = await converse(t.db, t.actor.tenantId, done.draft, "7X USD 110k", []);
    expect(follow.reply.copy).toContain("Price: USD 110k");
  });

  it("takes a number, two of them, or all", async () => {
    const ask = await converse(t.db, t.actor.tenantId, emptyDraft("p2"), "Lux 7X quote", []);
    const order = ask.draft.asked?.kind === "quote_pick" ? ask.draft.asked.options.map((o) => o.id) : [];
    expect(ids((await converse(t.db, t.actor.tenantId, ask.draft, "2", [])).reply.link?.href)).toEqual([order[1]]);
    expect(ids((await converse(t.db, t.actor.tenantId, ask.draft, "1 and 3", [])).reply.link?.href)).toEqual([order[0], order[2]]);
    expect(ids((await converse(t.db, t.actor.tenantId, ask.draft, "all", [])).reply.link?.href)).toHaveLength(4);
    // "all Lux 7X" in the request itself doesn't ask.
    expect(ids((await converse(t.db, t.actor.tenantId, emptyDraft("p3"), "Quote all Lux 7X", [])).reply.link?.href)).toHaveLength(4);
  });

  it("starts over when the answer is a new request", async () => {
    const ask = await converse(t.db, t.actor.tenantId, emptyDraft("p4"), "Lux 7X quote", []);
    const other = await converse(t.db, t.actor.tenantId, ask.draft, "Vista CL605 quote", []);
    expect(ids(other.reply.link?.href)).toEqual([c605]);
  });

  it("understands type short names: Vista CL605", async () => {
    const r = await converse(t.db, t.actor.tenantId, emptyDraft("p5"), "Vista CL605 quote", []);
    expect(ids(r.reply.link?.href)).toEqual([c605]);
    expect(typeShortNames("CL605")).toEqual(["challenger605"]);
    expect(typeShortNames("F7X")).toEqual(["falcon7x"]);
    expect(typeShortNames("G7500")).toEqual(["global7500"]);
    expect(typeShortNames("G650")).toEqual([]);
  });

  it("says which word matched nothing", async () => {
    const r = await converse(t.db, t.actor.tenantId, emptyDraft("p6"), "Skyjet CL605 quote", []);
    expect(r.reply.say).toContain("Nothing in your fleet or the library matches “Skyjet”. Add the aircraft first, or check the spelling.");
  });

  it("reads answers by tail, part of a tail, or name", () => {
    const opts = [{ id: "a", name: "Luxaviation · Dassault Falcon 7X · OO-FSX" }, { id: "b", name: "Luxaviation · Dassault Falcon 7X · F-HECD" }];
    expect(pickQuoteOptions("FSX", opts)).toEqual(["a"]);
    expect(pickQuoteOptions("OO-FSX and F-HECD", opts)).toEqual(["a", "b"]);
    expect(pickQuoteOptions("全部", opts)).toEqual(["a", "b"]);
    expect(pickQuoteOptions("7X", opts)).toBeNull(); // still both
    expect(pickQuoteOptions("5", opts)).toBeNull();
  });
});

describe("Owner's approval in a quote", () => {
  it("reads a Note line as that option's note, not another aircraft", () => {
    const r = parseQuoteRequest("Quote\nLeg 1 – Date: 12.12 | From: hkg | To: pek | Time:  | Pax: 8\nOption 1 – Operator: vista | Aircraft: cl605 | Price: USD 80k\nOption 2 – Operator: phenix | Aircraft: global 7500 | Price: usd 200k\nnote: subject to owner's approval\nClosing: price excludes VIP catering");
    expect(r?.what).toEqual(["vista cl605", "phenix global 7500"]);
    expect(r?.notes).toEqual(["", "subject to owner's approval"]);
    expect(parseQuoteRequest("Quote\nOption 1 – Operator: lux | Aircraft: 7X | Price: USD 1 | Note: owner's approval required")?.notes).toEqual(["owner's approval required"]);
    expect(parseQuoteRequest("Lux 7X quote\nSubject to owner's approval")?.notes).toEqual(["Subject to owner's approval"]);
  });

  it("puts the note under that aircraft, with the sticker on the PDF, link and Quote page", async () => {
    const r = await converse(t.db, t.actor.tenantId, emptyDraft("oa"), "Quote\nOption 1 – Operator: lux | Aircraft: OO-FSX | Price: USD 90k\nnote: subject to owner's approval", []);
    expect(r.reply.copy).toContain("subject to owner's approval");
    expect(r.reply.say.join(" ")).not.toContain("couldn't find");
    expect(JSON.parse(new URL(r.reply.link!.href, "http://x").searchParams.get("extras")!)).toEqual({ [sevenX["OO-FSX"]]: "subject to owner's approval" });
    expect(optionNeedsApproval({ notes: null, extra: "subject to owner's approval" })).toBe(true);
    expect(optionNeedsApproval({ notes: null, extra: "需經機主批准" })).toBe(true);
    expect(optionNeedsApproval({ notes: null, extra: "From 12 Dec" })).toBe(false);
    expect(withoutOwnerApproval("From 12 Dec · Owner's approval required")).toBe("From 12 Dec");
  });
});
