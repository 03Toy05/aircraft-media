import zlib from "node:zlib";
import sharp from "sharp";
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFObject } from "pdf-lib";

export const PDF_EXTRACTION_VERSION = "pdf-embedded-1";
export const MIN_IMAGE_SIDE = 100; // smaller embedded images (logos, icons, rules) are reported, not imported

export interface ExtractedImage {
  page: number; // 1-based
  objectName: string; // resource name on the page, e.g. "Im3"
  width: number;
  height: number;
  mimeType: "image/jpeg" | "image/png";
  bytes: Uint8Array;
}

export interface SkippedImage {
  page: number;
  objectName: string;
  reason: string;
}

export interface PdfExtraction {
  pageCount: number;
  images: ExtractedImage[];
  skipped: SkippedImage[];
}

const nameOf = (o: PDFObject | undefined) => (o instanceof PDFName ? o.decodeText() : undefined);
const numOf = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : undefined);

/** Returns the stream's filters as names, or null when the shape is unsupported. */
function filtersOf(dict: PDFDict): string[] {
  const f = dict.lookup(PDFName.of("Filter"));
  if (!f) return [];
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray) return f.asArray().map((x) => nameOf(dict.context.lookup(x)) ?? "?");
  return ["?"];
}

function channelsOf(dict: PDFDict): number | null {
  const cs = dict.lookup(PDFName.of("ColorSpace"));
  const n = nameOf(cs);
  if (n === "DeviceRGB") return 3;
  if (n === "DeviceGray") return 1;
  if (cs instanceof PDFArray) {
    const first = nameOf(dict.context.lookup(cs.get(0)));
    if (first === "ICCBased") {
      const profile = dict.context.lookup(cs.get(1));
      if (profile instanceof PDFRawStream) {
        const nn = numOf(profile.dict.lookup(PDFName.of("N")));
        if (nn === 1 || nn === 3) return nn;
      }
    }
    if (first === "CalRGB") return 3;
    if (first === "CalGray") return 1;
  }
  return null; // Indexed, Separation, CMYK, … are not decoded here
}

/** Undo PNG-style predictors (PDF /Predictor 10–15) on already-inflated data. */
function unpredict(data: Uint8Array, colors: number, columns: number, bpc: number): Uint8Array {
  const bpp = Math.max(1, (colors * bpc) >> 3);
  const rowLen = (columns * colors * bpc + 7) >> 3;
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (rowLen + 1)];
    const src = r * (rowLen + 1) + 1;
    const dst = r * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const x = data[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = r > 0 ? out[dst - rowLen + i] : 0;
      const c = r > 0 && i >= bpp ? out[dst - rowLen + i - bpp] : 0;
      let v: number;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unknown predictor row type ${ft}`);
      }
      out[dst + i] = v & 0xff;
    }
  }
  return out;
}

/**
 * Deterministic extraction of embedded photographs (no rendering, no AI). Supports JPEG (DCT) and
 * Flate 8-bit gray/RGB images, with or without PNG predictors. Everything else — and tiny
 * decorative images — is reported in `skipped` with a reason so nothing is silently dropped.
 * Extraction does not establish aircraft identity, operator, rights or configuration.
 */
export async function extractPdfImages(bytes: Uint8Array): Promise<PdfExtraction> {
  let pages: ReturnType<PDFDocument["getPages"]>;
  try {
    pages = (await PDFDocument.load(bytes, { updateMetadata: false })).getPages();
  } catch {
    throw new Error("The PDF could not be read (damaged or password-protected).");
  }
  const images: ExtractedImage[] = [];
  const skipped: SkippedImage[] = [];

  for (let p = 0; p < pages.length; p++) {
    const resources = pages[p].node.Resources();
    const xobjects = resources?.lookup(PDFName.of("XObject"));
    if (!(xobjects instanceof PDFDict)) continue;
    for (const [key] of xobjects.entries()) {
      const objectName = key.decodeText();
      const obj = xobjects.lookup(key);
      if (!(obj instanceof PDFRawStream)) continue;
      const d = obj.dict;
      if (nameOf(d.lookup(PDFName.of("Subtype"))) !== "Image") continue;
      const skip = (reason: string) => skipped.push({ page: p + 1, objectName, reason });

      const width = numOf(d.lookup(PDFName.of("Width"))) ?? 0;
      const height = numOf(d.lookup(PDFName.of("Height"))) ?? 0;
      if (d.lookup(PDFName.of("ImageMask")) instanceof PDFBool && (d.lookup(PDFName.of("ImageMask")) as PDFBool).asBoolean()) {
        skip("image mask (not a photograph)");
        continue;
      }
      if (width < MIN_IMAGE_SIDE || height < MIN_IMAGE_SIDE) {
        skip(`smaller than ${MIN_IMAGE_SIDE}px (${width}×${height}); likely decorative`);
        continue;
      }
      const filters = filtersOf(d);
      try {
        if (filters.length === 1 && filters[0] === "DCTDecode") {
          const meta = await sharp(obj.contents).metadata();
          if (meta.space === "cmyk") {
            const rgb = await sharp(obj.contents).toColourspace("srgb").jpeg({ quality: 95 }).toBuffer();
            images.push({ page: p + 1, objectName, width, height, mimeType: "image/jpeg", bytes: new Uint8Array(rgb) });
          } else {
            images.push({ page: p + 1, objectName, width, height, mimeType: "image/jpeg", bytes: obj.contents });
          }
        } else if (filters.length === 1 && filters[0] === "FlateDecode") {
          const channels = channelsOf(d);
          const bpc = numOf(d.lookup(PDFName.of("BitsPerComponent"))) ?? 8;
          if (!channels || bpc !== 8) {
            skip("unsupported colour format or bit depth");
            continue;
          }
          let raw: Uint8Array = zlib.inflateSync(obj.contents);
          const parms = d.lookup(PDFName.of("DecodeParms"));
          const predictor = parms instanceof PDFDict ? (numOf(parms.lookup(PDFName.of("Predictor"))) ?? 1) : 1;
          if (predictor >= 10) raw = unpredict(raw, channels, width, bpc);
          else if (predictor !== 1) {
            skip(`unsupported predictor ${predictor}`);
            continue;
          }
          if (raw.length < width * height * channels) {
            skip("image data is shorter than its declared size");
            continue;
          }
          const png = await sharp(raw, { raw: { width, height, channels: channels as 1 | 3 } }).png().toBuffer();
          images.push({ page: p + 1, objectName, width, height, mimeType: "image/png", bytes: new Uint8Array(png) });
        } else {
          skip(`unsupported image encoding (${filters.join("+") || "none"})`);
        }
      } catch (e) {
        skip(`could not be decoded (${(e as Error).message})`);
      }
    }
  }
  return { pageCount: pages.length, images, skipped };
}
