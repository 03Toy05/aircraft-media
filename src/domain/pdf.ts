import zlib from "node:zlib";
import sharp from "sharp";
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFObject } from "pdf-lib";

export const PDF_EXTRACTION_VERSION = "pdf-embedded-3";
export const MIN_IMAGE_SIDE = 100; // smaller embedded images (logos, icons, rules) are reported, not imported

export interface ExtractedImage {
  page: number; // 1-based
  objectName: string; // resource name on the page, e.g. "Im3" (or "Fm1/Im3" inside a form)
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

/**
 * Text wrappings some PDF makers put around image data (ASCII85 "<~...~>" and hex "<...>"). They carry the same
 * bytes, only spelled as letters; undoing them leaves the photo's own encoding (JPEG, Flate, ...).
 */
function ascii85(data: Uint8Array): Uint8Array {
  const s = new TextDecoder("latin1").decode(data);
  const from = s.startsWith("<~") ? 2 : 0;
  let to = s.indexOf("~>", from);
  if (to < 0) to = s.length;
  const out = new Uint8Array(Math.ceil(((to - from) * 4) / 5) + 4 * 1024);
  let buf = out;
  let len = 0;
  const put = (b: number) => {
    if (len === buf.length) { const bigger = new Uint8Array(buf.length * 2); bigger.set(buf); buf = bigger; }
    buf[len++] = b;
  };
  let tuple = 0;
  let n = 0;
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i);
    if (c <= 32) continue; // spaces and line breaks
    if (c === 122 && n === 0) { put(0); put(0); put(0); put(0); continue; } // "z": four zero bytes
    if (c < 33 || c > 117) throw new Error("bad ASCII85 data");
    tuple = tuple * 85 + (c - 33);
    if (++n === 5) {
      put(Math.floor(tuple / 16777216) & 255); put(Math.floor(tuple / 65536) & 255); put(Math.floor(tuple / 256) & 255); put(tuple & 255);
      tuple = 0;
      n = 0;
    }
  }
  if (n > 0) {
    for (let k = n; k < 5; k++) tuple = tuple * 85 + 84;
    const last = [Math.floor(tuple / 16777216) & 255, Math.floor(tuple / 65536) & 255, Math.floor(tuple / 256) & 255, tuple & 255];
    for (let k = 0; k < n - 1; k++) put(last[k]);
  }
  return buf.subarray(0, len);
}

