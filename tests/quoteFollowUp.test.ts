import { beforeEach, describe, expect, it } from "vitest";
import { setup, key } from "./helpers";
import { addOrganisationAlias, createAircraft, createAircraftType, createOrganisation, getAircraftCard, listInformationVersions } from "../src/domain/directory";
import { matchAircraft } from "../src/domain/quoteCommands";
import { changeAircraftFields } from "../src/domain/chat";
import { converse, emptyDraft, type Draft } from "../src/domain/chocks";
import { parseQuoteFollowUp } from "../src/domain/chocksQuoteEdit";

let t: Awaited<ReturnType<typeof setup>>;
let c605: string;
let g280: string;
let vista: string;
beforeEach(async () => {
  t = await setup();
  const t605 = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Bombardier", model: "Challenger 605", category: "heavy_jet" })).result.aircraftTypeId;
  const t280 = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G280", category: "super_midsize_jet" })).result.aircraftTypeId;
  vista = (await createOrganisation(t.db, t.actor, key(), { name: "Vista Jet" })).result.organisationId;
  c605 = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: t605, registration: "9H-VCA", operatorId: vista, info: { yom: 2015, capacity: 12 } })).result.aircraftId;
  g280 = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: t280, registration: "B-LUX", info: { yom: 2018 } })).result.aircraftId;
});

const say = (turn: { reply: { say: string[] } }) => turn.reply.say.join("\n");
async function quoted(): Promise<Draft> {
  const turn = await converse(t.db, t.actor.tenantId, emptyDraft("q"), "quote for Vista 605 and G280", []);
  expect(turn.draft.quote?.ids).toEqual([c605, g280]);
  return turn.draft;
}

describe("Toy: changes after a quote", () => {
  const list = () => [
    { id: "a", type: "Bombardier Challenger 605", tail: "9H-VCA", operator: "Vista Jet" },
    { id: "b", type: "Gulfstream G280", tail: "B-LUX", operator: null },
  ];

  it("reads prices and record changes against the quote's aircraft", () => {
    expect(parseQuoteFollowUp("For 605, price is USD 70k. For G280, price is EUR 60k", list())).toEqual({ prices: { a: "USD 70k", b: "EUR 60k" }, edits: [], unclear: [] });
    expect(parseQuoteFollowUp("605 USD 70,000, G280 EUR 1.2m", list())?.prices).toEqual({ a: "USD 70,000", b: "EUR 1.2m" });
    expect(parseQuoteFollowUp("No.\nFor Vista 605, the YOM shall be 2016. Change it", list())).toEqual({ prices: {}, edits: [{ id: "a", field: "yom", value: 2016 }], unclear: [] });
    expect(parseQuoteFollowUp("G280 capacity 9", list())?.edits).toEqual([{ id: "b", field: "capacity", value: 9 }]);
    expect(parseQuoteFollowUp("G280 YOR to 2022", list())?.edits).toEqual([{ id: "b", field: "yor", value: 2022 }]);
    // No aircraft named while the quote has two: asked which one.
    expect(parseQuoteFollowUp("price is USD 70k", list())?.unclear).toEqual(["price is USD 70k"]);
    // Questions and unrelated messages are left for the rest of Toy.
    expect(parseQuoteFollowUp("what is the YOM of the 605?", list())).toBeNull();
    expect(parseQuoteFollowUp("send the G280 to Mr Chan", list())).toBeNull();
  });

  it("puts typed prices into the quote shown in the chat", async () => {
    const d = await quoted();
    const turn = await converse(t.db, t.actor.tenantId, d, "For 605, price is USD 70k. For G280, price is EUR 60k", []);
    expect(turn.draft.quote?.prices).toEqual({ [c605]: "USD 70k", [g280]: "EUR 60k" });
    expect(turn.reply.copy).toMatch(/USD 70k/);
    expect(turn.reply.copy).toMatch(/EUR 60k/);
    expect(turn.reply.options?.length).toBe(2);
    expect(new URLSearchParams(turn.reply.link!.href.split("?")[1]).get("prices")).toContain("USD 70k");
    // A later change keeps the other price.
    const again = await converse(t.db, t.actor.tenantId, turn.draft, "G280 EUR 55k", []);
    expect(again.draft.quote?.prices).toEqual({ [c605]: "USD 70k", [g280]: "EUR 55k" });
  });

  it("changes an aircraft's record after a yes, and shows the quote again with it", async () => {
    const d = await quoted();
    const ask = await converse(t.db, t.actor.tenantId, d, "No.\nFor Vista 605, the YOM shall be 2016. Change it", []);
    expect(say(ask)).toMatch(/YOM 2015 → 2016/);
    expect(ask.reply.chips.map((c) => c.send)).toEqual(["Yes", "No"]);
    expect((await getAircraftCard(t.db, c605))!.yom).toBe(2015); // nothing saved yet

    const yes = await converse(t.db, t.actor.tenantId, ask.draft, "Yes", []);
    expect(yes.edits).toEqual([{ aircraftId: c605, label: "Vista Jet · Bombardier Challenger 605 · 9H-VCA", field: "yom", from: 2015, to: 2016 }]);
    await changeAircraftFields(t.db, t.actor, key(), c605, { yom: 2016 });
    const card = (await getAircraftCard(t.db, c605))!;
    expect(card).toMatchObject({ yom: 2016, capacity: 12 }); // only the named field changes
    expect((await listInformationVersions(t.db, c605)).length).toBe(2); // the old value stays in the history

    const no = await converse(t.db, t.actor.tenantId, ask.draft, "No", []);
    expect(no.edits).toBeUndefined();
    expect(say(no)).toMatch(/left the record/);
  });

  it("says so when the value is already there or does not look like a year", async () => {
    const d = await quoted();
    expect(say(await converse(t.db, t.actor.tenantId, d, "605 YOM 2015", []))).toMatch(/already has YOM 2015/);
    expect(say(await converse(t.db, t.actor.tenantId, d, "605 YOM 1800", []))).toMatch(/doesn't look right/);
  });

  it("finds aircraft by the operator's other names ('VJ' for Vista Jet)", async () => {
    await addOrganisationAlias(t.db, t.actor, key(), { organisationId: vista, alias: "VJ" });
    const turn = await converse(t.db, t.actor.tenantId, emptyDraft("q"), "quote for VJ 605", []);
    expect(turn.draft.quote?.ids).toEqual([c605]);
    const both = await converse(t.db, t.actor.tenantId, turn.draft, "quote for VJ 605 and G280", []);
    const priced = await converse(t.db, t.actor.tenantId, both.draft, "VJ 605 USD 70k", []);
    expect(priced.draft.quote?.prices).toEqual({ [c605]: "USD 70k" });
    expect(matchAircraft([{ id: "a", type: "Bombardier Challenger 605", tail: null, operator: "Vista Jet", aliases: ["VJ"] }], "VJ 605").map((a) => a.id)).toEqual(["a"]);
  });
});
