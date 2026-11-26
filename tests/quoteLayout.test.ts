import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { readDocxLayout, paraText, type LPara } from "@/domain/docxLayout";
import { layoutTemplate, type TBlock } from "@/domain/layoutTemplate";
import { checkWordFile, layoutValues } from "@/domain/quoteLayout";
import { expand, layoutPdf } from "@/domain/layoutPdf";
import { sampleWordTemplate, wordDocx } from "@/domain/wordSample";
import type { PdfQuote } from "@/domain/quotePdf";

/** A broker's past quote, as they might have typed it: logo, client, routing table, two aircraft, terms. */
const pastQuote = () =>
  wordDocx([
    { text: "", image: [120, 40] },
    { text: "SKYLINE CHARTERS", bold: true, size: 18, color: "1f3a5f", align: "center" },
    "Quotation No.: SC-2311-07",
    "Date: 3 November 2025",
    "To: Mr David Wong",
    "",
    "Dear Mr Wong,",
    { table: [["Date", "From", "To", "Departure", "Pax"], ["12 Nov 2025", "HKG", "NRT", "10:00", "4"], ["15 Nov 2025", "NRT", "HKG", "15:00", "4"]], borders: true },
    { text: "Option 1", bold: true },
    "Aircraft: Gulfstream G650ER",
    "Seats: 13    Year of manufacture: 2018",
    "Wi-Fi: Yes",
    { text: "", image: [400, 220] },
    { text: "", image: [200, 120] },
    "Price: USD 120,000",
    { text: "\fOption 2", bold: true },
    "Aircraft: Bombardier Global 6000",
    "Seats: 14    Year of manufacture: 2015",
    "Wi-Fi: No",
    { text: "", image: [400, 220] },
    "Price: USD 98,000",
    "",
    "Terms: prices include crew, fuel and landing fees. A 50% deposit of USD 10,000 or more secures the aircraft.",
    "Best regards,",
    "Skyline Charters",
  ]);

const option = (over: Partial<PdfQuote["quote"]["options"][number]> = {}) => ({
  aircraftId: "a1", type: "Dassault Falcon 7X", operator: "Sky Ops", tail: "B-LDE", base: "VHHH", yom: 2016, yor: 2022, capacity: 12,
  price: "USD 88,000", extra: "", wifi: "yes", smoking: "no", pets: "yes", notes: null,
  photos: [{ id: "ext1", label: "", classification: "exterior" }],
  ...over,
});
const quote = (options = [option()], lang = "en"): PdfQuote => ({
  reference: "AM-2611-004", version: 1, savedAt: new Date("2026-11-26T03:00:00Z"), broker: { name: "Wallace", email: "w@example.com" },
  quote: { lang, text: "", legs: [{ from: "VHHH", to: "RJTT", date: "2026-12-12", time: "10:00", flight: 240, pax: 4 }, { from: "RJTT", to: "VHHH", date: "2026-12-15", time: "15:00", flight: 270, pax: 4 }], options, builder: { inc: {} }, greeting: "Dear Ms Lee,", closing: "Kind regards" },
});
const texts = (blocks: ReturnType<typeof expand>) =>
  blocks.map((b) => (b.t === "p" ? b.runs.map((r) => r.text).join("") : b.rows.map((r) => r.cells.map((c) => c.blocks.map((p) => p.runs.map((x) => x.text).join("")).join(" ")).join(" | ")).join("\n"))).join("\n");

