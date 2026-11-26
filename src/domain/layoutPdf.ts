import sharp from "sharp";
import { PDFDocument, rgb, setLineWidth, setStrokingColor, setTextRenderingMode, TextRenderingMode, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { LBlock, LPara, LRun, LTable } from "./docxLayout";
import type { QuoteLayout, TBlock } from "./layoutTemplate";
import { AIRCRAFT_TAGS, PHOTO_TAGS, type LayoutValues } from "./quoteLayout";
import { embedQuoteFont, type PhotoLoader } from "./quotePdf";

/**
 * A quote as a PDF drawn in the broker's own layout (read from their Word file): their wording, fonts sizes, bold,
 * colours, alignment, tables and page breaks, with the quote's values in the fields Toy found. The logo place is left
 * blank. Text uses the quote font (Noto Sans TC); bold is drawn slightly thicker.
 */

const AIRCRAFT = new Set<string>([...AIRCRAFT_TAGS, ...Object.keys(PHOTO_TAGS)]);
const TAG = /\{([a-z][a-z0-9_]*?)(?:_(\d{1,2}))?(?: (\d{1,2}(?:\.\d)?)cm)?\}/g;
const PHOTO_TAG = /\{(photo_(?:exterior|cabin2?|floorplan))(?:_(\d{1,2}))?(?: (\d{1,2}(?:\.\d)?)cm)?\}/g;

interface Ctx { n?: number; leg?: number }
type DrawRun = LRun & { photo?: string | null };
type DrawPara = Omit<LPara, "runs"> & { runs: DrawRun[] };
interface DrawCell { blocks: DrawPara[]; span: number; fill?: string }
interface DrawTable { t: "tbl"; cols: number[]; rows: { cells: DrawCell[] }[]; borders: boolean }
type DrawBlock = DrawPara | DrawTable;

// ---------------------------------------------------------------- filling in

function fillText(s: string, v: LayoutValues, ctx: Ctx): string {
  return s.replace(TAG, (whole, name: string, num: string | undefined) => {
    if (name.startsWith("photo_")) return whole; // handled as a picture
    if ((name as string).startsWith("leg_")) return v.legs[ctx.leg ?? 0]?.[name] ?? "";
    if (AIRCRAFT.has(name)) return v.text[`${name}_${num ?? ctx.n ?? 1}`] ?? "";
    if (num) return whole;
    return name in v.text ? v.text[name] : whole;
  });
}

function fillPara(p: LPara, v: LayoutValues, ctx: Ctx): DrawPara | null {
  const runs: DrawRun[] = [];
  let hadTag = false;
  for (const r of p.runs) {
    if (r.image) {
      const slot = r.image.slot;
      if (slot === "none") continue;
      if (slot === "logo") { runs.push({ ...r, photo: null }); continue; }
      const id = slot ? v.photos[`${slot}_${ctx.n ?? 1}`] : undefined;
      if (id) runs.push({ ...r, photo: id });
      hadTag = true;
      continue;
    }
    if (r.text.includes("{")) hadTag = true;
    // Photo tags typed in the text become pictures.
    let last = 0;
    for (const m of r.text.matchAll(PHOTO_TAG)) {
      if (m.index! > last) runs.push({ ...r, text: fillText(r.text.slice(last, m.index), v, ctx) });
      last = m.index! + m[0].length;
      const id = v.photos[`${m[1]}_${m[2] ?? ctx.n ?? 1}`];
      const wPt = (m[3] ? Number(m[3]) : PHOTO_TAGS[m[1]]) * 28.35;
      if (id) runs.push({ text: "", size: r.size, image: { w: wPt, h: wPt * 0.62 }, photo: id });
    }
    runs.push({ ...r, text: fillText(r.text.slice(last), v, ctx) });
  }
  const text = runs.map((r) => r.text).join("");
  // A line whose fields were all empty ("Wi-Fi: ") is left out rather than printed half-empty.
  if (hadTag && !runs.some((r) => r.image) && (!text.trim() || /^[^:：\n]{0,40}[:：]\s*$/.test(text.trim()))) return null;
  return { ...p, runs };
}

/** The layout with the quote's values in it (exported for tests). */
export function expand(blocks: TBlock[], v: LayoutValues, ctx: Ctx = {}): DrawBlock[] {
  const out: DrawBlock[] = [];
  for (const b of blocks) {
    if (b.t === "each") {
      for (let n = 1; n <= v.count; n++) {
        const part = expand(b.blocks, v, { ...ctx, n });
        if (n > 1 && b.newPage && part[0]?.t === "p") part[0] = { ...part[0], breakBefore: true };
        out.push(...part);
      }
      continue;
    }
    if (b.t === "p") { const p = fillPara(b, v, ctx); if (p) out.push(p); continue; }
    out.push(expandTable(b, v, ctx));
  }
  return out;
}

function expandTable(t: LTable, v: LayoutValues, ctx: Ctx): DrawTable {
  const rows: { cells: DrawCell[] }[] = [];
  const cellsFor = (cells: LTable["rows"][number]["cells"], c: Ctx) =>
    cells.map((cell) => ({ span: cell.span, fill: cell.fill, blocks: cell.blocks.map((p) => fillPara(p, v, c) ?? { ...p, runs: [] }) }));
  for (const r of t.rows) {
    if (r.repeat === "aircraft") for (let n = 1; n <= v.count; n++) rows.push({ cells: cellsFor(r.cells, { ...ctx, n }) });
    else if (r.repeat === "legs") v.legs.forEach((_, leg) => rows.push({ cells: cellsFor(r.cells, { ...ctx, leg }) }));
    else rows.push({ cells: cellsFor(r.cells, ctx) });
  }
  return { t: "tbl", cols: t.cols, rows, borders: t.borders };
}

// ---------------------------------------------------------------- lines

interface Item { kind: "text" | "img" | "tab"; text: string; run: DrawRun; w: number; h: number }
interface Line { items: Item[]; w: number; h: number; asc: number }

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]/;
const hex = (c?: string) => (c ? rgb(parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255) : rgb(0, 0, 0));

