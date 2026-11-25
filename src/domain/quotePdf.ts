import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { airportsFor } from "./airports";
import { airportPlace, legTimes, type Leg } from "./routing";
import { QUOTE_LANGUAGES, QUOTE_LOCALE, QUOTE_SUBJECT, QUOTE_WORDS, type QuoteLanguage } from "./quote";
import type { QuoteSnapshot } from "./requests";

/**
 * A quote version as a PDF (A4): the broker's details, the reference, the routing with local and UTC times, each
 * aircraft with its photos, details and price, and the opening and closing lines. Neutral styling with room for the
 * broker's logo, colours and terms once branding exists. Font: Noto Sans TC (SIL OFL), embedded as a subset.
 */

/** Languages the embedded font covers completely; the others are read on the client's link instead. */
export const PDF_LANGUAGES: QuoteLanguage[] = ["en", "zh-Hant", "ja", "vi", "fr", "de", "id", "ru"];
export const pdfSupported = (lang: string) => (PDF_LANGUAGES as string[]).includes(lang);

const FONT_FILE = path.join(process.cwd(), "src", "data", "fonts", "NotoSansTC-Regular.otf");
let fontBytes: Buffer | null = null;
const font = () => (fontBytes ??= fs.readFileSync(FONT_FILE));

export interface PdfQuote {
  reference: string; version: number; savedAt: Date; quote: QuoteSnapshot; broker: { name: string; email: string };
  /** The broker's logo and colour (Settings → Quote branding). */
  brand?: { color: string; logo: { png: Uint8Array; width: number; height: number } | null };
}
export type PhotoLoader = (contentVersionId: string) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;

const A4 = { w: 595.28, h: 841.89 };
const M = 42; // margin
const INK = rgb(0.1, 0.12, 0.17), MUTED = rgb(0.42, 0.45, 0.5), LINE = rgb(0.89, 0.9, 0.92);
const hexColor = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);

const langOf = (l: string): QuoteLanguage => ((QUOTE_LANGUAGES as readonly string[]).includes(l) ? (l as QuoteLanguage) : "en");

/** Lines that fit `width`: break at spaces, or between characters where a script has none (Chinese, Japanese). */
export function wrap(text: string, f: Pick<PDFFont, "widthOfTextAtSize">, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    let lastSpace = -1;
    for (const ch of [...para]) {
      const next = line + ch;
      if (f.widthOfTextAtSize(next, size) <= width || !line) {
        line = next;
        if (ch === " ") lastSpace = line.length - 1;
        continue;
      }
      if (ch === " ") { out.push(line); line = ""; lastSpace = -1; continue; }
      if (lastSpace > 0) {
        out.push(line.slice(0, lastSpace));
        line = line.slice(lastSpace + 1) + ch;
      } else {
        out.push(line);
        line = ch;
      }
      lastSpace = line.lastIndexOf(" ");
    }
    out.push(line);
  }
  return out;
}

