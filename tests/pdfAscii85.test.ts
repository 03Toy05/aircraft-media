import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument, PDFName } from "pdf-lib";
import { extractPdfImages } from "../src/domain/pdf";

/** ASCII85 as PDF makers write it ("<~" ... "~>", with "z" for four zero bytes and line breaks). */
function ascii85(bytes: Uint8Array): string {
  let out = "<~";
  for (let i = 0; i < bytes.length; i += 4) {
    const chunk = [bytes[i], bytes[i + 1] ?? 0, bytes[i + 2] ?? 0, bytes[i + 3] ?? 0];
    const n = Math.min(4, bytes.length - i);
    let v = ((chunk[0] << 24) >>> 0) + (chunk[1] << 16) + (chunk[2] << 8) + chunk[3];
    if (v === 0 && n === 4) { out += "z"; continue; }
    const c: string[] = [];
    for (let k = 0; k < 5; k++) { c.unshift(String.fromCharCode((v % 85) + 33)); v = Math.floor(v / 85); }
    out += c.slice(0, n + 1).join("");
    if ((i / 4) % 16 === 15) out += "\n";
  }
  return out + "~>";
}

describe("PDF photos spelled out as text (ASCII85, hex)", () => {
  it("reads ASCII85+DCT and ASCIIHex+DCT photos, as in the N818CJ photo sheet", async () => {
    const jpg = new Uint8Array(await sharp({ create: { width: 640, height: 400, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer());
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 400]);
    const img = (filters: string[], contents: string) =>
      doc.context.register(doc.context.stream(contents, { Type: "XObject", Subtype: "Image", Width: 640, Height: 400, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: filters.map((f) => PDFName.of(f)) }));
    page.node.setXObject(PDFName.of("A85"), img(["ASCII85Decode", "DCTDecode"], ascii85(jpg)));
    page.node.setXObject(PDFName.of("Hex"), img(["ASCIIHexDecode", "DCTDecode"], Buffer.from(jpg).toString("hex") + ">"));
    const r = await extractPdfImages(new Uint8Array(await doc.save()));
    expect(r.skipped).toEqual([]);
    expect(r.images).toHaveLength(2);
    for (const im of r.images) expect(Buffer.from(im.bytes).equals(Buffer.from(jpg))).toBe(true);
  });
});