describe("the broker's own quote layout", () => {
  it("reads the look of a Word file: styles, alignment, tables, pictures", () => {
    const l = readDocxLayout(pastQuote());
    const title = l.body[1] as LPara;
    expect(paraText(title)).toBe("SKYLINE CHARTERS");
    expect(title.align).toBe("center");
    expect(title.runs[0]).toMatchObject({ b: true, size: 18, color: "1f3a5f" });
    expect(l.body.some((b) => b.t === "tbl" && b.borders && b.rows.length === 3)).toBe(true);
    expect((l.body[0] as LPara).runs.find((r) => r.image)?.image).toEqual({ w: 120, h: 40 });
    expect(l.page.w).toBeCloseTo(595.3, 0);
  });

  it("finds the quote's values by their labels, and repeats the aircraft part", () => {
    const { layout, found } = layoutTemplate(readDocxLayout(pastQuote()));
    expect(found.fields).toEqual(expect.arrayContaining(["reference", "date", "greeting", "routing table", "number", "aircraft", "seats", "yom", "wifi", "price"]));
    expect(found.clientBlanked).toBe(true);
    expect(found.section).toBe(true);
    expect(found.photos).toBe(2);
    expect(found.logo).toBe(true);
    const each = layout.body.filter((b: TBlock) => b.t === "each");
    expect(each).toHaveLength(1); // the second option was a copy of the first
    const all = JSON.stringify(layout.body);
    expect(all).not.toContain("Wong"); // the old client is gone
    expect(all).not.toContain("G650ER");
    expect(all).toContain("50% deposit of USD 10,000"); // terms are kept as written
  });

  it("fills a new quote into it: one part per aircraft, one row per leg", () => {
    const { layout } = layoutTemplate(readDocxLayout(pastQuote()));
    const v = layoutValues(quote([option(), option({ type: "Embraer Legacy 600", price: "USD 60,000", wifi: "no" })]));
    const out = texts(expand(layout.body, v));
    expect(out).toContain("Quotation No.: AM-2611-004 | v1");
    expect(out).toContain("Dear Ms Lee,");
    expect(out).toContain("Option 1");
    expect(out).toContain("Aircraft: Dassault Falcon 7X");
    expect(out).toContain("Option 2");
    expect(out).toContain("Aircraft: Embraer Legacy 600");
    expect(out).toContain("Price: USD 60,000");
    expect(out).toMatch(/12 Dec 2026 \| Hong Kong.*\| Tokyo/);
    expect(out).toMatch(/15 Dec 2026 \| Tokyo/);
    expect(out).not.toContain("To:"); // the client line, now empty, is left out
  });

  it("draws the PDF with the photos in the photo places", async () => {
    const { layout } = layoutTemplate(readDocxLayout(pastQuote()));
    const png = new Uint8Array(await sharp({ create: { width: 400, height: 220, channels: 3, background: "#336699" } }).png().toBuffer());
    const loads: string[] = [];
    const two = quote([option(), option({ photos: [{ id: "ext2", label: "", classification: "exterior" }] })]);
    const bytes = await layoutPdf(layout, layoutValues(two), "en", async (id) => { loads.push(id); return { bytes: png, mimeType: "image/png" }; }, { title: "Quote", author: "Wallace" });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2); // the second aircraft starts on a new page, as in the Word file
    expect(loads).toEqual(["ext1", "ext2"]);
  });

  it("draws Chinese quotes with the Chinese font", async () => {
    const { layout } = layoutTemplate(readDocxLayout(pastQuote()));
    const bytes = await layoutPdf(layout, layoutValues(quote([option({ type: "Gulfstream G650ER" })], "zh-Hant")), "zh-Hant", async () => null, { title: "報價", author: "Wallace" });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
    const out = texts(expand(layout.body, layoutValues(quote([option({ type: "Gulfstream G650ER" })], "zh-Hant"))));
    expect(out).toContain("灣流 G650ER（Gulfstream G650ER）");
  });

  it("keeps tags the broker typed, even when Word split them", () => {
    const { layout } = layoutTemplate(readDocxLayout(wordDocx([{ text: "", runs: ["Total: {pri", "ce}"] }, "{routing}"])));
    const out = texts(expand(layout.body, layoutValues(quote())));
    expect(out).toContain("Total: USD 88,000");
    expect(out).toContain("Hong Kong");
  });

  it("does not take a company name for an aircraft", () => {
    const { found } = layoutTemplate(readDocxLayout(wordDocx(["Premier Aviation Limited"])));
    expect(found.fields).not.toContain("aircraft");
  });

  it("accepts Word files only", () => {
    expect(checkWordFile(sampleWordTemplate())).toBeNull();
    expect(checkWordFile(new Uint8Array([1, 2, 3]))).toBe("not_docx");
  });

  it("works with the sample layout's tags", () => {
    const { layout, found } = layoutTemplate(readDocxLayout(sampleWordTemplate()));
    expect(found.section).toBe(true);
    const out = texts(expand(layout.body, layoutValues(quote([option(), option({ type: "Embraer Legacy 600" })]))));
    expect(out).toContain("Option 2: Embraer Legacy 600");
    expect(out).not.toMatch(/\{[a-z_]+\}/);
  });
});
