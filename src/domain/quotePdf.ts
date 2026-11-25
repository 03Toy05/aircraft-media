import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { airportsFor } from "./airports";
import { airportPlace, legTimes, type Leg } from "./routing";
import { OWNER_APPROVAL, PROPOSAL_TITLE, QUOTE_LANGUAGES, QUOTE_LOCALE, QUOTE_WORDS, type QuoteLanguage } from "./quote";
import { needsOwnerApproval } from "./requests";
import { DEFAULT_VERSION_FORMAT, formatVersion, versionFileName } from "./branding";
import type { QuoteSnapshot } from "./requests";
import { textOn } from "./branding";

/**
 * A quote version as a PDF (A4) in the broker's look (logo and colour): a summary page (greeting, routing table with
 * local and UTC times, the options with their prices, closing), then one page per aircraft in the same fixed layout
 * (title band with the price, details, exterior / two cabins / floor plan). Font: Noto Sans TC (SIL OFL): a small Latin/Cyrillic TrueType copy embedded whole, or the full font as a subset for Chinese and Japanese.
 */

/** Languages the embedded font covers completely; the others are read on the client's link instead. */
export const PDF_LANGUAGES: QuoteLanguage[] = ["en", "zh-Hant", "ja", "vi", "fr", "de", "id", "ru"];
export const pdfSupported = (lang: string) => (PDF_LANGUAGES as string[]).includes(lang);

const FONT_DIR = path.join(process.cwd(), "src", "data", "fonts");
/** Full font (CFF outlines), embedded as a subset: needed for Chinese and Japanese. */
const CJK_FONT = path.join(FONT_DIR, "NotoSansTC-Regular.otf");
/**
 * Latin, Vietnamese, Greek and Cyrillic only, as TrueType outlines (made from the same font with fontTools), embedded
 * whole. Phone PDF apps (Honor PDF) showed mixed-up letters with the CFF subset; TrueType embedded whole is the
 * most widely readable form.
 */
const LATIN_FONT = path.join(FONT_DIR, "NotoSansTC-Latin.ttf");
const fontCache = new Map<string, Buffer>();
const fontFile = (file: string) => fontCache.get(file) ?? (fontCache.set(file, fs.readFileSync(file)), fontCache.get(file)!);
/** Characters the Latin font does not have (Chinese, Japanese, Thai, Arabic...). */
const BEYOND_LATIN = /[^\u0000-\u024F\u0300-\u04FF\u1E00-\u1EFF\u2000-\u206F\u20A0-\u20CF\u2100-\u215F\u2190-\u21FF\u2212\u2600-\u26FF]/;
export const needsCjkFont = (lang: string, text: string) => lang === "zh-Hant" || lang === "ja" || BEYOND_LATIN.test(text);

export interface PdfQuote {
  reference: string; version: number; savedAt: Date; quote: QuoteSnapshot; broker: { name: string; email: string };
  /** The broker's logo and colour (Settings → Quote branding). */
  brand?: { color: string; logo: { png: Uint8Array; width: number; height: number } | null; versionFormat?: string };
}
export type PhotoLoader = (contentVersionId: string) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;

const A4 = { w: 595.28, h: 841.89 };
const M = 42; // margin
const INK = rgb(0.1, 0.12, 0.17), MUTED = rgb(0.42, 0.45, 0.5), LINE = rgb(0.89, 0.9, 0.92), AMBER = rgb(0.6, 0.38, 0);
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

/**
 * The fixed photo layout of an aircraft: one exterior, two cabin photos and a floor plan, by type (the library's
 * 1 / 2 / 1 set). A quote with other kinds only fills the exterior box with its first photo.
 */
