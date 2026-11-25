import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { setup, makeImage } from "./helpers";
import { ingestUpload } from "../src/domain/media";
import { cleanSnapshot, saveQuoteVersion } from "../src/domain/requests";
import { brokerQuotePdf, pdfSupported, wrap } from "../src/domain/quotePdf";

/** How many images the PDF draws (XObjects of subtype Image, on any page). */
async function imageCount(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  let n = 0;
  for (const p of doc.getPages()) {
    const xo = p.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
    if (xo) n += xo.keys().length;
  }
  return { doc, n };
}

describe("Quote PDF", () => {
  it("wraps by words, or by characters where a script has no spaces", () => {
    const f = { widthOfTextAtSize: (s: string, size: number) => s.length * size * 0.5 }; // every character half the size wide
    expect(wrap("Hello brave new world", f, 10, 60)).toEqual(["Hello brave", "new world"]);
    expect(wrap("飛機選項航空機のご提案", f, 10, 30)).toEqual(["飛機選項航空", "機のご提案"]);
    expect(wrap("line one\nline two", f, 10, 500)).toEqual(["line one", "line two"]);
    expect(wrap("", f, 10, 100)).toEqual([""]);
  });

  it("makes an A4 PDF of a saved version with its photos, and none in a language it can't show", async () => {
    const t = await setup();
    const p1 = (await ingestUpload(t.db, t.store, t.actor, { filename: "ext.png", bytes: await makeImage(800, 500, 601) })).result.contentVersionId;
    const p2 = (await ingestUpload(t.db, t.store, t.actor, { filename: "cab.png", bytes: await makeImage(800, 500, 602) })).result.contentVersionId;
    const legs = [{ from: "VHHH", to: "EGLF", date: "2026-12-12", time: "16:30", flight: 765, pax: 4 }];
    const snap = (lang: string, photos: string[]) => cleanSnapshot({
      lang, text: "x", greeting: "您好，以下是飛機選項：", closing: "Thank you",
      options: [{ aircraftId: randomUUID(), type: "Bombardier Global 6000", operator: "Sheet Air", price: "USD 210,000 + tax", yom: 2014, capacity: 13, extra: "From 12 Dec",
        photos: photos.map((id, i) => ({ id, label: `P${i}`, classification: i === 0 ? "exterior" : "cabin" })) }],
      builder: { inc: { operator: true } },
    });
    const who = { isAdmin: false, actor: t.actor, email: "owner@example.test" };
    const { requestId, reference } = await saveQuoteVersion(t.db, t.actor, null, legs, snap("zh-Hant", [p1, p2, randomUUID()])); // the last photo isn't theirs

    const pdf = await brokerQuotePdf(t.db, t.store, who, requestId);
    expect(pdf?.filename).toBe(`${reference}-v1.pdf`);
    const { doc, n } = await imageCount(pdf!.bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(595.28, 1);
    expect(doc.getTitle()).toBe(`您的包機方案 · ${reference} | v1`);
    expect(pdf?.filename).toBe(`${reference}-v1.pdf`);
    expect(n).toBe(2); // exterior + one cabin; the photo that isn't theirs is left out
    expect(doc.getPageCount()).toBe(2); // the summary, then one page for the aircraft
    expect(pdf!.bytes.length).toBeLessThan(2_000_000); // the font goes in as a subset

    // Another workspace gets nothing; a language the font can't show gets no PDF.
    expect(await brokerQuotePdf(t.db, t.store, { isAdmin: false, actor: { id: randomUUID(), tenantId: randomUUID() }, email: "x@y.z" }, requestId)).toBeNull();
    await saveQuoteVersion(t.db, t.actor, requestId, legs, snap("ko", [p1]));
    expect(await brokerQuotePdf(t.db, t.store, who, requestId)).toBeNull(); // the latest (v2) is Korean
    expect((await brokerQuotePdf(t.db, t.store, who, requestId, 1))?.version).toBe(1);
    expect(pdfSupported("en") && pdfSupported("ja") && !pdfSupported("zh-Hans") && !pdfSupported("ar")).toBe(true);
  }, 60_000);
});

describe("Fixed photo layout", () => {
  it("puts one exterior, two cabin photos and the floor plan in their places", async () => {
    const { photoSlots } = await import("../src/domain/quotePdf");
    const p = (id: string, classification: string) => ({ id, classification });
    expect(photoSlots([p("c1", "cabin"), p("e1", "exterior"), p("f1", "floor_plan"), p("c2", "cabin"), p("c3", "cabin"), p("e2", "exterior"), p("x", "combined")]))
      .toEqual({ exterior: p("e1", "exterior"), cabins: [p("c1", "cabin"), p("c2", "cabin")], floorPlan: p("f1", "floor_plan") });
    expect(photoSlots([p("o1", "other"), p("c1", "cabin")])).toEqual({ exterior: p("o1", "other"), cabins: [p("c1", "cabin")], floorPlan: null });
    expect(photoSlots([])).toEqual({ exterior: null, cabins: [], floorPlan: null });
  });
});

describe("Reference format, version names and owner's approval", () => {
  it("writes the reference the broker's way, names files safely, and spots the owner's approval", async () => {
    const { formatVersion, validVersionFormat, versionFileName, DEFAULT_VERSION_FORMAT } = await import("../src/domain/branding");
    const { needsOwnerApproval, cleanSnapshot } = await import("../src/domain/requests");
    expect(formatVersion(DEFAULT_VERSION_FORMAT, "AM-2611-003", 2)).toBe("AM-2611-003 | v2");
    expect(formatVersion("{ref} Rev.{n}", "AM-2611-003", 2)).toBe("AM-2611-003 Rev.2");
    expect(formatVersion("{ref}-{nn}", "AM-2611-003", 2)).toBe("AM-2611-003-02");
    expect(formatVersion("no placeholders", "AM-2611-003", 2)).toBe("AM-2611-003 | v2"); // a broken format falls back
    expect(validVersionFormat("{ref} Version {n}")).toBe(true);
    expect(validVersionFormat("{ref} only")).toBe(false);
    expect(validVersionFormat("<script>{ref}{n}")).toBe(false);
    expect(versionFileName("{ref} | v{n}", "AM-2611-003", 2)).toBe("AM-2611-003-v2.pdf");
    expect(versionFileName("{ref}/V{nn}", "AM-2611-003", 12)).toBe("AM-2611-003-V12.pdf");

    expect(needsOwnerApproval("Owner's approval required. Pets TBC.")).toBe(true);
    expect(needsOwnerApproval("subject to owner's approval")).toBe(true);
    expect(needsOwnerApproval("Owner approval needed")).toBe(true);
    expect(needsOwnerApproval("Pets on request")).toBe(false);
    expect(needsOwnerApproval(null)).toBe(false);

    const snap = cleanSnapshot({ lang: "en", text: "x", label: "  Revised price  ", options: [{ type: "G650", wifi: "yes", smoking: "no", pets: "tbc", notes: "Owner's approval required", photos: [] }], builder: {} });
    expect(snap.label).toBe("Revised price");
    expect(snap.options[0]).toMatchObject({ wifi: "yes", smoking: "no", pets: "tbc", notes: "Owner's approval required" });
  });
});