function lines(p: DrawPara, F: PDFFont, width: number): Line[] {
  const items: (Item | "br")[] = [];
  if (p.bullet) items.push({ kind: "text", text: "•  ", run: p.runs[0] ?? { text: "", size: 11 }, w: F.widthOfTextAtSize("•  ", p.runs[0]?.size ?? 11), h: p.runs[0]?.size ?? 11 });
  for (const r of p.runs) {
    if (r.image) {
      const s = Math.min(1, width / r.image.w);
      items.push({ kind: "img", text: "", run: r, w: r.image.w * s, h: r.image.h * s });
      continue;
    }
    for (const m of r.text.matchAll(/(\n)|(\t)|([⺀-鿿가-힯豈-﫿＀-￯　-〿])|([^\s⺀-鿿가-힯豈-﫿＀-￯　-〿]+[  ]*)|([  ]+)/g)) {
      if (m[1]) { items.push("br"); continue; }
      if (m[2]) { items.push({ kind: "tab", text: "", run: r, w: 0, h: r.size }); continue; }
      const t = m[0];
      items.push({ kind: "text", text: t, run: r, w: F.widthOfTextAtSize(t, r.size), h: r.size });
    }
  }
  const out: Line[] = [];
  let cur: Line = { items: [], w: 0, h: 0, asc: 0 };
  const push = () => {
    const sizes = cur.items.filter((i) => i.kind !== "img").map((i) => i.h);
    const text = sizes.length ? Math.max(...sizes) : p.runs.find((r) => !r.image)?.size ?? 11;
    const img = Math.max(0, ...cur.items.filter((i) => i.kind === "img").map((i) => i.h));
    cur.asc = Math.max(text * 0.95, img);
    cur.h = Math.max(text * 1.25, img + text * 0.3);
    out.push(cur);
    cur = { items: [], w: 0, h: 0, asc: 0 };
  };
  for (const it of items) {
    if (it === "br") { push(); continue; }
    if (it.kind === "tab") it.w = 36 - (cur.w % 36) || 36;
    const trimmed = it.kind === "text" ? F.widthOfTextAtSize(it.text.trimEnd(), it.run.size) : it.w;
    if (cur.items.length && cur.w + trimmed > width) push();
    cur.items.push(it);
    cur.w += it.w;
  }
  if (cur.items.length || !out.length) push();
  return out;
}

// ---------------------------------------------------------------- drawing