export interface PhotoSlots<P> { exterior: P | null; cabins: P[]; floorPlan: P | null }
export function photoSlots<P extends { classification: string }>(photos: P[]): PhotoSlots<P> {
  const of = (c: string) => photos.filter((p) => p.classification === c);
  const exterior = of("exterior")[0] ?? photos.find((p) => !["cabin", "floor_plan", "combined"].includes(p.classification)) ?? null;
  return { exterior, cabins: of("cabin").slice(0, 2), floorPlan: of("floor_plan")[0] ?? null };
}

export async function quotePdf(q: PdfQuote, loadPhoto: PhotoLoader): Promise<Uint8Array> {
  const lang = langOf(q.quote.lang);
  const w = QUOTE_WORDS[lang];
  const locale = QUOTE_LOCALE[lang];
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${PROPOSAL_TITLE[lang]} · ${formatVersion(q.brand?.versionFormat ?? DEFAULT_VERSION_FORMAT, q.reference, q.version)}`);
  doc.setAuthor(q.broker.name || q.broker.email);
  doc.setCreator(q.broker.name || "Quotation");
  doc.setProducer(q.broker.name || "Quotation");
  // No joined letters (fi, fl): the subset drops the joined forms, which left gaps like "f nd".
  const noLigatures = { liga: false, clig: false, dlig: false };
  const F = needsCjkFont(lang, JSON.stringify(q.quote) + q.broker.name + q.broker.email)
    ? await doc.embedFont(fontFile(CJK_FONT), { subset: true, features: noLigatures })
    : await doc.embedFont(fontFile(LATIN_FONT), { subset: false, features: noLigatures });
  const color = q.brand?.color && /^#[0-9a-fA-F]{6}$/.test(q.brand.color) ? q.brand.color : "#1f3a5f";
  const ACCENT = hexColor(color);
  const ON_ACCENT = textOn(color) === "#ffffff" ? rgb(1, 1, 1) : rgb(0.07, 0.07, 0.07);
  const TINT = rgb(0.965, 0.97, 0.975);
  const logo = q.brand?.logo ? await doc.embedPng(q.brand.logo.png).catch(() => null) : null;

  const W = A4.w - 2 * M; // content width
  const BOTTOM = M + 30; // keep clear of the footer
  let page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const at = (s: string, x: number, yy: number, size: number, c = INK) => page.drawText(s, { x, y: yy, size, font: F, color: c });
  const atRight = (s: string, xr: number, yy: number, size: number, c = INK) => at(s, xr - F.widthOfTextAtSize(s, size), yy, size, c);
  const fmtDate = (d: Date) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(d);
  const fmtIso = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const yesNo = (v: string | undefined) => (v === "yes" ? w.wifiYes : v === "no" ? w.wifiNo : v === "tbc" ? w.wifiTbc : "–");
  const ref = formatVersion(q.brand?.versionFormat ?? DEFAULT_VERSION_FORMAT, q.reference, q.version);
  const label = q.quote.label ?? "";
  const para = (s: string, size = 10.5, c = INK) => {
    for (const ln of wrap(s, F, size, W)) {
      if (y - size * 1.5 < BOTTOM) { page = doc.addPage([A4.w, A4.h]); y = A4.h - M; }
      at(ln, M, y - size, size, c);
      y -= size * 1.55;
    }
  };

  /** The page top: logo (or name) and email left; title, reference and date right; a line in the brand colour. */
  const header = (compact: boolean) => {
    const top = A4.h - M;
    const maxH = compact ? 34 : 52;
    let left = top;
    if (logo) {
      const s = Math.min((compact ? 150 : 200) / logo.width, maxH / logo.height, 1);
      page.drawImage(logo, { x: M, y: top - logo.height * s, width: logo.width * s, height: logo.height * s });
      left = top - logo.height * s;
    } else {
      const size = compact ? 13 : 17;
      at(q.broker.name || q.broker.email, M, top - size, size, ACCENT);
      left = top - size - 2;
    }
    if (!compact && q.broker.email) { at(q.broker.email, M, left - 13, 9, MUTED); left -= 15; }
    const t = compact ? 11 : 13;
    atRight(PROPOSAL_TITLE[lang], A4.w - M, top - t, t);
    atRight(ref, A4.w - M, top - t - 14, 9, MUTED);
    if (!compact) atRight(label ? `${label}  |  ${fmtDate(q.savedAt)}` : fmtDate(q.savedAt), A4.w - M, top - t - 27, 9, MUTED);
    y = Math.min(left, top - t - (compact ? 18 : 31)) - 10;
    page.drawRectangle({ x: M, y: y - 2, width: W, height: 2, color: ACCENT });
    y -= 20;
  };

  /** A table: a tinted heading row, then rows whose cells wrap; it carries on onto a new page when needed. */
  const table = (cols: { label: string; frac: number; right?: boolean }[], rows: { text: string; sub?: string; strong?: boolean; warn?: string }[][]) => {
    const xs: number[] = [];
    let x = M;
    for (const c of cols) { xs.push(x); x += c.frac * W; }
    const cw = (i: number) => cols[i].frac * W - 8;
    const drawHead = () => {
      page.drawRectangle({ x: M, y: y - 20, width: W, height: 20, color: TINT });
      cols.forEach((c, i) => (c.right ? atRight(c.label, xs[i] + cw(i) + 4, y - 14, 8.5, MUTED) : at(c.label, xs[i] + 4, y - 14, 8.5, MUTED)));
      y -= 20;
    };
    drawHead();
    for (const row of rows) {
      const cells = row.map((cell, i) => ({ lines: wrap(cell.text, F, 10, cw(i)), sub: cell.sub ? wrap(cell.sub, F, 8.5, cw(i)) : [], warn: cell.warn ? wrap(cell.warn, F, 8.5, cw(i)) : [], strong: cell.strong }));
      const h = Math.max(...cells.map((c) => c.lines.length * 13 + (c.sub.length + c.warn.length) * 11)) + 12;
      if (y - h < BOTTOM) { page = doc.addPage([A4.w, A4.h]); header(true); drawHead(); }
      cells.forEach((c, i) => {
        let yy = y - 16;
        for (const ln of c.lines) { (cols[i].right ? atRight : at)(ln, cols[i].right ? xs[i] + cw(i) + 4 : xs[i] + 4, yy, 10, c.strong ? ACCENT : INK); yy -= 13; }
        for (const ln of c.warn) { (cols[i].right ? atRight : at)(ln, cols[i].right ? xs[i] + cw(i) + 4 : xs[i] + 4, yy, 8.5, AMBER); yy -= 11; }
        for (const ln of c.sub) { (cols[i].right ? atRight : at)(ln, cols[i].right ? xs[i] + cw(i) + 4 : xs[i] + 4, yy, 8.5, MUTED); yy -= 11; }
      });
      y -= h;
      page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.6, color: LINE });
    }
    y -= 18;
  };
  const heading = (s: string) => {
    if (y - 40 < BOTTOM) { page = doc.addPage([A4.w, A4.h]); header(true); }
    at(s, M, y - 12, 12, ACCENT);
    y -= 22;
  };

  // ---------------------------------------------------------------- page 1: the summary
  header(false);
  if (q.quote.greeting) { para(q.quote.greeting, 12, ACCENT); y -= 8; }

  const legs: Leg[] = q.quote.legs ?? [];
  if (legs.length) {
    const airports = airportsFor(legs.flatMap((l) => [l.from, l.to]));
    const utc = q.quote.utc !== false;
    heading(w.routing);
    table(
      [{ label: w.date, frac: 0.14 }, { label: w.from, frac: 0.22 }, { label: w.to, frac: 0.22 }, { label: w.dep, frac: 0.12 }, { label: w.arr, frac: 0.12 }, { label: w.flightTime, frac: 0.1 }, { label: ((s) => s.charAt(0).toUpperCase() + s.slice(1))(w.pax(0).replace(/^0\s*/, "") || "Pax"), frac: 0.08, right: true }],
      legs.map((l) => {
        const t = legTimes(l, airports);
        return [
          { text: l.date ? fmtIso(l.date) : "–" },
          { text: airportPlace(l.from, airports) },
          { text: airportPlace(l.to, airports) },
          { text: t.depLocal ? `${t.depLocal.time} ${w.lt}` : "–", sub: utc && t.depUtc ? `${t.depUtc.time} UTC` : undefined },
          { text: t.arrLocal ? `${t.arrLocal.time} ${w.lt}${t.arrDays ? ` +${t.arrDays}` : ""}` : "–", sub: utc && t.arrUtc ? `${t.arrUtc.time} UTC` : undefined },
          { text: l.flight ? w.duration(Math.floor(l.flight / 60), l.flight % 60) : "–" },
          { text: l.pax ? String(l.pax) : "–" },
        ];
      }),
    );
  }

  const options = q.quote.options;
  heading(w.options);
  table(
    [{ label: "", frac: 0.04 }, { label: w.aircraft, frac: 0.27 }, { label: w.capacity, frac: 0.09 }, { label: "YOM / YOR", frac: 0.12 }, { label: w.wifi, frac: 0.08 }, { label: w.smoking, frac: 0.1 }, { label: w.pets, frac: 0.09 }, { label: w.price, frac: 0.21, right: true }],
    options.map((o, i) => [
      { text: String(i + 1) },
      { text: o.type, warn: needsOwnerApproval(o.notes) ? OWNER_APPROVAL[lang] : undefined, sub: o.extra || undefined },
      { text: o.capacity ? String(o.capacity) : "–" },
      { text: [o.yom, o.yor].filter(Boolean).join(" / ") || "–" },
      { text: yesNo(o.wifi) },
      { text: yesNo(o.smoking) },
      { text: yesNo(o.pets) },
      { text: o.price || "–", strong: true },
    ]),
  );
  if (q.quote.closing) para(q.quote.closing, 12, ACCENT);

  // ---------------------------------------------------------------- one page per aircraft, the same layout each time
  const inc = (q.quote.builder?.inc ?? {}) as Record<string, boolean>;
  const GAP = 8;
  const BOX = { ext: { w: W, h: 235 }, cabin: { w: (W - GAP) / 2, h: 150 }, plan: { w: W, h: 105 } };
  /** A photo cut to its box (cover), or a floor plan fitted whole on white (contain). */
  const boxed = async (id: string, box: { w: number; h: number }, fit: "cover" | "contain") => {
    const f = await loadPhoto(id).catch(() => null);
    if (!f) return null;
    try {
      const px = { width: Math.round(box.w * 2.5), height: Math.round(box.h * 2.5) };
      const jpg = await sharp(Buffer.from(f.bytes)).rotate().resize({ ...px, fit, position: "centre", background: { r: 255, g: 255, b: 255 } }).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
      return await doc.embedJpg(jpg);
    } catch {
      return null;
    }
  };

  for (const [i, o] of options.entries()) {
    page = doc.addPage([A4.w, A4.h]);
    header(true);

    // Title band in the brand colour: option number and aircraft left, price right.
    page.drawRectangle({ x: M, y: y - 40, width: W, height: 40, color: ACCENT });
    at(`${w.option} ${i + 1}`, M + 12, y - 15, 8.5, ON_ACCENT);
    const priceW = o.price ? F.widthOfTextAtSize(o.price, 13) + 24 : 0;
    at(wrap(o.type, F, 14, W - priceW - 24)[0], M + 12, y - 32, 14, ON_ACCENT);
    if (o.price) atRight(o.price, M + W - 12, y - 27, 13, ON_ACCENT);
    y -= 54;
    if (needsOwnerApproval(o.notes)) {
      const txt = OWNER_APPROVAL[lang];
      const tw = F.widthOfTextAtSize(txt, 9.5) + 20;
      page.drawRectangle({ x: M, y: y - 20, width: tw, height: 20, color: rgb(1, 0.95, 0.82), borderColor: rgb(0.85, 0.6, 0.1), borderWidth: 0.8 });
      at(txt, M + 10, y - 14, 9.5, rgb(0.5, 0.33, 0));
      y -= 30;
    }

    // Details, four to a row.
    const facts: [string, string][] = [];
    const add = (label: string, v: string | number | null | undefined) => { if (v != null && v !== "") facts.push([label, String(v)]); };
    if (inc.operator) add(w.operator, o.operator);
    if (inc.tail) add(w.tail, o.tail);
    if (inc.base) add(w.base, o.base);
    add(w.yom, o.yom);
    add(w.yor, o.yor);
    if (o.capacity) add(w.capacity, w.seats(o.capacity));
    const colW = W / 4;
    for (let r = 0; r < facts.length; r += 4) {
      facts.slice(r, r + 4).forEach(([label, v], j) => {
        at(label, M + j * colW, y - 9, 8, MUTED);
        at(wrap(v, F, 10.5, colW - 8)[0], M + j * colW, y - 23, 10.5, INK);
      });
      y -= 32;
    }
    y -= 6;

    // Photos: exterior across the top, two cabin photos side by side, the floor plan along the bottom.
    const slots = photoSlots(o.photos);
    if (slots.exterior) {
      const img = await boxed(slots.exterior.id, BOX.ext, "cover");
      if (img) { page.drawImage(img, { x: M, y: y - BOX.ext.h, width: BOX.ext.w, height: BOX.ext.h }); y -= BOX.ext.h + GAP; }
    }
    if (slots.cabins.length) {
      const imgs = await Promise.all(slots.cabins.map((p) => boxed(p.id, BOX.cabin, "cover")));
      imgs.forEach((img, j) => { if (img) page.drawImage(img, { x: M + j * (BOX.cabin.w + GAP), y: y - BOX.cabin.h, width: BOX.cabin.w, height: BOX.cabin.h }); });
      if (imgs.some(Boolean)) y -= BOX.cabin.h + GAP;
    }
    if (slots.floorPlan) {
      const img = await boxed(slots.floorPlan.id, BOX.plan, "contain");
      if (img) {
        page.drawRectangle({ x: M, y: y - BOX.plan.h, width: BOX.plan.w, height: BOX.plan.h, borderColor: LINE, borderWidth: 0.8, color: rgb(1, 1, 1) });
        page.drawImage(img, { x: M, y: y - BOX.plan.h, width: BOX.plan.w, height: BOX.plan.h });
        y -= BOX.plan.h + GAP;
      }
    }
    if (o.extra) { y -= 4; para(o.extra, 10); }
    // The aircraft's notes, when the broker ticked Notes on the Quote page (as in the message).
    if (inc.notes && o.notes?.trim()) { y -= 4; para(`${w.notes}${w.colon}${o.notes.trim()}`, 10); }
  }

  // ---------------------------------------------------------------- footer on every page
  const pages = doc.getPages();
  const contact = [q.broker.name, q.broker.email].filter(Boolean).join("  |  ");
  pages.forEach((p, n) => {
    p.drawLine({ start: { x: M, y: M - 6 }, end: { x: A4.w - M, y: M - 6 }, thickness: 0.6, color: LINE });
    p.drawText(ref, { x: M, y: M - 20, size: 8, font: F, color: MUTED });
    if (contact) p.drawText(contact, { x: (A4.w - F.widthOfTextAtSize(contact, 8)) / 2, y: M - 20, size: 8, font: F, color: MUTED });
    const num = `${n + 1} / ${pages.length}`;
    p.drawText(num, { x: A4.w - M - F.widthOfTextAtSize(num, 8), y: M - 20, size: 8, font: F, color: MUTED });
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
  const brand = await getBrand(db, who.actor.tenantId);
  return { bytes, filename: versionFileName(brand.versionFormat, r.reference, v.version), reference: r.reference, version: v.version };
}
