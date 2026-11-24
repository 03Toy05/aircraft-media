import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setup, key, makeImage } from "./helpers";
import { createAircraft, createAircraftType, createOrganisation, getAircraftCard, listInformationVersions, setOrganisationRegion, getOrganisationBase, renameOrganisation, resolveOrganisationsExact } from "../src/domain/directory";
import { ingestUpload } from "../src/domain/media";
import { applyChatProposal, matchCard } from "../src/domain/chat";
import { converse, emptyDraft, type Draft, type DraftPhoto } from "../src/domain/toy";
import { formatAircraftCard, parseAircraftCard } from "../src/domain/card";
import { aircraftMedia, organisations } from "../src/db/schema";
import { contactLink, createContact, findContacts } from "../src/domain/contacts";
import { parseQuoteRequest, parseShareRequest } from "../src/domain/toyShare";
import { QUOTE_LANGUAGES, QUOTE_WORDS, buildQuote, buildQuoteParts, defaultQuoteTemplate, validateQuoteTemplate } from "../src/domain/quote";
import { getQuoteTemplates, resetQuoteTemplate, saveQuoteTemplate } from "../src/domain/quoteTemplates";

let t: Awaited<ReturnType<typeof setup>>;
let g280: string;
beforeEach(async () => {
  t = await setup();
  g280 = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G280", category: "super_midsize_jet" })).result.aircraftTypeId;
});

const photo = async (name: string, seed: number) => (await ingestUpload(t.db, t.store, t.actor, { filename: name, bytes: await makeImage(400, 300, seed) })).result.mediaId;
const base = { info: { yom: 2025, yor: null, capacity: 10, wifiStatus: "unknown" as const, notes: null } };

describe("Quick add: reading the message", () => {
  it("reads labelled lines with or without a colon", () => {
    const p = parseAircraftCard("Operator: Advanced Aviation\nAircraft type: Gulfstream G280\nYOM 2025\nCapacity 10\nTail number B-KXX");
    expect(p).toMatchObject({ operator: "Advanced Aviation", aircraft: "Gulfstream G280", yom: 2025, capacity: 10, tail: "B-KXX" });
    expect(p.unrecognised).toEqual([]);
  });

}); 

describe("Review: card text with a starred note", () => {
  it("reads the star line as a note and offers the remaining name as the operator", async () => {
    const p = parseAircraftCard(["Tag Aviation", "2017", "15 seats", "*subject to owner's approval"].join("\n"));
    expect(p).toMatchObject({ yom: 2017, capacity: 15, notes: "subject to owner's approval" });
    expect(p.unrecognised).toEqual(["Tag Aviation"]);
    const m = await matchCard(t.db, t.actor.tenantId, p);
    expect(m.operatorText).toBe("Tag Aviation");
    expect(m.leftover).toEqual([]);
  });
});

describe("Quick add: confirm", () => {
  it("creates operator and aircraft, classifies from the choice, and approves the photo as this aircraft", async () => {
    const mediaId = await photo("G280 Int 1.png", 1);
    const r = await applyChatProposal(t.db, t.actor, key(), {
      ...base,
      mediaIds: [mediaId],
      classifications: { [mediaId]: "cabin" },
      newOperatorName: "Advanced Aviation",
      aircraftTypeId: g280,
      aircraft: { mode: "new", registration: "B-KXX" },
    });
    expect(r.aircraftId).toBeTruthy();
    expect(r.photos[0].outcome).toBe("approved");
    const card = await getAircraftCard(t.db, r.aircraftId!);
    expect(card).toMatchObject({ tailNumber: "B-KXX", operator: "Advanced Aviation", yom: 2025, capacity: 10 });
    const [m] = await t.db.select().from(aircraftMedia).where(eq(aircraftMedia.id, mediaId));
    expect(m).toMatchObject({ reviewState: "approved", primaryClassification: "cabin", associationStatus: "actual_aircraft" });
  });

  it("without a tail the photo represents the type; without a view it stays in review", async () => {
    const a = await photo("cabin.png", 2);
    const b = await photo("IMG_1.png", 3);
    const r = await applyChatProposal(t.db, t.actor, key(), {
      ...base,
      mediaIds: [a, b],
      classifications: { [a]: "cabin", [b]: "unclassified" },
      aircraftTypeId: g280,
      aircraft: { mode: "none" },
    });
    expect(r.photos.map((p) => p.outcome)).toEqual(["approved", "left_in_review"]);
    const [ma] = await t.db.select().from(aircraftMedia).where(eq(aircraftMedia.id, a));
    expect(ma.associationStatus).toBe("representative_type");
  });

  it("reports a failed step and still handles the rest; confirming twice creates nothing twice", async () => {
    await createOrganisation(t.db, t.actor, key(), { name: "Advanced Aviation" });
    const mediaId = await photo("G280 Int 2.png", 4);
    const input = {
      ...base,
      mediaIds: [mediaId],
      classifications: { [mediaId]: "cabin" as const },
      newOperatorName: "Advanced Aviation", // already exists: not created, aircraft still made
      aircraftTypeId: g280,
      aircraft: { mode: "new" as const, registration: "B-KYY" },
    };
    const k = key();
    const first = await applyChatProposal(t.db, t.actor, k, input);
    expect(first.steps.some((s) => /Operator not created/.test(s))).toBe(true);
    expect(first.aircraftId).toBeTruthy();
    const again = await applyChatProposal(t.db, t.actor, k, input);
    expect(again.aircraftId).toBe(first.aircraftId);
  });
});

const fakePhoto = (name: string, classification: DraftPhoto["classification"] = "cabin"): DraftPhoto => ({ mediaId: `m-${name}`, name, contentVersionId: null, classification });
const say = (r: { reply: { say: string[] } }) => r.reply.say.join(" ");

