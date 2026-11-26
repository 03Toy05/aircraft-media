import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setup, key } from "./helpers";
import { createAircraft, createAircraftType, createOrganisation } from "../src/domain/directory";
import { createContact } from "../src/domain/contacts";
import { converse, emptyDraft } from "../src/domain/toy";
import { cleanSnapshot, saveQuoteVersion } from "../src/domain/requests";
import { clearConversation, loadConversation, saveConversation } from "../src/domain/toyMemory";
import { toyConversations } from "../src/db/schema";

let t: Awaited<ReturnType<typeof setup>>;
const sevenX: Record<string, string> = {};
const ctx = () => ({ userId: t.actor.id });
const ids = (href?: string) => new URL(href ?? "/", "http://x").searchParams.get("ids")?.split(",") ?? [];

beforeEach(async () => {
  t = await setup();
  const f7x = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Dassault", model: "Falcon 7X", category: "heavy_jet" })).result.aircraftTypeId;
  const lux = (await createOrganisation(t.db, t.actor, key(), { name: "Luxaviation" })).result.organisationId;
  for (const reg of ["OO-FSX", "F-HECD", "OO-AIE"]) {
    sevenX[reg] = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: f7x, registration: reg, operatorId: lux, info: { capacity: 14 } })).result.aircraftId;
  }
});

describe("Toy remembers the choices made", () => {
  it("uses the 7X picked last time, and asks again for “other”", async () => {
    const ask = await converse(t.db, t.actor.tenantId, emptyDraft("m1"), "Lux 7X quote", [], ctx());
    await converse(t.db, t.actor.tenantId, ask.draft, "OO-AIE", [], ctx());

    const next = await converse(t.db, t.actor.tenantId, emptyDraft("m2"), "Lux 7X quote USD 100k", [], ctx());
    expect(ids(next.reply.link?.href)).toEqual([sevenX["OO-AIE"]]);
    expect(next.reply.say[1]).toBe("Using Luxaviation · Dassault Falcon 7X · OO-AIE, as last time. Say “other Lux 7X” to choose again.");

    const other = await converse(t.db, t.actor.tenantId, emptyDraft("m3"), "other Lux 7X quote", [], ctx());
    expect(other.draft.asked?.kind).toBe("quote_pick");

    // Someone else's memory is their own.
    const fresh = await converse(t.db, t.actor.tenantId, emptyDraft("m4"), "Lux 7X quote", [], { userId: "00000000-0000-0000-0000-0000000000aa" });
    expect(fresh.draft.asked?.kind).toBe("quote_pick");
  });

  it("sends the photo kinds asked for last time", async () => {
    await converse(t.db, t.actor.tenantId, emptyDraft("m5"), "OO-FSX quote with EXT photos only", [], ctx());
    const next = await converse(t.db, t.actor.tenantId, emptyDraft("m6"), "OO-AIE quote", [], ctx());
    expect(next.reply.kinds).toEqual(["exterior"]);
    expect(next.reply.say.find((s) => s.startsWith("Photos as last time:"))).toMatch(/^Photos as last time: (EXT|Exterior).$/i);
  });
});

describe("Toy answers about past quotes", () => {
  it("makes the last quote again, from this chat or from the saved ones", async () => {
    const first = await converse(t.db, t.actor.tenantId, emptyDraft("m7"), "OO-FSX quote USD 90k", [], ctx());
    const again = await converse(t.db, t.actor.tenantId, first.draft, "same as last time", [], ctx());
    expect(again.reply.say[0]).toBe("Here is the last quote again:");
    expect(again.reply.copy).toContain("Price: USD 90k");

    const saved = await saveQuoteVersion(t.db, t.actor, null, [{ from: "VHHH", to: "RJTT", date: "2026-12-12", time: "10:00", pax: 4 }],
      cleanSnapshot({ lang: "en", text: "x", legs: [], builder: {}, options: [{ aircraftId: sevenX["F-HECD"], type: "Dassault Falcon 7X", operator: "Luxaviation", tail: "F-HECD", base: null, yom: null, yor: null, capacity: 14, price: "USD 120k", extra: "", photos: [] }] }));
    const fromSaved = await converse(t.db, t.actor.tenantId, emptyDraft("m8"), "same as last time", [], ctx());
    expect(fromSaved.reply.say[0]).toMatch(new RegExp(`^Here is ${saved.reference} v1 again`));
    expect(ids(fromSaved.reply.link?.href)).toEqual([sevenX["F-HECD"]]);
    expect(fromSaved.draft.quote?.legs?.[0]).toMatchObject({ from: "VHHH", to: "RJTT" });

    const list = await converse(t.db, t.actor.tenantId, emptyDraft("m9"), "my recent quotes", [], ctx());
    expect(list.reply.say[0]).toContain(`${saved.reference} v1`);
    expect(list.reply.chips[0]).toEqual({ label: `${saved.reference} again`, send: `${saved.reference} again` });
    const byRef = await converse(t.db, t.actor.tenantId, emptyDraft("m10"), `${saved.reference} again`, [], ctx());
    expect(ids(byRef.reply.link?.href)).toEqual([sevenX["F-HECD"]]);
  });

  it("sends “it” to a contact: the quote's aircraft", async () => {
    await createContact(t.db, t.actor, key(), { name: "Mr Chan", app: "whatsapp", handle: "+85291234567" });
    const q = await converse(t.db, t.actor.tenantId, emptyDraft("m11"), "OO-FSX quote", [], ctx());
    const send = await converse(t.db, t.actor.tenantId, q.draft, "send it to Mr Chan", [], ctx());
    expect(send.reply.share?.aircraftId).toBe(sevenX["OO-FSX"]);
  });
});

describe("The saved conversation", () => {
  it("keeps the state and recent messages, per person and workspace, and forgets after 90 days", async () => {
    const me = t.actor.id;
    await saveConversation(t.db, me, t.actor.tenantId, { photos: [], quote: { ids: ["a"], prices: {} } }, [{ id: "1", role: "user", text: "hi", files: [] }]);
    await saveConversation(t.db, me, t.actor.tenantId, { photos: [] }, [{ id: "2", role: "toy", say: ["hello"] }]);
    const c = await loadConversation(t.db, me, t.actor.tenantId);
    expect(c?.messages.map((m) => m.id)).toEqual(["1", "2"]);
    expect(c?.draft).toEqual({ photos: [] });
    expect(await loadConversation(t.db, me, "00000000-0000-0000-0000-00000000ffff")).toBeNull(); // another workspace
    await t.db.update(toyConversations).set({ updatedAt: new Date(Date.now() - 91 * 864e5) }).where(eq(toyConversations.userId, me));
    expect(await loadConversation(t.db, me, t.actor.tenantId)).toBeNull();
    await saveConversation(t.db, me, t.actor.tenantId, { photos: [] }, [{ id: "3", role: "user", text: "x" }]);
    await clearConversation(t.db, me);
    expect(await loadConversation(t.db, me, t.actor.tenantId)).toBeNull();
  });
});