export async function layoutPdf(tpl: QuoteLayout, v: LayoutValues, lang: string, loadPhoto: PhotoLoader, meta: { title: string; author: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(meta.title);
  doc.setAuthor(meta.author);
  doc.setCreator(meta.author || "Quotation");
  doc.setProducer(meta.author || "Quotation");
  const body = expand(tpl.body, v, {});
  const header = tpl.header.map((p) => fillPara(p, v, {})).filter((p): p is DrawPara => !!p);
  const footer = tpl.footer.map((p) => fillPara(p, v, {})).filter((p): p is DrawPara => !!p);
  const F = await embedQuoteFont(doc, lang, JSON.stringify([body, header, footer]));
  const pg = tpl.page;
  const W = pg.w - pg.left - pg.right;

  const imgCache = new Map<string, PDFImage | null>();
  const picture = async (id: string, w: number, h: number) => {
    const key = `${id}:${Math.round(w)}x${Math.round(h)}`;
    if (!imgCache.has(key)) {
      const f = await loadPhoto(id).catch(() => null);
      let img: PDFImage | null = null;
      if (f) {
        try {
          const jpg = await sharp(Buffer.from(f.bytes)).rotate().resize({ width: Math.round(w * 2.5), height: Math.round(h * 2.5), fit: "cover", position: "centre" }).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
          img = await doc.embedJpg(jpg);
        } catch { /* left blank */ }
      }
      imgCache.set(key, img);
    }
    return imgCache.get(key) ?? null;
  };

  const paraHeight = (p: DrawPara, width: number, top: boolean) => (top ? 0 : p.before) + lines(p, F, width - p.indent).reduce((s, l) => s + l.h, 0) + p.after;

  /** Draws one line with its top at y. */
  const drawLine = async (page: PDFPage, l: Line, p: DrawPara, x0: number, width: number, y: number) => {
    const avail = width - p.indent;
    const lineW = l.items.reduce((s, i) => s + i.w, 0) - (l.items.at(-1)?.kind === "text" ? l.items.at(-1)!.w - F.widthOfTextAtSize(l.items.at(-1)!.text.trimEnd(), l.items.at(-1)!.run.size) : 0);
    let x = x0 + p.indent + (p.align === "center" ? (avail - lineW) / 2 : p.align === "right" ? avail - lineW : 0);
    const base = y - l.asc;
    for (const it of l.items) {
      if (it.kind === "img") {
        if (it.run.photo) {
          const img = await picture(it.run.photo, it.w, it.h);
          if (img) page.drawImage(img, { x, y: base, width: it.w, height: it.h });
        }
      } else if (it.kind === "text" && it.text.trim()) {
        const color = hex(it.run.color);
        const opts = { x, y: base, size: it.run.size, font: F, color };
        if (it.run.b) {
          // Bold: the same letters filled and outlined, so they read thicker and copy as one word.
          page.pushOperators(setTextRenderingMode(TextRenderingMode.FillAndOutline), setLineWidth(it.run.size / 32), setStrokingColor(color));
          page.drawText(it.text, opts);
          page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
        } else page.drawText(it.text, opts);
        if (it.run.u) page.drawLine({ start: { x, y: base - 1.5 }, end: { x: x + F.widthOfTextAtSize(it.text.trimEnd(), it.run.size), y: base - 1.5 }, thickness: 0.6, color });
      }
      x += it.w;
    }
  };

  let page = doc.addPage([pg.w, pg.h]);
  const headerH = header.reduce((s, p) => s + paraHeight(p, W, false), 0);
  const footerH = footer.reduce((s, p) => s + paraHeight(p, W, false), 0);
  const TOP = Math.min(pg.h - pg.top, pg.h - pg.header - headerH - 4);
  const BOTTOM = Math.max(pg.bottom, pg.footer + footerH + 4);
  let y = TOP;
  const newPage = () => { page = doc.addPage([pg.w, pg.h]); y = TOP; };

  const drawPara = async (p: DrawPara, x0: number, width: number) => {
    if (p.breakBefore && y < TOP) newPage();
    if (y < TOP) y -= p.before;
    for (const l of lines(p, F, width - p.indent)) {
      if (y - l.h < BOTTOM && y < TOP) newPage();
      await drawLine(page, l, p, x0, width, y);
      y -= l.h;
    }
    y -= p.after;
    if (p.breakAfter) newPage();
  };

  const drawTable = async (t: DrawTable) => {
    const total = t.cols.reduce((s, c) => s + c, 0);
    const scale = total > 0 ? Math.min(1, W / total) : 1;
    const cols = total > 0 ? t.cols.map((c) => c * scale) : t.cols.map(() => W / t.cols.length);
    const PADX = 5.4, PADY = 2;
    for (const row of t.rows) {
      let ci = 0;
      const cells = row.cells.map((c) => {
        const x = pg.left + cols.slice(0, ci).reduce((s, w) => s + w, 0);
        const w = cols.slice(ci, ci + c.span).reduce((s, w) => s + w, 0) || W / Math.max(1, row.cells.length);
        ci += c.span;
        return { c, x, w, h: c.blocks.reduce((s, p, i) => s + paraHeight(p, w - 2 * PADX, i === 0), 0) + 2 * PADY };
      });
      const h = Math.max(14, ...cells.map((c) => c.h));
      if (y - h < BOTTOM && y < TOP) newPage();
      for (const { c, x, w } of cells) {
        if (c.fill) page.drawRectangle({ x, y: y - h, width: w, height: h, color: hex(c.fill) });
        if (t.borders) page.drawRectangle({ x, y: y - h, width: w, height: h, borderColor: rgb(0.55, 0.55, 0.55), borderWidth: 0.5 });
        let yy = y - PADY;
        for (const [i, p] of c.blocks.entries()) {
          if (i > 0) yy -= p.before;
          for (const l of lines(p, F, w - 2 * PADX - p.indent)) { await drawLine(page, l, p, x + PADX, w - 2 * PADX, yy); yy -= l.h; }
          yy -= p.after;
        }
      }
      y -= h;
    }
  };

  for (const b of body) {
    if (b.t === "p") await drawPara(b, pg.left, W);
    else await drawTable(b);
  }

  // Header and footer on every page.
  for (const p of doc.getPages()) {
    let yy = pg.h - pg.header;
    for (const h of header) { yy -= h.before; for (const l of lines(h, F, W - h.indent)) { await drawLine(p, l, h, pg.left, W, yy); yy -= l.h; } yy -= h.after; }
    yy = pg.footer + footerH;
    for (const f of footer) { yy -= f.before; for (const l of lines(f, F, W - f.indent)) { await drawLine(p, l, f, pg.left, W, yy); yy -= l.h; } yy -= f.after; }
  }
  return doc.save();
}