describe("Existing aircraft: update what was provided", () => {
  it("saves only the given details as a new version and leaves the rest alone", async () => {
    const org = (await createOrganisation(t.db, t.actor, key(), { name: "Metrojet" })).result.organisationId;
    const id = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g280, registration: "B-KXX", info: { yom: 2018, capacity: 13, wifiStatus: "yes", notes: "VIP" } })).result.aircraftId;
    const r = await applyChatProposal(t.db, t.actor, key(), {
      mediaIds: [], classifications: {}, operatorId: org, aircraftTypeId: g280, aircraft: { mode: "existing", aircraftId: id },
      info: { yom: null, yor: null, capacity: 10, wifiStatus: "unknown", notes: null },
    });
    expect(r.steps.join(" ")).toMatch(/capacity/);
    expect(await getAircraftCard(t.db, id)).toMatchObject({ yom: 2018, capacity: 10, wifi: "yes", notes: "VIP", operator: "Metrojet" });
    expect((await listInformationVersions(t.db, id)).map((v) => v.capacity)).toEqual([13, 10]); // history kept
    const again = await applyChatProposal(t.db, t.actor, key(), {
      mediaIds: [], classifications: {}, aircraftTypeId: g280, aircraft: { mode: "existing", aircraftId: id },
      info: { yom: null, yor: null, capacity: 10, wifiStatus: "unknown", notes: null },
    });
    expect(again.steps).toEqual([]);
  });
});

describe("No tail number needed", () => {
  it("adds an operator on its own", async () => {
    let r = await converse(t.db, t.actor.tenantId, emptyDraft("n1"), "Operator: Advanced Aviation", []);
    r = await converse(t.db, t.actor.tenantId, r.draft, "new", []);
    expect(r.reply.ready).toBe(true);
    expect(r.draft.aircraft.kind).toBe("none");
    const applied = await applyChatProposal(t.db, t.actor, "n1", {
      ...base, mediaIds: [], classifications: {}, newOperatorName: "Advanced Aviation", aircraft: { mode: "none" },
    });
    expect(applied.steps.join(" ")).toMatch(/Operator “Advanced Aviation” created/);
  });

  it("creates an aircraft for an operator without a tail, and finds it again next time", async () => {
    const org = (await createOrganisation(t.db, t.actor, key(), { name: "Advanced Aviation" })).result.organisationId;
    let r = await converse(t.db, t.actor.tenantId, emptyDraft("n2"), ["Operator: Advanced Aviation", "Aircraft type: G280", "YOM: 2025", "Capacity: 10"].join("\n"), []);
    expect(r.draft.aircraft).toEqual({ kind: "new", distinct: false });
    expect(say(r)).toMatch(/without one|without a tail/);
    const applied = await applyChatProposal(t.db, t.actor, "n2", {
      ...base, mediaIds: [], classifications: {}, operatorId: org, aircraftTypeId: g280, aircraft: { mode: "new", registration: "" },
    });
    expect(applied.aircraftId).toBeTruthy();
    expect(await getAircraftCard(t.db, applied.aircraftId!)).toMatchObject({ tailNumber: null, operator: "Advanced Aviation", yom: 2025 });
    // second time the same operator + type: Toy asks whether it is the aircraft it already has
    r = await converse(t.db, t.actor.tenantId, emptyDraft("n3"), ["Operator: Advanced Aviation", "Aircraft type: G280"].join("\n"), [fakePhoto("b.png")]);
    expect(r.draft.asked).toMatchObject({ kind: "tail", noTail: true });
    r = await converse(t.db, t.actor.tenantId, r.draft, "Same aircraft", []);
    expect(r.draft.aircraft).toMatchObject({ kind: "existing", id: applied.aircraftId });
  });

  it("photos with a type but no operator, tail or details stay representative of the type", async () => {
    const r = await converse(t.db, t.actor.tenantId, emptyDraft("n4"), "Aircraft type: G280", [fakePhoto("c.png")]);
    expect(r.draft.aircraft.kind).toBe("none");
    expect(r.reply.ready).toBe(true);
  });
});