export async function quotePdf(q: PdfQuote, loadPhoto: PhotoLoader): Promise<Uint8Array> {
  const lang = langOf(q.quote.lang);
  const w = QUOTE_WORDS[lang];
  const locale = QUOTE_LOCALE[lang];
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${q.reference} · ${QUOTE_SUBJECT[lang]}`);
  doc.setAuthor(q.broker.name || q.broker.email);
  doc.setCreator(q.broker.name || "Quotation");
  doc.setProducer(q.broker.name || "Quotation");
  const F = await doc.embedFont(font(), { subset: true });
  const ACCENT = hexColor(q.brand?.color && /^#[0-9a-fA-F]{6}$/.test(q.brand.color) ? q.brand.color : "#1f3a5f");

  let page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const width = A4.w - 2 * M;
  const newPage = () => { page = doc.addPage([A4.w, A4.h]); y = A4.h - M; };
  const need = (h: number) => { if (y - h < M + 24) newPage(); };
  const text = (s: string, x: number, size: number, color = INK) => page.drawText(s, { x, y, size, font: F, color });
  const para = (s: string, size = 10.5, color = INK, indent = 0) => {
    for (const ln of wrap(s, F, size, width - indent)) {
      need(size * 1.5);
      text(ln, M + indent, size, color);
      y -= size * 1.5;
    }
  };
  const rightText = (s: string, size: number, color = INK) => text(s, A4.w - M - F.widthOfTextAtSize(s, size), size, color);
  const rule = (color = LINE, thickness = 0.8) => { page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness, color }); };
  const fmtDate = (d: Date) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(d);
  const fmtIso = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

  // -- header: the broker's logo (or name) and email on the left, the quote's title and reference on the right
  const top = y;
  rightText(QUOTE_SUBJECT[lang], 13);
  y -= 16;
  rightText(`${q.reference} · v${q.version}`, 9.5, MUTED);
  y -= 13;
  rightText(fmtDate(q.savedAt), 9.5, MUTED);
  const rightBottom = y;
  y = top;
  const logo = q.brand?.logo ? await doc.embedPng(q.brand.logo.png).catch(() => null) : null;
  if (logo) {
    const s = Math.min(200 / logo.width, 54 / logo.height, 1);
    const lw = logo.width * s, lh = logo.height * s;
    page.drawImage(logo, { x: M, y: top + 12 - lh, width: lw, height: lh });
    y = top + 12 - lh - 12;
    if (q.broker.email) { text(q.broker.email, M, 9, MUTED); y -= 4; }
  } else {
    text(q.broker.name || q.broker.email, M, 17, ACCENT);
    y -= 16;
    if (q.broker.email && q.broker.name) text(q.broker.email, M, 9, MUTED);
  }
  y = Math.min(y, rightBottom) - 12;
  rule(ACCENT, 2);
  y -= 22;

  if (q.quote.greeting) { para(q.quote.greeting); y -= 6; }

  // -- routing
  const legs: Leg[] = q.quote.legs ?? [];
  if (legs.length) {
    const airports = airportsFor(legs.flatMap((l) => [l.from, l.to]));
    const utc = q.quote.utc !== false;
    need(40);
    text(w.routing, M, 12, ACCENT);
    y -= 18;
    for (const l of legs) {
      const t = legTimes(l, airports);
      const bits: string[] = [];
      if (l.date) bits.push(fmtIso(l.date));
      if (t.depLocal) bits.push(`${w.dep} ${t.depLocal.time} ${w.lt}${utc && t.depUtc ? ` (${t.depUtc.time} UTC)` : ""}`);
      if (t.arrLocal) bits.push(`${w.arr} ${t.arrLocal.time} ${w.lt}${t.arrDays ? ` (+${t.arrDays})` : ""}${utc && t.arrUtc ? ` (${t.arrUtc.time} UTC)` : ""}`);
      if (l.flight) bits.push(w.duration(Math.floor(l.flight / 60), l.flight % 60));
      if (l.pax) bits.push(w.pax(l.pax));
      need(34);
      para(`${airportPlace(l.from, airports)} → ${airportPlace(l.to, airports)}`, 10.5, INK);
      para(bits.join("   ·   "), 9.5, MUTED);
      y -= 4;
    }
    y -= 6;
  }

  // -- the aircraft options
  const inc = (q.quote.builder?.inc ?? {}) as Record<string, boolean>;
  const options = q.quote.options;
  for (const [i, o] of options.entries()) {
    need(60);
    rule();
    y -= 20;
    const title = `${options.length > 1 ? `${w.aircraft} ${i + 1}: ` : ""}${o.type}`;
    const priceW = o.price ? F.widthOfTextAtSize(o.price, 12.5) + 16 : 0;
    const titleLines = wrap(title, F, 13, width - priceW);
    text(titleLines[0], M, 13, ACCENT);
    if (o.price) rightText(o.price, 12.5, ACCENT);
    y -= 18;
    for (const ln of titleLines.slice(1)) { text(ln, M, 13, ACCENT); y -= 18; }

    // Photos: the first one large, then up to three side by side.
    const imgs: { img: PDFImage; w: number; h: number }[] = [];
    for (const p of o.photos.slice(0, 4)) {
      const f = await loadPhoto(p.id).catch(() => null);
      if (!f) continue;
      try {
        const jpg = await sharp(Buffer.from(f.bytes)).rotate().resize({ width: 1400, height: 1000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        const img = await doc.embedJpg(jpg);
        imgs.push({ img, w: img.width, h: img.height });
      } catch { /* a photo that can't be read is left out */ }
    }
    if (imgs.length) {
      const big = imgs[0];
      const bh = Math.min(260, (width * big.h) / big.w);
      const bw = (bh * big.w) / big.h;
      need(bh + 8);
      page.drawImage(big.img, { x: M + (width - bw) / 2, y: y - bh, width: bw, height: bh });
      y -= bh + 6;
      const rest = imgs.slice(1);
      if (rest.length) {
        const gap = 6, cw = (width - gap * 2) / 3, ch = cw * 0.68;
        need(ch + 8);
        rest.forEach((r, j) => {
          const s = Math.min(cw / r.w, ch / r.h);
          const dw = r.w * s, dh = r.h * s;
          page.drawImage(r.img, { x: M + j * (cw + gap) + (cw - dw) / 2, y: y - ch + (ch - dh) / 2, width: dw, height: dh });
        });
        y -= ch + 6;
      }
      y -= 4;
    }

    // Details, three to a row.
    const facts: [string, string][] = [];
    const add = (label: string, v: string | number | null | undefined) => { if (v != null && v !== "") facts.push([label, String(v)]); };
    if (inc.operator) add(w.operator, o.operator);
    if (inc.tail) add(w.tail, o.tail);
    if (inc.base) add(w.base, o.base);
    add(w.yom, o.yom);
    add(w.yor, o.yor);
    if (o.capacity) add(w.capacity, w.seats(o.capacity));
    const colW = width / 3;
    for (let r = 0; r < facts.length; r += 3) {
      need(26);
      facts.slice(r, r + 3).forEach(([label, v], j) => {
        page.drawText(label, { x: M + j * colW, y, size: 8, font: F, color: MUTED });
        page.drawText(wrap(v, F, 10, colW - 8)[0], { x: M + j * colW, y: y - 12, size: 10, font: F, color: INK });
      });
      y -= 26;
    }
    if (o.extra) { y -= 2; para(o.extra, 10); }
    y -= 8;
  }

  if (q.quote.closing) { rule(); y -= 18; para(q.quote.closing); }

  // -- footer on every page: reference and page number
  const pages = doc.getPages();
  pages.forEach((p, n) => {
    const foot = `${q.reference} · v${q.version}`;
    p.drawText(foot, { x: M, y: M - 18, size: 8, font: F, color: MUTED });
    const num = `${n + 1} / ${pages.length}`;
    p.drawText(num, { x: A4.w - M - F.widthOfTextAtSize(num, 8), y: M - 18, size: 8, font: F, color: MUTED });
  });

  return doc.save();
}

/**
 * The broker's PDF of one saved version of their request (the latest without `version`), with only photos they may
 * use. Null when there is no such version, or its language has no PDF yet.
 */
export async function brokerQuotePdf(
  db: import("../db/client").Db,
  store: import("../storage").FileStore,
  who: { isAdmin: boolean; actor: { id: string; tenantId: string }; email: string },
  requestId: string,
  version?: number,
): Promise<{ bytes: Uint8Array; filename: string; reference: string; version: number } | null> {
  const { getRequest, getVersion, listVersions } = await import("./requests");
  const { photoAllowed } = await import("./photoAccess");
  const { readContentBytes } = await import("./media");
  const { users } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  const r = await getRequest(db, who.actor.tenantId, requestId);
  if (!r) return null;
  const n = version && version > 0 ? version : (await listVersions(db, who.actor.tenantId, requestId))[0]?.version;
  const v = n ? await getVersion(db, who.actor.tenantId, requestId, n) : null;
  if (!v || !pdfSupported(v.content.lang)) return null;
  const [by] = await db.select({ name: users.displayName, email: users.email }).from(users).where(eq(users.id, who.actor.id));
  const { getBrand } = await import("./branding");
  const bytes = await quotePdf(
    { reference: r.reference, version: v.version, savedAt: v.createdAt, quote: v.content, broker: { name: by?.name ?? "", email: by?.email ?? who.email }, brand: await getBrand(db, who.actor.tenantId) },
    async (pid) => ((await photoAllowed(db, who, pid)) ? readContentBytes(db, store, pid) : null),
  );
  return { bytes, filename: `${r.reference}-v${v.version}.pdf`, reference: r.reference, version: v.version };
}
