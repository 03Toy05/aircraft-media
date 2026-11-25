import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { setup, makeImage } from "./helpers";
import { quoteShares, users } from "../src/db/schema";
import { MAX_RECIPIENTS, attachmentName, emailsToday, parseRecipients, quoteEmailBody, quoteFrom } from "../src/domain/quoteEmail";
import { recordQuoteShare } from "../src/domain/quoteShares";
import { photoAllowed } from "../src/domain/photoAccess";
import { ingestUpload } from "../src/domain/media";
import { getCatalogue } from "../src/domain/catalogue";
import { getLineup } from "../src/domain/media";
import { LIBRARY_TENANT_ID, importLibraryPack, setLibraryOperators } from "../src/domain/library";

describe("Quote email", () => {
  it("takes a few valid addresses and says plainly what is wrong", () => {
    expect(parseRecipients(" Client@Example.com, b@x.co ; client@example.com ")).toEqual({ emails: ["client@example.com", "b@x.co"] });
    expect(parseRecipients("")).toEqual({ error: expect.stringContaining("email") });
    expect(parseRecipients("not-an-email")).toEqual({ error: expect.stringContaining("not-an-email") });
    expect(parseRecipients("a@b.c <evil>")).toHaveProperty("error");
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `p${i}@x.com`).join(",");
    expect(parseRecipients(many)).toHaveProperty("error");
  });

  it("turns the quote's *bold* into HTML, escapes everything else, and keeps plain text without the markers", () => {
    const b = quoteEmailBody("Hello <b>&\n*Aircraft 1:* G650\n_Price_: USD 1");
    expect(b.html).toContain("<b>Aircraft 1:</b>");
    expect(b.html).toContain("<i>Price</i>");
    expect(b.html).toContain("Hello &lt;b&gt;&amp;<br>");
    expect(b.html).not.toContain("<b>&");
    expect(b.text).toBe("Hello <b>&\nAircraft 1: G650\nPrice: USD 1");
    expect(quoteEmailBody("مرحبا", { rtl: true }).html).toContain('dir="rtl"');
  });

  it("sends under the broker's name from the site's own domain", () => {
    expect(quoteFrom("Wallace", { EMAIL_FROM: "Aircraft Media <sign-in@aircraftmedia.my>" })).toBe('"Wallace via Aircraft Media" <quotes@aircraftmedia.my>');
    expect(quoteFrom('Ev"il <x@y.z>\r\nBcc: a@b.c', { EMAIL_FROM: "sign-in@aircraftmedia.my" })).toBe('"Evil x@y.zBcc: a@b.c via Aircraft Media" <quotes@aircraftmedia.my>');
    expect(quoteFrom("Wallace", { EMAIL_FROM: "A <a@d.com>", QUOTE_EMAIL_FROM: "offers@d.com" })).toBe('"Wallace via Aircraft Media" <offers@d.com>');
    expect(quoteFrom("Wallace", {})).toBeUndefined();
  });

  it("names attachments safely with the right extension", () => {
    expect(attachmentName("Option 1 - Gulfstream G650 - EXT 1", "image/jpeg")).toBe("Option 1 - Gulfstream G650 - EXT 1.jpg");
    expect(attachmentName("../../etc/passwd\u0000", "image/png")).toBe("....etcpasswd.png");
    expect(attachmentName("", "image/webp")).toBe("photo.webp");
  });

  it("counts a person's quote emails in the last day, for the daily limit", async () => {
    const t = await setup();
    expect(await emailsToday(t.db, t.actor.id)).toBe(0);
    await recordQuoteShare(t.db, t.actor, { quoteKey: "q1", how: "email", options: 2 });
    await recordQuoteShare(t.db, t.actor, { quoteKey: "q1", how: "email", options: 2 });
    await recordQuoteShare(t.db, t.actor, { quoteKey: "q2", how: "share", options: 1 });
    expect(await emailsToday(t.db, t.actor.id)).toBe(2);
    expect(await emailsToday(t.db, t.actor.id, new Date(Date.now() + 2 * 864e5))).toBe(0);
    const [row] = await t.db.select().from(quoteShares).where(eq(quoteShares.quoteKey, "q1"));
    expect(row.how).toBe("email");
  });
});

describe("Which photos a person may send", () => {
  it("allows their own, the library's when shared (chosen operators only), and nobody else's", async () => {
    const t = await setup();
    const me = { isAdmin: false, actor: t.actor };
    const own = (await ingestUpload(t.db, t.store, t.actor, { filename: "own.png", bytes: await makeImage(400, 300, 501) })).result.contentVersionId;
    expect(await photoAllowed(t.db, me, own)).toBe(true);
    expect(await photoAllowed(t.db, me, "not-an-id")).toBe(false);

    const files = new Map([["a.png", await makeImage(500, 300, 502)], ["b.png", await makeImage(500, 300, 503)]]);
    await importLibraryPack(t.db, t.store, t.actor, { operator: "Alpha Jets", aircraft: [{ type: "Gulfstream G650", tail: "OE-AAA", photos: { exterior: ["a.png"] } }] }, files);
    await importLibraryPack(t.db, t.store, t.actor, { operator: "Bravo Air", aircraft: [{ type: "Cessna Citation XLS", tail: "OE-BBB", photos: { exterior: ["b.png"] } }] }, files);
    const lib = await getCatalogue(t.db, LIBRARY_TENANT_ID);
    const photoOf = async (tail: string) => {
      const r = lib.find((x) => x.tail === tail)!;
      return (await getLineup(t.db, { aircraftId: r.aircraftId, aircraftTypeId: r.aircraftTypeId })).find((p) => p.classification === "exterior")!.contentVersionId;
    };
    const a = await photoOf("OE-AAA"), b = await photoOf("OE-BBB");

    const [u] = await t.db.insert(users).values({ tenantId: randomUUID(), email: "broker@example.test", displayName: "Broker" }).returning({ id: users.id, tenantId: users.tenantId });
    const broker = { isAdmin: false, actor: { id: u.id, tenantId: u.tenantId } };
    expect(await photoAllowed(t.db, broker, a)).toBe(false); // library not shared yet
    expect(await photoAllowed(t.db, broker, own)).toBe(false); // someone else's workspace
    await t.db.update(users).set({ libraryAccess: true }).where(eq(users.id, u.id));
    expect(await photoAllowed(t.db, broker, a)).toBe(true);
    const alpha = lib.find((x) => x.tail === "OE-AAA")!.operatorId!;
    await setLibraryOperators(t.db, u.id, [alpha]);
    expect(await photoAllowed(t.db, broker, a)).toBe(true);
    expect(await photoAllowed(t.db, broker, b)).toBe(false); // an operator not opened to them
  }, 60_000);
});