function asciiHex(data: Uint8Array): Uint8Array {
  const s = new TextDecoder("latin1").decode(data);
  const end = s.indexOf(">");
  const hex = (end < 0 ? s : s.slice(0, end)).replace(/[^0-9a-f]/gi, "");
  const out = new Uint8Array(Math.ceil(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt((hex.slice(i * 2, i * 2 + 2) + "0").slice(0, 2), 16);
  return out;
}

/** The DecodeParms that belong to one filter of the chain (a single dict, or one entry of an array). */
function parmsFor(dict: PDFDict, index: number): PDFDict | undefined {
  const p = dict.lookup(PDFName.of("DecodeParms"));
  if (p instanceof PDFDict) return p;
  if (p instanceof PDFArray) { const x = dict.context.lookup(p.get(index)); return x instanceof PDFDict ? x : undefined; }
  return undefined;
}

/** Channels of an ICC profile stream or a Cal space, if it is one we know. */
function channelsOfSpace(context: PDFDict["context"], cs: PDFObject | undefined): 1 | 3 | 4 | null {
  const n = nameOf(cs);
  if (n === "DeviceRGB" || n === "CalRGB") return 3;
  if (n === "DeviceGray" || n === "CalGray") return 1;
  if (n === "DeviceCMYK") return 4;
  if (cs instanceof PDFArray) {
    const first = nameOf(context.lookup(cs.get(0)));
    if (first === "ICCBased") {
      const profile = context.lookup(cs.get(1));
      if (profile instanceof PDFRawStream) {
        const nn = numOf(profile.dict.lookup(PDFName.of("N")));
        if (nn === 1 || nn === 3 || nn === 4) return nn;
      }
    }
    if (first === "CalRGB") return 3;
    if (first === "CalGray") return 1;
  }
  return null;
}

/** The colour space of a Flate image, as something we can turn into RGB or gray pixels. */
type Colour =
  | { kind: "direct"; channels: 1 | 3 }
  | { kind: "cmyk" }
  | { kind: "indexed"; baseChannels: 1 | 3 | 4; palette: Uint8Array; hival: number };

function colourOf(dict: PDFDict): Colour | null {
  const cs = dict.lookup(PDFName.of("ColorSpace"));
  const direct = channelsOfSpace(dict.context, cs);
  if (direct === 1 || direct === 3) return { kind: "direct", channels: direct };
  if (direct === 4) return { kind: "cmyk" };
  if (cs instanceof PDFArray && nameOf(dict.context.lookup(cs.get(0))) === "Indexed") {
    const baseChannels = channelsOfSpace(dict.context, dict.context.lookup(cs.get(1)));
    const hival = numOf(dict.context.lookup(cs.get(2)));
    const lookup = dict.context.lookup(cs.get(3));
    let palette: Uint8Array | null = null;
    if (lookup instanceof PDFRawStream) {
      const f = filtersOf(lookup.dict);
      palette = f.length === 0 ? lookup.contents : f.length === 1 && f[0] === "FlateDecode" ? zlib.inflateSync(lookup.contents) : null;
    } else if (lookup && typeof (lookup as unknown as { asBytes?: () => Uint8Array }).asBytes === "function") {
      palette = (lookup as unknown as { asBytes: () => Uint8Array }).asBytes();
    }
    if (baseChannels && hival != null && palette) return { kind: "indexed", baseChannels, palette, hival };
  }
  return null;
}

/** CMYK (as stored in PDFs: 0 = no ink) to RGB, 8 bits per channel. */
function cmykToRgb(raw: Uint8Array, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    const c = raw[i * 4], m = raw[i * 4 + 1], y = raw[i * 4 + 2], k = raw[i * 4 + 3];
    out[i * 3] = Math.round(((255 - c) * (255 - k)) / 255);
    out[i * 3 + 1] = Math.round(((255 - m) * (255 - k)) / 255);
    out[i * 3 + 2] = Math.round(((255 - y) * (255 - k)) / 255);
  }
  return out;
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
 * Deterministic extraction of embedded photographs (no rendering, no AI). Supports JPEG (DCT, also behind Flate),
 * JPEG 2000 where the image library can read it, and Flate images in gray, RGB, CMYK or a palette, with or without
 * PNG predictors. Photos placed inside form objects (how InDesign, Canva, PowerPoint and Word often export them)
 * are found too, and a photo used on several pages is taken once. Everything else, and tiny decorative images, is
 * reported in `skipped` with a reason so nothing is silently dropped.
 * Extraction does not establish aircraft identity, operator, rights or configuration.
 */
export async function extractPdfImages(bytes: Uint8Array): Promise<PdfExtraction> {
  let pages: ReturnType<PDFDocument["getPages"]>;
  try {
    pages = (await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })).getPages();
  } catch {
    throw new Error("The PDF could not be read (damaged or password-protected).");
  }
  const images: ExtractedImage[] = [];
  const skipped: SkippedImage[] = [];
  const seen = new Set<string>(); // images and forms already visited, by object number

  async function takeImage(obj: PDFRawStream, page: number, objectName: string) {
    const d = obj.dict;
    const skip = (reason: string) => { skipped.push({ page, objectName, reason }); };
    const width = numOf(d.lookup(PDFName.of("Width"))) ?? 0;
    const height = numOf(d.lookup(PDFName.of("Height"))) ?? 0;
    const mask = d.lookup(PDFName.of("ImageMask"));
    if (mask instanceof PDFBool && mask.asBoolean()) return skip("image mask (not a photograph)");
    if (width < MIN_IMAGE_SIDE || height < MIN_IMAGE_SIDE) return skip(`smaller than ${MIN_IMAGE_SIDE}px (${width}×${height}); likely decorative`);
    let filters = filtersOf(d);
    const allFilters = filters;
    let data: Uint8Array = obj.contents;
    try {
      // Spelled-out data ("ASCII85Decode+DCTDecode"): turn the letters back into bytes first.
      while (filters[0] === "ASCII85Decode" || filters[0] === "ASCIIHexDecode") {
        data = filters[0] === "ASCII85Decode" ? ascii85(data) : asciiHex(data);
        filters = filters.slice(1);
      }
      // Flate wrapped around a JPEG or JPEG 2000: unwrap first.
      if (filters.length === 2 && filters[0] === "FlateDecode" && (filters[1] === "DCTDecode" || filters[1] === "JPXDecode")) {
        data = zlib.inflateSync(data);
        filters = [filters[1]];
      }
      if (filters.length === 1 && filters[0] === "DCTDecode") {
        const meta = await sharp(data).metadata();
        if (meta.space === "cmyk") {
          const rgb = await sharp(data).toColourspace("srgb").jpeg({ quality: 95 }).toBuffer();
          images.push({ page, objectName, width, height, mimeType: "image/jpeg", bytes: new Uint8Array(rgb) });
        } else images.push({ page, objectName, width, height, mimeType: "image/jpeg", bytes: data });
        return;
      }
      if (filters.length === 1 && filters[0] === "JPXDecode") {
        try {
          const jpg = await sharp(data).toColourspace("srgb").jpeg({ quality: 95 }).toBuffer();
          images.push({ page, objectName, width, height, mimeType: "image/jpeg", bytes: new Uint8Array(jpg) });
        } catch {
          skip("JPEG 2000 photo, which this server cannot read yet");
        }
        return;
      }
      if (filters.length === 1 && filters[0] === "FlateDecode") {
        const colour = colourOf(d);
        const bpc = numOf(d.lookup(PDFName.of("BitsPerComponent"))) ?? 8;
        if (!colour || bpc !== 8) return skip("unsupported colour format or bit depth");
        const inChannels = colour.kind === "direct" ? colour.channels : colour.kind === "cmyk" ? 4 : 1;
        let raw: Uint8Array = zlib.inflateSync(data);
        const parms = parmsFor(d, allFilters.lastIndexOf("FlateDecode"));
        const predictor = parms ? (numOf(parms.lookup(PDFName.of("Predictor"))) ?? 1) : 1;
        if (predictor >= 10) raw = unpredict(raw, inChannels, width, bpc);
        else if (predictor !== 1) return skip(`unsupported predictor ${predictor}`);
        const pixels = width * height;
        if (raw.length < pixels * inChannels) return skip("image data is shorter than its declared size");
        let out: Uint8Array;
        let channels: 1 | 3;
        if (colour.kind === "direct") { out = raw; channels = colour.channels; }
        else if (colour.kind === "cmyk") { out = cmykToRgb(raw, pixels); channels = 3; }
        else {
          // Palette: look each pixel up, then turn the base colour into RGB.
          const bc = colour.baseChannels;
          const expanded = new Uint8Array(pixels * bc);
          for (let i = 0; i < pixels; i++) {
            const idx = Math.min(raw[i], colour.hival) * bc;
            for (let c = 0; c < bc; c++) expanded[i * bc + c] = colour.palette[idx + c] ?? 0;
          }
          if (bc === 4) { out = cmykToRgb(expanded, pixels); channels = 3; } else { out = expanded; channels = bc; }
        }
        const png = await sharp(out, { raw: { width, height, channels } }).png().toBuffer();
        images.push({ page, objectName, width, height, mimeType: "image/png", bytes: new Uint8Array(png) });
        return;
      }
      skip(`unsupported image encoding (${filters.join("+") || "none"})`);
    } catch (e) {
      skip(`could not be decoded (${(e as Error).message})`);
    }
  }

  async function walk(resources: PDFDict | undefined, page: number, depth: number, prefix: string) {
    const xobjects = resources?.lookup(PDFName.of("XObject"));
    if (!(xobjects instanceof PDFDict) || depth > 8) return;
    for (const [key, value] of xobjects.entries()) {
      const id = value instanceof PDFRef ? value.toString() : null;
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      const obj = xobjects.lookup(key);
      if (!(obj instanceof PDFRawStream)) continue;
      const subtype = nameOf(obj.dict.lookup(PDFName.of("Subtype")));
      const objectName = `${prefix}${key.decodeText()}`;
      if (subtype === "Image") await takeImage(obj, page, objectName);
      else if (subtype === "Form") {
        // A form without resources of its own uses the page's.
        const own = obj.dict.lookup(PDFName.of("Resources"));
        await walk(own instanceof PDFDict ? own : resources, page, depth + 1, `${objectName}/`);
      }
    }
  }

  for (let p = 0; p < pages.length; p++) await walk(pages[p].node.Resources(), p + 1, 0, "");
  return { pageCount: pages.length, images, skipped };
}