describe("Toy conversation", () => {
  it("asks about an unknown operator, explains when the user is unsure, and carries on after 'new'", async () => {
    let d: Draft = emptyDraft("k1");
    let r = await converse(t.db, t.actor.tenantId, d, ["Operator: Advanced Aviation", "Aircraft type: G280", "Tail number: B-KXX"].join("\n"), [fakePhoto("G280 Int 1.png")]);
    expect(r.draft.asked?.kind).toBe("operator");
    expect(say(r)).toMatch(/isn't one of them/);
    expect(r.reply.chips.map((c) => c.label)).toContain("Yes, create “Advanced Aviation”");

    r = await converse(t.db, t.actor.tenantId, r.draft, "I don't know", []);
    expect(r.draft.asked?.kind).toBe("operator"); // still waiting, but now with a recommendation
    expect(say(r)).toMatch(/most likely a new operator/);

    r = await converse(t.db, t.actor.tenantId, r.draft, "new", []);
    expect(r.draft.operator.kind).toBe("new");
    expect(r.draft.typeLabel).toBe("Gulfstream G280"); // matched by the alias "G280"
    expect(r.draft.aircraft.kind).toBe("new"); // B-KXX is not in the directory
    expect(r.reply.ready).toBe(true);
    expect(say(r)).toMatch(/isn't in your directory yet/);

    const done = await converse(t.db, t.actor.tenantId, r.draft, "Confirm", []);
    expect(done.confirm).toBe(true);
  });

  it("offers a similar existing operator and remembers the new spelling as an alias", async () => {
    const org = (await createOrganisation(t.db, t.actor, key(), { name: "Advanced Aviation Services" })).result.organisationId;
    let r = await converse(t.db, t.actor.tenantId, emptyDraft("k2"), ["Operator: Advanced Aviation", "Aircraft type: G280"].join("\n"), [fakePhoto("a.png")]);
    expect(say(r)).toMatch(/Advanced Aviation Services/);
    r = await converse(t.db, t.actor.tenantId, r.draft, "Same as #1", []);
    expect(r.draft.operator).toMatchObject({ kind: "alias_of", id: org });
  });

  it("checks whether the tail exists and keeps the answer in context", async () => {
    const aid = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g280, registration: "B-KXX" })).result.aircraftId;
    let r = await converse(t.db, t.actor.tenantId, emptyDraft("k3"), ["Aircraft type: G280", "Tail number: B-KXX"].join("\n"), [fakePhoto("a.png")]);
    expect(r.draft.asked?.kind).toBe("tail");
    expect(say(r)).toMatch(/already in your directory/);
    const same = await converse(t.db, t.actor.tenantId, r.draft, "Same aircraft", []);
    expect(same.draft.aircraft).toMatchObject({ kind: "existing", id: aid });
    const diff = await converse(t.db, t.actor.tenantId, r.draft, "Different aircraft", []);
    expect(diff.draft.aircraft).toEqual({ kind: "new", distinct: true });
  });

  it("asks for the view of a photo with no hint, and reads a dictated single line", async () => {
    let r = await converse(t.db, t.actor.tenantId, emptyDraft("k4"), "operator Metrojet aircraft type G280 capacity 10", [fakePhoto("IMG_1.png", "unclassified")]);
    expect(r.draft).toMatchObject({ capacity: 10, operatorText: "Metrojet", aircraftText: "G280" });
    r = await converse(t.db, t.actor.tenantId, r.draft, "new", []);
    expect(r.draft.asked).toMatchObject({ kind: "classify" }); // operator settled, now the photo with no hint
    r = await converse(t.db, t.actor.tenantId, r.draft, "all cabin", []);
    expect(r.draft.photos[0].classification).toBe("cabin");
    expect(r.reply.ready).toBe(true);
  });

  it("understands plain lines with no labels: a type name is the type, the other name is the operator", async () => {
    const r = await converse(t.db, t.actor.tenantId, emptyDraft("u1"), ["Advance aviation", "G280"].join("\n"), [fakePhoto("G280 Int 1.png"), fakePhoto("G280 Ext 1.png", "exterior")]);
    expect(r.draft).toMatchObject({ operatorText: "Advance aviation", aircraftText: "G280" });
    expect(say(r)).not.toMatch(/didn't understand/);
    expect(r.draft.asked?.kind).toBe("operator"); // unknown name: asks new or same as another
    const next = await converse(t.db, t.actor.tenantId, r.draft, "new", []);
    expect(next.draft.typeLabel).toBe("Gulfstream G280");
    expect(next.reply.ready).toBe(true);
    // order does not matter
    const flipped = await converse(t.db, t.actor.tenantId, emptyDraft("u2"), ["G280", "Advance aviation"].join("\n"), []);
    expect(flipped.draft).toMatchObject({ operatorText: "Advance aviation", aircraftText: "G280" });
  });

  it("reads value-first lines and a confirmation sent together with changes", async () => {
    let r = await converse(t.db, t.actor.tenantId, emptyDraft("v1"), ["CapaJet", "Gulfstream G280", "2013 YOM", "2020 YOR", "16 seats"].join("\n"), []);
    expect(r.draft).toMatchObject({ yom: 2013, yor: 2020, capacity: 16, operatorText: "CapaJet" });
    expect(say(r)).not.toMatch(/didn't understand/);
    r = await converse(t.db, t.actor.tenantId, r.draft, "new", []);
    expect(r.reply.ready).toBe(true);
    r = await converse(t.db, t.actor.tenantId, r.draft, ["YOM 2014", "Confirm"].join("\n"), []);
    expect(r.confirm).toBe(true);
    expect(r.draft.yom).toBe(2014);
  });

  it("confirms however it is typed: alone, with a polite word, or after a change", async () => {
    const ready = async () => {
      const r = await converse(t.db, t.actor.tenantId, emptyDraft("c" + Math.random()), ["CapaJet", "Gulfstream G280"].join("\n"), []);
      return (await converse(t.db, t.actor.tenantId, r.draft, "new", [])).draft;
    };
    for (const typed of ["confirm", "Confirm.", "yes please", "Confirm please", "ok"]) {
      expect((await converse(t.db, t.actor.tenantId, await ready(), typed, [])).confirm, typed).toBe(true);
    }
    const withChange = await converse(t.db, t.actor.tenantId, await ready(), "Capacity: 12, confirm", []);
    expect(withChange.confirm).toBe(true);
    expect(withChange.draft.capacity).toBe(12);
  });

  it("starts over on request", async () => {
    const r = await converse(t.db, t.actor.tenantId, emptyDraft("k5"), "Operator: X", []);
    const c = await converse(t.db, t.actor.tenantId, r.draft, "cancel", []);
    expect(c.draft.operatorText).toBe("");
  });
});

describe("Contacts and sending to a person", () => {
  it("builds the right link per messenger", () => {
    expect(contactLink("whatsapp", "+852 9123 4567", "Hi there")).toEqual({ url: "https://wa.me/85291234567?text=Hi%20there", copyFirst: false, newTab: true });
    expect(contactLink("imessage", "+852 9123 4567", "Hi").url).toBe("sms:+85291234567&body=Hi");
    expect(contactLink("telegram", "@chan", "Hi")).toMatchObject({ url: "https://t.me/chan", copyFirst: true });
    expect(contactLink("wechat", null, "Hi")).toMatchObject({ copyFirst: true });
  });

  it("finds contacts by name with or without a title and rejects duplicates", async () => {
    await createContact(t.db, t.actor, key(), { name: "Mr Chan", app: "whatsapp", handle: "+85291234567" });
    expect((await findContacts(t.db, t.actor.tenantId, "chan")).map((c) => c.name)).toEqual(["Mr Chan"]);
    expect((await findContacts(t.db, t.actor.tenantId, "Mr Chan")).length).toBe(1);
    await expect(createContact(t.db, t.actor, key(), { name: "mr chan", app: "line" })).rejects.toThrow(/already have/);
    await expect(createContact(t.db, t.actor, key(), { name: "X", app: "carrier-pigeon" })).rejects.toThrow(/Unknown messenger/);
  });

  it("reads 'send the G280 photos to Mr Chan'", () => {
    expect(parseShareRequest("send the G280 photos to Mr Chan")).toEqual({ what: "G280", who: "Mr Chan" });
    expect(parseShareRequest("Please share B-KXX card with Chan.")).toEqual({ what: "B-KXX", who: "Chan" });
    expect(parseShareRequest("Operator: Metrojet")).toBeNull();
  });

  it("Toy prepares the message for a saved contact and asks when the aircraft is ambiguous", async () => {
    const org = (await createOrganisation(t.db, t.actor, key(), { name: "Metrojet", region: "Asia" })).result.organisationId;
    const c = (await createContact(t.db, t.actor, key(), { name: "Mr Chan", app: "whatsapp", handle: "+85291234567" })).result.contactId;
    await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g280, registration: "B-AAA", operatorId: org });
    const turn = await converse(t.db, t.actor.tenantId, emptyDraft("s1"), "send the G280 photos to Mr Chan", []);
    expect(turn.reply.share).toMatchObject({ contactId: c });
    const none = await converse(t.db, t.actor.tenantId, emptyDraft("s2"), "send the G280 to Nobody", []);
    expect(none.reply.say.join(" ")).toMatch(/don't have a contact/);
    await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g280, registration: "B-BBB", operatorId: org });
    const amb = await converse(t.db, t.actor.tenantId, emptyDraft("s3"), "send the G280 to Mr Chan", []);
    expect(amb.draft.asked?.kind).toBe("share_aircraft");
    const picked = await converse(t.db, t.actor.tenantId, amb.draft, "Use #2", []);
    expect(picked.reply.share).toBeDefined();
  });

  it("saves an operator's region", async () => {
    const org = (await createOrganisation(t.db, t.actor, key(), { name: "Metrojet" })).result.organisationId;
    await setOrganisationRegion(t.db, t.actor, key(), { organisationId: org, region: " Asia " });
    const [o] = await t.db.select().from(organisations).where(eq(organisations.id, org));
    expect(o.region).toBe("Asia");
  });
});

