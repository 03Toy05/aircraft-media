import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { setup } from "./helpers";
import { DEFAULT_COLOR, getBrand, logoDataUrl, removeBrandLogo, setBrandColor, setBrandLogo, textOn, validColor } from "../src/domain/branding";
import { cleanSnapshot, saveQuoteVersion } from "../src/domain/requests";
import { brokerQuotePdf } from "../src/domain/quotePdf";
import { ensureLink, openLink } from "../src/domain/quoteLinks";

const images = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().reduce((n, p) => n + (p.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict)?.keys().length ?? 0), 0);
};

describe("Quote branding", () => {
  it("keeps a colour and a logo per workspace, and puts them on the PDF and the client link", async () => {
    const t = await setup();
    expect(await getBrand(t.db, t.actor.tenantId)).toEqual({ color: DEFAULT_COLOR, logo: null });
    expect(validColor("#0a7c3e")).toBe(true);
    expect(validColor("red")).toBe(false);
    expect(textOn("#ffffff")).toBe("#111111");
    expect(textOn("#1f3a5f")).toBe("#ffffff");

    await expect(setBrandColor(t.db, t.actor.tenantId, "blue")).rejects.toThrow("colour");
    await setBrandColor(t.db, t.actor.tenantId, "#0A7C3E");
    const big = new Uint8Array(await sharp({ create: { width: 2000, height: 600, channels: 4, background: { r: 10, g: 124, b: 62, alpha: 1 } } }).png().toBuffer());
    await setBrandLogo(t.db, t.actor.tenantId, big);
    let b = await getBrand(t.db, t.actor.tenantId);
    expect(b.color).toBe("#0a7c3e");
    expect(b.logo).toMatchObject({ width: 800, height: 240 }); // shrunk to fit 800 x 400
    expect(logoDataUrl(b)).toMatch(/^data:image\/png;base64,/);

    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="#0a7c3e"/></svg>');
    await setBrandLogo(t.db, t.actor.tenantId, svg);
    expect((await getBrand(t.db, t.actor.tenantId)).logo?.width).toBeGreaterThan(0);
    await expect(setBrandLogo(t.db, t.actor.tenantId, new TextEncoder().encode("not an image"))).rejects.toThrow("isn't an image");

    // The PDF carries the logo (one more image than without), and the client link the brand.
    const legs = [{ from: "VHHH", to: "EGLF", date: "2026-12-12", time: "16:30", flight: 765, pax: 4 }];
    const snap = cleanSnapshot({ lang: "en", text: "x", options: [{ aircraftId: randomUUID(), type: "Gulfstream G650", price: "USD 1", photos: [] }], builder: {} });
    const { requestId } = await saveQuoteVersion(t.db, t.actor, null, legs, snap);
    const who = { isAdmin: false, actor: t.actor, email: "owner@example.test" };
    expect(await images((await brokerQuotePdf(t.db, t.store, who, requestId))!.bytes)).toBe(1);
    const link = await ensureLink(t.db, t.actor, requestId);
    b = (await openLink(t.db, link.token))!.brand;
    expect(b.color).toBe("#0a7c3e");
    expect(b.logo).not.toBeNull();

    await removeBrandLogo(t.db, t.actor.tenantId);
    expect((await getBrand(t.db, t.actor.tenantId)).logo).toBeNull();
    expect(await images((await brokerQuotePdf(t.db, t.store, who, requestId))!.bytes)).toBe(0);
    // Another workspace keeps the neutral look.
    expect((await getBrand(t.db, randomUUID())).color).toBe(DEFAULT_COLOR);
  }, 60_000);
});
