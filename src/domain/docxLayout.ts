import { strFromU8, unzipSync } from "fflate";

/**
 * Reads a Word file's look into a simple layout: paragraphs (with each run's bold, size, colour), tables (column
 * widths, shading, borders), pictures (their size only) and page breaks, plus the page size, margins, header and
 * footer. Enough to draw a quote that looks like the broker's own document; not a full Word renderer.
 */

export interface LRun {
  text: string;
  b?: boolean; i?: boolean; u?: boolean;
  /** Points. */
  size: number;
  /** "1f3a5f" (no #). */
  color?: string;
  /** A picture in the document (its size in points): a photo place, or the logo. */
  image?: { w: number; h: number; slot?: string };
}
export interface LPara {
  t: "p";
  runs: LRun[];
  align: "left" | "center" | "right";
  before: number; after: number; indent: number;
  breakBefore?: boolean; breakAfter?: boolean;
  bullet?: boolean;
  /** Set by the template: repeat this paragraph for each aircraft / each leg. */
  repeat?: "aircraft";
}
export interface LCell { blocks: LPara[]; span: number; fill?: string }
export interface LRow { cells: LCell[]; repeat?: "aircraft" | "legs" }
export interface LTable { t: "tbl"; cols: number[]; rows: LRow[]; borders: boolean }
export type LBlock = LPara | LTable;
export interface Layout {
  page: { w: number; h: number; top: number; bottom: number; left: number; right: number; header: number; footer: number };
  body: LBlock[];
  header: LPara[];
  footer: LPara[];
}

// ---------------------------------------------------------------- a small XML reader

export interface XNode { name: string; attrs: Record<string, string>; kids: (XNode | string)[] }

const decode = (s: string) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : e === "quot" ? '"' : e === "apos" ? "'" : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));