describe("Region from the card", () => {
  it("reads Region and saves it on a new and on an existing operator", async () => {
    expect(parseAircraftCard("Operator: Metrojet\nRegion: Asia")).toMatchObject({ operator: "Metrojet", region: "Asia" });
    const r = await applyChatProposal(t.db, t.actor, "k-region", { mediaIds: [], classifications: {}, newOperatorName: "Metrojet", region: "Asia", aircraftTypeId: g280, aircraft: { mode: "none" }, ...base });
    expect(r.steps.join(" ")).toMatch(/created/);
    const [o] = await t.db.select().from(organisations).where(eq(organisations.canonicalName, "Metrojet"));
    expect(o.region).toBe("Asia");
    await applyChatProposal(t.db, t.actor, "k-region2", { mediaIds: [], classifications: {}, operatorId: o.id, region: "Middle East", aircraftTypeId: g280, aircraft: { mode: "none" }, ...base });
    const [o2] = await t.db.select().from(organisations).where(eq(organisations.id, o.id));
    expect(o2.region).toBe("Middle East");
  });
});

describe("Operator base", () => {
  it("stores a usual base on the operator and reads it back as locations", async () => {
    const org = (await createOrganisation(t.db, t.actor, key(), { name: "Deer Jet", region: "Asia", base: "Hong Kong, Singapore" })).result.organisationId;
    expect(await getOrganisationBase(t.db, t.actor.tenantId, org)).toEqual(["Hong Kong", "Singapore"]);
    await setOrganisationRegion(t.db, t.actor, key(), { organisationId: org, region: "Asia", base: "Macau" });
    expect(await getOrganisationBase(t.db, t.actor.tenantId, org)).toEqual(["Macau"]);
  });
});

describe("Questions about what you already have", () => {
  it("answers 'what aircraft does Capa Jet have?' without treating the sentence as a new operator, even with a typo or a space", async () => {
    const org = (await createOrganisation(t.db, t.actor, key(), { name: "CapaJet", region: "Asia" })).result.organisationId;
    await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g280, registration: "B-CAP", operatorId: org, info: { yom: 2013, yor: null, capacity: 16, wifiStatus: "unknown", notes: null } });
    for (const q of ["Can you show me what aircraft Capa Jet has?", "show me what aircraft capajet has", "what does capacjet have?", "what does B-CAP have?"]) {
      const turn = await converse(t.db, t.actor.tenantId, emptyDraft("s"), q, []);
      expect(turn.draft.asked, q).toBeNull();
      expect(turn.reply.say.join("\n"), q).toMatch(/G280.*B-CAP|B-CAP.*G280/);
      expect(turn.reply.say.join("\n"), q).toMatch(/16 seats/);
    }
    const none = await converse(t.db, t.actor.tenantId, emptyDraft("s"), "what does Zebra Air have?", []);
    expect(none.reply.say.join(" ")).toMatch(/couldn't match/);
    expect(none.draft.operatorText).toBe("");
  });
});

