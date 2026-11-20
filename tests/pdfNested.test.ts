import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument, PDFName } from "pdf-lib";
import { setup } from "./helpers";
import { extractPdfImages } from "../src/domain/pdf";
import { ingestPdf } from "../src/domain/intake";

const jpeg = async (w: number, h: number, r: number) =>
  new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r, g: 90, b: 160 } } }).jpeg().toBuffer());

/** How InDesign, Canva and PowerPoint often export: the photo sits inside a form object, not on the page itself. */
async function nestedPdf() {
  const inner = await PDFDocument.create();
  inner.addPage([600, 400]).drawImage(await inner.embedJpg(await jpeg(800, 500, 120)), { x: 0, y: 0, width: 600, height: 400 });
  const outer = await PDFDocument.create();
  const [embedded] = await outer.embedPdf(await inner.save());
  const page = outer.addPage([600, 400]);
  page.drawPage(embedded);
  // And a CMYK photo stored uncompressed-as-pixels (Flate), as print PDFs do.
  const w = 200, h = 150;
  const cmyk = new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 0 : i % 4 === 0 ? 255 : 0)); // pure cyan
  const stream = outer.context.flateStream(cmyk, { Type: "XObject", Subtype: "Image", Width: w, Height: h, ColorSpace: "DeviceCMYK", BitsPerComponent: 8 });
  page.node.setXObject(PDFName.of("ImCmyk"), outer.context.register(stream));
  return new Uint8Array(await outer.save());
}

describe("PDF photos inside form objects, and CMYK photos", () => {
  it("finds both", async () => {
    const r = await extractPdfImages(await nestedPdf());
    expect(r.images.map((i) => [i.width, i.height]).sort()).toEqual([[200, 150], [800, 500]]);
    const cmyk = r.images.find((i) => i.width === 200)!;
    const px = await sharp(cmyk.bytes).raw().toBuffer();
    expect([px[0], px[1], px[2]]).toEqual([0, 255, 255]); // cyan
  });

  it("reads the same PDF again after extraction improves, without duplicating photos", async () => {
    const t = await setup();
    const bytes = await nestedPdf();
    const a = await ingestPdf(t.db, t.store, t.actor, { filename: "brochure.pdf", bytes });
    expect(a.result.extracted).toHaveLength(2);
    const b = await ingestPdf(t.db, t.store, t.actor, { filename: "brochure.pdf", bytes });
    expect(b.result.extracted.map((e) => e.mediaId).sort()).toEqual(a.result.extracted.map((e) => e.mediaId).sort());
  });
});
