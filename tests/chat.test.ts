import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setup, key, makeImage } from "./helpers";
import { createAircraft, createAircraftType, createOrganisation, getAircraftCard, listInformationVersions } from "../src/domain/directory";
import { ingestUpload } from "../src/domain/media";
import { applyChatProposal } from "../src/domain/chat";
import { converse, emptyDraft, type Draft, type DraftPhoto } from "../src/domain/chocks";
import { parseAircraftCard } from "../src/domain/card";
import { aircraftMedia } from "../src/db/schema";

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
    // second time the same operator + type: Chocks asks whether it is the aircraft it already has
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

describe("Chocks conversation", () => {
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

  it("starts over on request", async () => {
    const r = await converse(t.db, t.actor.tenantId, emptyDraft("k5"), "Operator: X", []);
    const c = await converse(t.db, t.actor.tenantId, r.draft, "cancel", []);
    expect(c.draft.operatorText).toBe("");
  });
});