describe("Toy runs the Operators & aircraft filters and sorting", () => {
  async function fleet() {
    const heavy = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G650", category: "heavy_jet" })).result.aircraftTypeId;
    const asia = (await createOrganisation(t.db, t.actor, key(), { name: "Metrojet", region: "Asia" })).result.organisationId;
    const eu = (await createOrganisation(t.db, t.actor, key(), { name: "Euro Air", region: "Europe" })).result.organisationId;
    const mk = (type: string, tail: string, operatorId: string, yom: number, yor: number | null, capacity: number, wifiStatus: "yes" | "no" | "unknown", loc: string | null) =>
      createAircraft(t.db, t.actor, key(), { aircraftTypeId: type, registration: tail, operatorId, base: loc ? { mode: "based", locations: [loc] } : { mode: "floating", locations: [] }, info: { yom, yor, capacity, wifiStatus, notes: null } });
    await mk(heavy, "B-HVY", asia, 2015, 2022, 14, "yes", "Hong Kong");
    await mk(g280, "B-MID", asia, 2020, null, 10, "no", "Singapore");
    await mk(heavy, "G-EUR", eu, 2010, 2019, 16, "unknown", null);
  }
  const ask = (q: string) => converse(t.db, t.actor.tenantId, emptyDraft("s"), q, []);

  it("filters by region, category, base and wifi, and says what it applied", async () => {
    await fleet();
    let r = (await ask("show me aircraft in Asia")).reply;
    expect(r.say.join("\n")).toMatch(/B-HVY/); expect(r.say.join("\n")).toMatch(/B-MID/); expect(r.say.join("\n")).not.toMatch(/G-EUR/);
    expect(r.link?.href).toBe("/fleet?region=Asia");
    r = (await ask("show heavy jets")).reply;
    expect(r.say.join("\n")).toMatch(/B-HVY/); expect(r.say.join("\n")).toMatch(/G-EUR/); expect(r.say.join("\n")).not.toMatch(/B-MID/);
    r = (await ask("list aircraft based in Hong Kong")).reply;
    expect(r.say.join("\n")).toMatch(/B-HVY/); expect(r.say.join("\n")).not.toMatch(/B-MID/);
    r = (await ask("show floating aircraft")).reply;
    expect(r.say.join("\n")).toMatch(/G-EUR/); expect(r.say.join("\n")).not.toMatch(/B-HVY/);
    r = (await ask("show aircraft with wifi")).reply;
    expect(r.say.join("\n")).toMatch(/B-HVY/); expect(r.say.join("\n")).not.toMatch(/B-MID|G-EUR/);
    r = (await ask("show aircraft without wifi")).reply;
    expect(r.say.join("\n")).toMatch(/B-MID/); expect(r.say.join("\n")).not.toMatch(/B-HVY/);
    r = (await ask("show heavy jets in Asia")).reply;
    expect(r.say.join("\n")).toMatch(/category: Heavy/); expect(r.say.join("\n")).toMatch(/region: Asia/);
  });

  it("sorts by YOM, YOR, capacity and wifi (missing values last)", async () => {
    await fleet();
    const order = async (q: string) => (await ask(q)).reply.say.join("\n").match(/B-HVY|B-MID|G-EUR/g);
    expect(await order("show all aircraft sorted by newest")).toEqual(["B-MID", "B-HVY", "G-EUR"]);
    expect(await order("list aircraft sort by oldest YOM")).toEqual(["G-EUR", "B-HVY", "B-MID"]);
    expect(await order("show aircraft sorted by YOR")).toEqual(["B-HVY", "G-EUR", "B-MID"]); // B-MID has no YOR: last
    expect(await order("show aircraft sort by capacity")).toEqual(["G-EUR", "B-HVY", "B-MID"]);
    expect(await order("show aircraft sort by fewest seats")).toEqual(["B-MID", "B-HVY", "G-EUR"]);
    expect(await order("show aircraft sorted by wifi")).toEqual(["B-HVY", "G-EUR", "B-MID"]);
    expect((await ask("sort by region")).reply.link?.href ?? "").toBe("/fleet?sort=region");
  });

  it("does not list everything for a question about an unknown name, and a named operator still wins", async () => {
    await fleet();
    expect((await ask("what aircraft does Zebra Air have?")).reply.say.join(" ")).toMatch(/couldn't match/);
    const r = (await ask("what does Metrojet have?")).reply.say.join("\n");
    expect(r).toMatch(/Metrojet/); expect(r).not.toMatch(/G-EUR/);
    expect((await ask("show all operators")).reply.say.join("\n")).toMatch(/G-EUR/);
  });
});

describe("Spoken sentences and tails typed with a space", () => {
  it("reads a dictated sentence into operator, base, aircraft and capacity", () => {
    const p = parseAircraftCard("new operator Vietstar Aviation bass in Ho Chi Minh aircraft Legacy 600 13 seats");
    expect(p).toMatchObject({ operator: "Vietstar Aviation", aircraft: "Legacy 600", capacity: 13, base: { mode: "based", locations: ["Ho Chi Minh"] } });
    expect(parseAircraftCard("add new operator dear Jets")).toMatchObject({ operator: "dear Jets" });
    expect(parseAircraftCard("create a new operator Metrojet based in Hong Kong built in 2015")).toMatchObject({ operator: "Metrojet", base: { locations: ["Hong Kong"] }, yom: 2015 });
  });

  it("a new dictated sentence replaces an earlier half-finished operator instead of reusing it", async () => {
    const first = await converse(t.db, t.actor.tenantId, emptyDraft("a"), "add new operator dear Jets", []);
    expect(first.draft.operatorText).toBe("dear Jets");
    const next = await converse(t.db, t.actor.tenantId, first.draft, "new operator Vietstar Aviation bass in Ho Chi Minh aircraft Legacy 600 13 seats", []);
    expect(next.draft.operatorText).toBe("Vietstar Aviation");
    expect(next.draft.base).toEqual({ mode: "based", locations: ["Ho Chi Minh"] });
    expect(next.draft.capacity).toBe(13);
  });

  it("finds a tail written with a space and offers a link", async () => {
    const org = (await createOrganisation(t.db, t.actor, key(), { name: "Tag Aviation" })).result.organisationId;
    const ac = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g280, registration: "T7-LXX", operatorId: org })).result.aircraftId;
    const turn = await converse(t.db, t.actor.tenantId, emptyDraft("s"), "show me t7 lxx aircraft photos", []);
    expect(turn.reply.say.join("\n")).toMatch(/T7-LXX/);
    expect(turn.reply.link?.href).toBe(`/aircraft/${ac}`);
  });
});

