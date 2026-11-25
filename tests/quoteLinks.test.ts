import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setup } from "./helpers";
import { cleanSnapshot, saveQuoteVersion } from "../src/domain/requests";
import { ensureLink, linkFor, noteOpened, openLink, quotePhotoIds, replaceLink, setLink } from "../src/domain/quoteLinks";

const legs = [{ from: "VHHH", to: "EGLF", date: "2026-12-12", time: "16:30", flight: 765, pax: 4 }];
const photoId = randomUUID();
const snap = (price: string) => cleanSnapshot({
  lang: "en", text: `Price: ${price}`, greeting: "Hello", closing: "Thanks",
  options: [{ aircraftId: randomUUID(), type: "Gulfstream G650", price, photos: [{ id: photoId, label: "EXT 1", classification: "exterior" }] }],
  builder: { inc: { operator: false } },
});

describe("Client link", () => {
  it("shows the latest version, and stops opening when switched off, expired or replaced", async () => {
    const t = await setup();
    const { requestId } = await saveQuoteVersion(t.db, t.actor, null, legs, snap("USD 95,000"));
    expect(await linkFor(t.db, t.actor.tenantId, requestId)).toBeNull();

    const link = await ensureLink(t.db, t.actor, requestId);
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect((await ensureLink(t.db, t.actor, requestId)).token).toBe(link.token); // one link per request

    let q = await openLink(t.db, link.token);
    expect(q).toMatchObject({ version: 1, broker: { email: "owner@example.test" } });
    expect(q!.quote).toMatchObject({ greeting: "Hello", closing: "Thanks", utc: true });
    expect(q!.quote.legs[0]).toMatchObject({ from: "VHHH", to: "EGLF" });
    expect(quotePhotoIds(q!.quote).has(photoId)).toBe(true);

    // A new version reaches the client through the same link.
    await saveQuoteVersion(t.db, t.actor, requestId, legs, snap("USD 89,000"));
    q = await openLink(t.db, link.token);
    expect(q).toMatchObject({ version: 2 });
    expect(q!.quote.options[0].price).toBe("USD 89,000");

    await noteOpened(t.db, q!.link, new Date("2026-11-25T10:00:00Z"));
    const again = await openLink(t.db, link.token);
    await noteOpened(t.db, again!.link, new Date("2026-11-25T11:00:00Z"));
    const seen = await linkFor(t.db, t.actor.tenantId, requestId);
    expect(seen?.firstViewedAt?.toISOString()).toBe("2026-11-25T10:00:00.000Z");
    expect(seen?.lastViewedAt?.toISOString()).toBe("2026-11-25T11:00:00.000Z");

    await setLink(t.db, t.actor, requestId, { active: false });
    expect(await openLink(t.db, link.token)).toBeNull();
    await setLink(t.db, t.actor, requestId, { active: true, expiresAt: new Date("2026-12-01T23:59:59Z") });
    expect(await openLink(t.db, link.token, new Date("2026-12-01T12:00:00Z"))).not.toBeNull();
    expect(await openLink(t.db, link.token, new Date("2026-12-02T00:00:00Z"))).toBeNull();
    await setLink(t.db, t.actor, requestId, { expiresAt: null });

    const fresh = await replaceLink(t.db, t.actor, requestId);
    expect(fresh.token).not.toBe(link.token);
    expect(await openLink(t.db, link.token)).toBeNull();
    expect(await openLink(t.db, fresh.token)).toMatchObject({ version: 2 });

    // Made-up or malformed tokens, and other workspaces, get nothing.
    expect(await openLink(t.db, "x".repeat(24))).toBeNull();
    expect(await openLink(t.db, "../../etc/passwd")).toBeNull();
    await expect(ensureLink(t.db, { id: randomUUID(), tenantId: randomUUID() }, requestId)).rejects.toThrow("no longer here");
  });
});
