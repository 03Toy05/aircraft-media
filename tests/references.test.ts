import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setup, key } from "./helpers";
import { assignMissingPersonReferences, createContact, personInitials, retireContact, updateContact } from "../src/domain/contacts";
import { contacts } from "../src/db/schema";

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});

describe("Person references (CBOS Rulebook B1.2: PER-{initials}-{number})", () => {
  it("takes initials from the English name, leaving titles out", () => {
    expect(personInitials("Wallace Fok")).toBe("WF");
    expect(personInitials("Mr Chan Tai Man")).toBe("CTM");
    expect(personInitials("José Núñez")).toBe("JN");
    expect(personInitials("陳大文")).toBeNull();
  });

  it("allocates once, numbers matching initials apart, and never changes or reuses a reference", async () => {
    const a = await createContact(t.db, t.actor, key(), { name: "Wallace Fok", app: "whatsapp" });
    const b = await createContact(t.db, t.actor, key(), { name: "陳大文", englishName: "Winnie Fung", app: "wechat" });
    expect(a.result.reference).toBe("PER-WF-001");
    expect(b.result.reference).toBe("PER-WF-002");
    await expect(createContact(t.db, t.actor, key(), { name: "陳小明", app: "line" })).rejects.toThrow(/English name/);

    // Renaming keeps the reference; a retired contact's number is not given out again.
    await updateContact(t.db, t.actor, key(), { contactId: a.result.contactId, name: "Peter Lee", app: "whatsapp" });
    const [after] = await t.db.select().from(contacts).where(eq(contacts.id, a.result.contactId));
    expect(after.reference).toBe("PER-WF-001");
    await retireContact(t.db, t.actor, key(), { contactId: b.result.contactId });
    expect((await createContact(t.db, t.actor, key(), { name: "William Fan", app: "signal" })).result.reference).toBe("PER-WF-003");
  });

  it("gives older contacts a reference in the order they were added", async () => {
    await t.db.insert(contacts).values([
      { tenantId: t.actor.tenantId, name: "Mr Chan", normalizedName: "mrchan", app: "whatsapp", createdAt: new Date("2026-01-01") },
      { tenantId: t.actor.tenantId, name: "Cathy Ng", normalizedName: "cathyng", app: "line", createdAt: new Date("2026-02-01") },
      { tenantId: t.actor.tenantId, name: "王先生", normalizedName: "王先生", app: "wechat", createdAt: new Date("2026-03-01") },
    ]);
    expect(await assignMissingPersonReferences(t.db, t.actor.tenantId)).toBe(2);
    const refs = (await t.db.select().from(contacts)).map((c) => [c.name, c.reference]);
    expect(Object.fromEntries(refs)).toEqual({ "Mr Chan": "PER-C-001", "Cathy Ng": "PER-CN-001", "王先生": null });
  });
});