describe("Quotation message", () => {
  const g650 = { type: "Gulfstream G650ER", yom: 2019, yor: 2025, capacity: 12, wifi: "yes" as const, tail: "B-XYZ", operator: "Metrojet", base: "Hong Kong", notes: "Owner's approval required" };

  it("builds the broker template and leaves the price blank to fill in", () => {
    expect(buildQuote([g650], { language: "en" })).toBe(
      ["Aircraft: Gulfstream G650ER", "Manufacture: 2019", "Refurbished: 2025", "Capacity: 12 seats", "WIFI: Yes", "Price: "].join("\n"),
    );
    expect(buildQuote([{ ...g650, type: "Gulfstream G550", yom: 2013, yor: 2020, capacity: 13, wifiDetail: "at USD 10/MB" }], { language: "en" })).toBe(
      ["Aircraft: Gulfstream G550", "Manufacture: 2013", "Refurbished: 2020", "Capacity: 13 seats", "WIFI: Yes, at USD 10/MB", "Price: "].join("\n"),
    );
  });

  it("hides the operator, tail, base and notes unless asked, and skips unknown values", () => {
    const text = buildQuote([{ ...g650, yor: null, wifi: "unknown" }], { language: "en" });
    expect(text).not.toMatch(/Metrojet|B-XYZ|Hong Kong|approval|Refurbished|WIFI/);
    const all = buildQuote([g650], { language: "en", includeOperator: true, includeTail: true, includeBase: true, includeNotes: true });
    expect(all).toMatch(/Operator: Metrojet/); expect(all).toMatch(/Tail number: B-XYZ/); expect(all).toMatch(/Base: Hong Kong/); expect(all).toMatch(/Notes: Owner's approval required/);
  });

  it("numbers several aircraft, adds prices, and translates the labels but not the names", () => {
    const text = buildQuote([{ ...g650, price: "USD 5,200/hr" }, { ...g650, type: "Bombardier Global 6000", yom: 2015, capacity: 14, wifi: "no" }], { language: "zh-Hant", greeting: true });
    expect(text).toMatch(/^您好/);
    expect(text).toMatch(/飛機 1：Gulfstream G650ER\n出廠年份：2019\n翻新年份：2025\n載客量：12 座\nWIFI：有\n價格：USD 5,200\/hr/);
    expect(text).toMatch(/飛機 2：Bombardier Global 6000\n出廠年份：2015/);
    expect(text).toMatch(/WIFI：無/);
  });

  it("every language has every word, and plural forms work", () => {
    for (const l of QUOTE_LANGUAGES) {
      const w = QUOTE_WORDS[l];
      for (const k of ["name", "hello", "thanks", "aircraft", "yom", "yor", "capacity", "wifiYes", "wifiNo", "wifiTbc", "price"] as const) expect(w[k], `${l}.${k}`).toBeTruthy();
      expect(w.seats(12)).toMatch(/12/);
      expect(buildQuote([g650], { language: l })).toMatch(/2019/);
    }
    expect(QUOTE_WORDS.en.seats(1)).toBe("1 seat");
    expect(QUOTE_WORDS.ru.seats(1)).toBe("1 место"); expect(QUOTE_WORDS.ru.seats(3)).toBe("3 места"); expect(QUOTE_WORDS.ru.seats(12)).toBe("12 мест");
  });

  it("Toy opens the Quote page with the named aircraft chosen", async () => {
    const org = (await createOrganisation(t.db, t.actor, key(), { name: "Metrojet" })).result.organisationId;
    const a = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g280, registration: "B-AAA", operatorId: org })).result.aircraftId;
    const turn = await converse(t.db, t.actor.tenantId, emptyDraft("q"), "make a quote for the G280", []);
    expect(turn.reply.link?.href).toBe(`/quote?ids=${a}`);
    expect((await converse(t.db, t.actor.tenantId, emptyDraft("q"), "I need a quote", [])).reply.link?.href).toBe("/quote");
    const none = await converse(t.db, t.actor.tenantId, emptyDraft("q"), "quote for Zebra", []);
    expect(none.reply.say.join(" ")).toMatch(/couldn't find/);
  });
});

describe("WIFI details", () => {
  it("reads 'WIFI: Yes, at USD 10/MB', stores it on the aircraft, and carries it into the card", async () => {
    expect(parseAircraftCard("WIFI: Yes, at USD 10/MB")).toMatchObject({ wifi: "yes", wifiDetail: "at USD 10/MB" });
    expect(parseAircraftCard("Wifi No")).toMatchObject({ wifi: "no" });
    const a = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g280, registration: "B-WIF", info: { wifiStatus: "yes", wifiDetail: "at USD 10/MB" } })).result.aircraftId;
    const card = (await getAircraftCard(t.db, a))!;
    expect(card).toMatchObject({ wifi: "yes", wifiDetail: "at USD 10/MB" });
    expect(formatAircraftCard(card)).toMatch(/WIFI: Yes, at USD 10\/MB/);
    // Updating through Toy keeps the status and changes only the detail given.
    await applyChatProposal(t.db, t.actor, "k-wifi", { mediaIds: [], classifications: {}, aircraftTypeId: g280, aircraft: { mode: "existing", aircraftId: a }, info: { yom: null, yor: null, capacity: null, wifiStatus: "yes", wifiDetail: "free for the first 100 MB", notes: null } });
    expect((await getAircraftCard(t.db, a))!.wifiDetail).toBe("free for the first 100 MB");
  });

  it("quotes 'Capa Jet's G550' by operator and type, with the possessive", async () => {
    const g550 = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G550", category: "heavy_jet" })).result.aircraftTypeId;
    const op = (await createOrganisation(t.db, t.actor, key(), { name: "CapaJet" })).result.organisationId;
    const a = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g550, operatorId: op, info: { yom: 2013 } })).result.aircraftId;
    await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g280, registration: "B-OTH" });
    const turn = await converse(t.db, t.actor.tenantId, emptyDraft("q"), "quote Capa Jet's G550", []);
    expect(turn.reply.link?.href).toBe(`/quote?ids=${a}`);
  });
});