export function parseXml(xml: string): XNode {
  const root: XNode = { name: "#root", attrs: {}, kids: [] };
  const stack: XNode[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.kids.push(m[1]); continue; }
    if (m[6] !== undefined) { top.kids.push(decode(m[6])); continue; }
    if (!m[3]) continue; // comment or declaration
    if (m[2] === "/") { if (stack.length > 1) stack.pop(); continue; }
    const attrs: Record<string, string> = {};
    for (const a of (m[4] ?? "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? "");
    const node: XNode = { name: m[3], attrs, kids: [] };
    top.kids.push(node);
    if (!m[5]) stack.push(node);
  }
  return root;
}
const els = (n: XNode | undefined, name?: string) => (n ? (n.kids.filter((k) => typeof k !== "string") as XNode[]).filter((k) => !name || k.name === name) : []);
const el = (n: XNode | undefined, name: string) => els(n, name)[0];
const val = (n: XNode | undefined) => n?.attrs["w:val"];
const on = (n: XNode | undefined) => !!n && !["0", "false", "off", "none"].includes(val(n) ?? "1");
function find(n: XNode | undefined, name: string): XNode | undefined {
  if (!n) return undefined;
  for (const k of els(n)) { if (k.name === name) return k; const f = find(k, name); if (f) return f; }
  return undefined;
}

// ---------------------------------------------------------------- styles

interface RProps { b?: boolean; i?: boolean; u?: boolean; size?: number; color?: string }
interface PProps { align?: LPara["align"]; before?: number; after?: number; indent?: number; breakBefore?: boolean }
interface Style { basedOn?: string; r: RProps; p: PProps }

function rProps(rPr: XNode | undefined): RProps {
  if (!rPr) return {};
  const out: RProps = {};
  const b = el(rPr, "w:b"); if (b) out.b = on(b);
  const i = el(rPr, "w:i"); if (i) out.i = on(i);
  const u = el(rPr, "w:u"); if (u) out.u = on(u);
  const sz = Number(val(el(rPr, "w:sz"))); if (sz > 0) out.size = sz / 2;
  const c = val(el(rPr, "w:color")); if (c && /^[0-9a-f]{6}$/i.test(c)) out.color = c.toLowerCase();
  return out;
}
function pProps(pPr: XNode | undefined): PProps {
  if (!pPr) return {};
  const out: PProps = {};
  const jc = val(el(pPr, "w:jc"));
  if (jc) out.align = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : "left";
  const sp = el(pPr, "w:spacing");
  if (sp?.attrs["w:before"]) out.before = Number(sp.attrs["w:before"]) / 20;
  if (sp?.attrs["w:after"]) out.after = Number(sp.attrs["w:after"]) / 20;
  const ind = el(pPr, "w:ind");
  const left = ind?.attrs["w:left"] ?? ind?.attrs["w:start"];
  if (left) out.indent = Math.max(0, Number(left) / 20);
  if (el(pPr, "w:pageBreakBefore")) out.breakBefore = on(el(pPr, "w:pageBreakBefore"));
  return out;
}

class Styles {
  map = new Map<string, Style>();
  baseR: RProps = { size: 11 };
  baseP: PProps = { after: 8 };
  defaultPara?: string;
  constructor(xml?: string) {
    if (!xml) return;
    const root = el(parseXml(xml), "w:styles");
    const dd = el(root, "w:docDefaults");
    this.baseR = { size: 11, ...rProps(el(el(dd, "w:rPrDefault"), "w:rPr")) };
    this.baseP = { after: 0, ...pProps(el(el(dd, "w:pPrDefault"), "w:pPr")) };
    for (const s of els(root, "w:style")) {
      const id = s.attrs["w:styleId"];
      if (!id) continue;
      this.map.set(id, { basedOn: val(el(s, "w:basedOn")), r: rProps(el(s, "w:rPr")), p: pProps(el(s, "w:pPr")) });
      if (s.attrs["w:type"] === "paragraph" && s.attrs["w:default"] === "1") this.defaultPara = id;
    }
  }
  chain(id: string | undefined): Style[] {
    const out: Style[] = [];
    for (let k = 0; id && k < 10; k++) { const s = this.map.get(id); if (!s) break; out.unshift(s); id = s.basedOn; }
    return out;
  }
  para(id: string | undefined): { r: RProps; p: PProps } {
    const c = this.chain(id ?? this.defaultPara);
    return { r: Object.assign({}, this.baseR, ...c.map((s) => s.r)), p: Object.assign({}, this.baseP, ...c.map((s) => s.p)) };
  }
  run(id: string | undefined): RProps {
    return Object.assign({}, ...this.chain(id).map((s) => s.r));
  }
}

// ---------------------------------------------------------------- the document

const EMU = 12700; // per point

function readPara(p: XNode, st: Styles): LPara {
  const pPr = el(p, "w:pPr");
  const ps = st.para(val(el(pPr, "w:pStyle")));
  const pp = { ...ps.p, ...pProps(pPr) };
  const para: LPara = { t: "p", runs: [], align: pp.align ?? "left", before: pp.before ?? 0, after: pp.after ?? 0, indent: pp.indent ?? 0, breakBefore: pp.breakBefore };
  if (el(pPr, "w:numPr")) para.bullet = true;
  const markR = rProps(el(pPr, "w:rPr"));
  const visit = (n: XNode) => {
    for (const k of els(n)) {
      if (k.name === "w:r") {
        const rPr = el(k, "w:rPr");
        const style: RProps = { ...ps.r, ...st.run(val(el(rPr, "w:rStyle"))), ...rProps(rPr) };
        const add = (text: string) => para.runs.push({ text, size: style.size ?? 11, ...(style.b ? { b: true } : {}), ...(style.i ? { i: true } : {}), ...(style.u ? { u: true } : {}), ...(style.color ? { color: style.color } : {}) });
        for (const c of els(k)) {
          if (c.name === "w:t") add(c.kids.filter((x) => typeof x === "string").join(""));
          else if (c.name === "w:tab") add("\t");
          else if (c.name === "w:br" || c.name === "w:cr") {
            if (c.attrs["w:type"] === "page") {
              if (para.runs.some((r) => r.text.trim() || r.image)) para.breakAfter = true; else para.breakBefore = true;
            } else add("\n");
          } else if (c.name === "w:drawing") {
            const ext = find(c, "wp:extent");
            const w = Number(ext?.attrs.cx) / EMU, h = Number(ext?.attrs.cy) / EMU;
            if (w > 0 && h > 0) para.runs.push({ text: "", size: style.size ?? 11, image: { w, h } });
          }
        }
      } else if (["w:hyperlink", "w:smartTag", "w:ins", "w:fldSimple", "w:customXml"].includes(k.name)) visit(k);
      else if (k.name === "w:sdt") { const c = el(k, "w:sdtContent"); if (c) visit(c); }
    }
  };
  visit(p);
  if (!para.runs.length && markR.size) para.runs.push({ text: "", size: markR.size });
  return para;
}

function readTable(tbl: XNode, st: Styles): LTable {
  const cols = els(el(tbl, "w:tblGrid"), "w:gridCol").map((g) => Number(g.attrs["w:w"]) / 20 || 0);
  const borders = !!find(el(tbl, "w:tblPr"), "w:tblBorders") || !!find(tbl, "w:tcBorders") || /Grid/i.test(val(find(el(tbl, "w:tblPr"), "w:tblStyle")) ?? "");
  const rows: LRow[] = els(tbl, "w:tr").map((tr) => ({
    cells: els(tr, "w:tc").map((tc) => {
      const tcPr = el(tc, "w:tcPr");
      const fill = el(tcPr, "w:shd")?.attrs["w:fill"];
      return {
        span: Math.max(1, Number(val(el(tcPr, "w:gridSpan"))) || 1),
        blocks: els(tc).filter((k) => k.name === "w:p").map((p) => readPara(p, st)),
        ...(fill && /^[0-9a-f]{6}$/i.test(fill) ? { fill: fill.toLowerCase() } : {}),
      };
    }),
  }));
  const n = Math.max(cols.length, ...rows.map((r) => r.cells.reduce((s, c) => s + c.span, 0)));
  while (cols.length < n) cols.push(0);
  return { t: "tbl", cols, rows, borders };
}

function readBlocks(container: XNode | undefined, st: Styles): LBlock[] {
  const out: LBlock[] = [];
  for (const k of els(container)) {
    if (k.name === "w:p") out.push(readPara(k, st));
    else if (k.name === "w:tbl") out.push(readTable(k, st));
    else if (k.name === "w:sdt") out.push(...readBlocks(el(k, "w:sdtContent"), st));
  }
  return out;
}

/** The layout of a .docx. Throws when it isn't one. */
export function readDocxLayout(bytes: Uint8Array): Layout {
  const files = unzipSync(bytes);
  const st = new Styles(files["word/styles.xml"] ? strFromU8(files["word/styles.xml"]) : undefined);
  const doc = parseXml(strFromU8(files["word/document.xml"]));
  const body = find(doc, "w:body");
  const sect = find(body, "w:sectPr");
  const pgSz = el(sect, "w:pgSz"), pgMar = el(sect, "w:pgMar");
  const tw = (v: string | undefined, d: number) => (v && Number(v) > 0 ? Number(v) / 20 : d);
  const page = {
    w: tw(pgSz?.attrs["w:w"], 595.28), h: tw(pgSz?.attrs["w:h"], 841.89),
    top: tw(pgMar?.attrs["w:top"], 72), bottom: tw(pgMar?.attrs["w:bottom"], 72),
    left: tw(pgMar?.attrs["w:left"], 72), right: tw(pgMar?.attrs["w:right"], 72),
    header: tw(pgMar?.attrs["w:header"], 36), footer: tw(pgMar?.attrs["w:footer"], 36),
  };
  // The default header and footer of the (last) section.
  const rels = files["word/_rels/document.xml.rels"] ? parseXml(strFromU8(files["word/_rels/document.xml.rels"])) : null;
  const target = (rid?: string) => els(el(rels ?? undefined, "Relationships"), "Relationship").find((r) => r.attrs.Id === rid)?.attrs.Target;
  const part = (kind: "w:headerReference" | "w:footerReference") => {
    const refs = els(sect, kind);
    const ref = refs.find((r) => r.attrs["w:type"] === "default") ?? refs[0];
    const t = target(ref?.attrs["r:id"]);
    const f = t ? files[`word/${t.replace(/^\/?word\//, "")}`] : undefined;
    if (!f) return [];
    const root = parseXml(strFromU8(f));
    return readBlocks(els(root)[0], st).filter((b): b is LPara => b.t === "p");
  };
  return { page, body: readBlocks(body, st), header: part("w:headerReference"), footer: part("w:footerReference") };
}

/** A paragraph's text (pictures left out). */
export const paraText = (p: LPara) => p.runs.map((r) => r.text).join("");