describe("Quote wording template", () => {
  const g550 = { type: "Gulfstream G550", yom: 2013, yor: 2020, capacity: 13, wifi: "yes" as const, wifiDetail: "at USD 10/MB", tail: "B-XXX", operator: "CapaJet", base: "Hong Kong", notes: null };

  it("the standard template reproduces the standard message, and a custom one changes wording, order and extra lines", () => {
    const standard = buildQuote([g550], { language: "en" });
    expect(standard).toBe(buildQuote([g550], { language: "en", template: defaultQuoteTemplate("en") }));
    const custom = buildQuote([g550], {
      language: "en",
      template: { block: ["{aircraft} ({yom})", "Seats: {capacity_number}", "WIFI: {wifi}", "Rate per hour: {price}", "Terms apply"].join("\n"), yes: "Available", seats: "{n} pax" },
    });
    expect(custom).toBe(["Gulfstream G550 (2013)", "Seats: 13", "WIFI: Available, at USD 10/MB", "Rate per hour: ", "Terms apply"].join("\n"));
    expect(buildQuote([g550], { language: "en", template: { block: "{aircraft}\n{capacity}\n{price}" } })).toBe("Gulfstream G550\n13 seats\n");
    expect(buildQuote([g550], { language: "en", template: { block: "{aircraft}\n{capacity}\n{price}", seats: "{n} pax" } })).toBe("Gulfstream G550\n13 pax\n");
  });

  it("an empty greeting means none, and {n} numbers the aircraft only when several are quoted", () => {
    const t = { greeting: "", closing: "", block: "Option{n}: {aircraft}" };
    expect(buildQuote([g550], { language: "en", greeting: true, template: t })).toBe("Option: Gulfstream G550");
    expect(buildQuote([g550, { ...g550, type: "Global 6000" }], { language: "en", greeting: true, template: t })).toBe("Option 1: Gulfstream G550\n\nOption 2: Global 6000");
  });

  it("gives each aircraft its own block, so one can be edited without touching the others", () => {
    const p = buildQuoteParts([g550, { ...g550, type: "Global 6000" }], { language: "en", greeting: true });
    expect(p.blocks).toHaveLength(2);
    expect(p.blocks[0]).toMatch(/^Aircraft 1: Gulfstream G550/);
    expect(p.blocks[1]).toMatch(/^Aircraft 2: Global 6000/);
    expect(p.greeting).toBeTruthy(); expect(p.closing).toBeTruthy();
  });

  it("rejects a template that cannot work", () => {
    expect(validateQuoteTemplate({ block: "Hello" })).toMatch(/\{aircraft\}/);
    expect(validateQuoteTemplate({ block: "{aircraft} {colour}" })).toMatch(/not a field/);
    expect(validateQuoteTemplate({ block: "{aircraft}", seats: "seats" })).toMatch(/\{n\}/);
    expect(validateQuoteTemplate({ block: "{aircraft}\n{yom}" })).toBeNull();
  });

  it("saves only what differs, per language, and resets to standard", async () => {
    const std = defaultQuoteTemplate("en");
    await saveQuoteTemplate(t.db, t.actor, key(), { language: "en", template: { ...std, block: "{aircraft}\nBuilt {yom}\n{price}", closing: "Thanks!" } });
    expect(await getQuoteTemplates(t.db, t.actor.tenantId)).toEqual({ en: { block: "{aircraft}\nBuilt {yom}\n{price}", closing: "Thanks!" } });
    await expect(saveQuoteTemplate(t.db, t.actor, key(), { language: "en", template: { ...std, block: "no aircraft here" } })).rejects.toThrow(/\{aircraft\}/);
    await expect(saveQuoteTemplate(t.db, t.actor, key(), { language: "xx", template: std })).rejects.toThrow(/Unknown language/);
    await saveQuoteTemplate(t.db, t.actor, key(), { language: "ja", template: { ...defaultQuoteTemplate("ja"), yes: "有り" } });
    expect(Object.keys(await getQuoteTemplates(t.db, t.actor.tenantId)).sort()).toEqual(["en", "ja"]);
    await saveQuoteTemplate(t.db, t.actor, key(), { language: "en", template: std }); // back to the standard text = nothing stored
    expect(Object.keys(await getQuoteTemplates(t.db, t.actor.tenantId))).toEqual(["ja"]);
    await resetQuoteTemplate(t.db, t.actor, key(), { language: "ja" });
    expect(await getQuoteTemplates(t.db, t.actor.tenantId)).toEqual({});
  });
});

describe("Toy: 'give me X's G550 and Y's G650ER template and photos'", () => {
  it("reads the request, tolerates typos, and returns the message, photos and a copy text for both aircraft", async () => {
    expect(parseQuoteRequest("Give me CapacJet's G550 and Tag's G650ER template and photos")).toEqual({ what: ["CapacJet's G550", "Tag's G650ER"] });
    expect(parseQuoteRequest("get me the G550 message")).toEqual({ what: ["G550"] });
    expect(parseQuoteRequest("send the G550 template to Mr Chan")).toBeNull();
    expect(parseQuoteRequest("show me what Tag aviation offers")).toBeNull();
    expect(parseQuoteRequest("quote for Capa Jet's G550, Tag G650ER")).toEqual({ what: ["Capa Jet's G550", "Tag G650ER"] });
    expect(parseQuoteRequest("Give me G280 quote and photo")).toEqual({ what: ["G280"] });
    expect(parseQuoteRequest("make a quote for the G650 and B-KXX")).toEqual({ what: ["G650", "B-KXX"] });
    expect(parseQuoteRequest("G280 quotation with photos please")).toEqual({ what: ["G280"] });
    expect(parseQuoteRequest("quote")).toEqual({ what: [] });

    const g550 = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G550", category: "heavy_jet" })).result.aircraftTypeId;
    const g650 = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G650ER", category: "ultra_long_range_jet" })).result.aircraftTypeId;
    const capa = (await createOrganisation(t.db, t.actor, key(), { name: "CapaJet" })).result.organisationId;
    const tag = (await createOrganisation(t.db, t.actor, key(), { name: "Tag Aviation" })).result.organisationId;
    const a1 = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g550, operatorId: capa, info: { yom: 2013, yor: 2020, capacity: 13, wifiStatus: "yes", wifiDetail: "at USD 10/MB" } })).result.aircraftId;
    const a2 = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g650, operatorId: tag, registration: "T7-LXX", info: { yom: 2017, capacity: 15 } })).result.aircraftId;
    await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g650, registration: "N-OTHER" });

    const turn = await converse(t.db, t.actor.tenantId, emptyDraft("q"), "Give me CapacJet's G550 and Tag's G650ER template and photos", []);
    expect(turn.reply.link?.href).toBe(`/quote?ids=${a1},${a2}`);
    expect(turn.reply.copy).toBe(
      [
        "Hello, here are the aircraft options:",
        ["Aircraft 1: Gulfstream G550", "Manufacture: 2013", "Refurbished: 2020", "Capacity: 13 seats", "WIFI: Yes, at USD 10/MB", "Price: "].join("\n"),
        ["Aircraft 2: Gulfstream G650ER", "Manufacture: 2017", "Capacity: 15 seats", "Price: "].join("\n"),
        "Please let me know if you would like more details or photos.",
      ].join("\n\n"),
    );
    expect(turn.reply.say.join("\n")).toMatch(/G550/);
    expect(turn.reply.say.join("\n")).not.toMatch(/N-OTHER/);
  });
});

describe("Renaming an operator", () => {
  it("changes the name, keeps the old one as another name, and keeps its aircraft", async () => {
    const org = (await createOrganisation(t.db, t.actor, key(), { name: "Metro Jet", region: "Hong Kong" })).result.organisationId;
    const other = (await createOrganisation(t.db, t.actor, key(), { name: "Deer Jet" })).result.organisationId;
    const ac = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g280, registration: "B-MJ1", operatorId: org })).result.aircraftId;
    await renameOrganisation(t.db, t.actor, key(), { organisationId: org, name: "Metrojet" });
    const [o] = await t.db.select().from(organisations).where(eq(organisations.id, org));
    expect(o).toMatchObject({ canonicalName: "Metrojet", normalizedName: "metrojet", region: "Hong Kong" });
    expect((await getAircraftCard(t.db, ac))!.operator).toBe("Metrojet");
    // "Metro Jet" and "Metrojet" are the same key, so no alias is needed; a genuinely different old name is kept as an alias.
    await renameOrganisation(t.db, t.actor, key(), { organisationId: org, name: "Metrojet Limited" });
    expect((await resolveOrganisationsExact(t.db, t.actor.tenantId, "Metrojet")).map((x) => x.id)).toEqual([org]);
    expect((await resolveOrganisationsExact(t.db, t.actor.tenantId, "Metrojet Limited")).map((x) => x.id)).toEqual([org]);
    // Not allowed: an empty name, or another operator's name.
    await expect(renameOrganisation(t.db, t.actor, key(), { organisationId: org, name: "  " })).rejects.toThrow(/cannot be empty/);
    await expect(renameOrganisation(t.db, t.actor, key(), { organisationId: org, name: "deer jet" })).rejects.toThrow(/already called/);
    // Without keeping the old name.
    await renameOrganisation(t.db, t.actor, key(), { organisationId: other, name: "Deer Jet Asia", keepOldAsAlias: false });
    expect(await resolveOrganisationsExact(t.db, t.actor.tenantId, "Deer Jet")).toEqual([]);
  });
});

describe("Quote pieces chosen per quote", () => {
  const ac = { type: "Gulfstream G550", yom: 2013, yor: 2020, capacity: 13, wifi: "yes" as const };
  it("adds the price and the broker's extra line, and keeps them in another language", () => {
    const en = buildQuoteParts([{ ...ac, price: "USD 85,000", extra: "Available from 12 Dec" }], { language: "en" });
    expect(en.blocks[0]).toMatch(/Price: USD 85,000\nAvailable from 12 Dec$/);
    const zh = buildQuoteParts([{ ...ac, price: "USD 85,000", extra: "Available from 12 Dec" }], { language: "zh-Hant" });
    expect(zh.blocks[0]).toContain("USD 85,000");
    expect(zh.blocks[0]).toContain("Available from 12 Dec");
  });
  it("lets the opening and closing lines be switched on and off separately", () => {
    const a = buildQuoteParts([ac], { language: "en", greeting: true, closing: false });
    expect(a.greeting).toBeTruthy(); expect(a.closing).toBeNull();
    const b = buildQuoteParts([ac], { language: "en", greeting: false, closing: true });
    expect(b.greeting).toBeNull(); expect(b.closing).toBeTruthy();
    const c = buildQuoteParts([ac], { language: "en", greeting: true });
    expect(c.closing).toBeTruthy(); // follows the opening line when not given
  });
});
