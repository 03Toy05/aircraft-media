import { strToU8, zipSync } from "fflate";

/**
 * A plain Word quote with every tag in place, for brokers to download, restyle and upload as their own template.
 * `paragraphs` lets tests build other templates the same way (each string one paragraph; "\f" = page break first).
 */
type DocPara = string | { text: string; bold?: boolean; size?: number; runs?: string[]; image?: [number, number]; color?: string; align?: "center" | "right" };
type DocBlock = DocPara | { table: string[][]; borders?: boolean };
export function wordDocx(paragraphs: DocBlock[]): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const para = (p: DocPara): string => {
    const o: Exclude<DocPara, string> = typeof p === "string" ? { text: p } : p;
    const pageBreak = o.text.startsWith("\f");
    const rPr = o.bold || o.size || o.color ? `<w:rPr>${o.bold ? "<w:b/>" : ""}${o.color ? `<w:color w:val="${o.color}"/>` : ""}${o.size ? `<w:sz w:val="${o.size * 2}"/>` : ""}</w:rPr>` : "";
    const img = o.image ? `<w:r><w:drawing><wp:inline><wp:extent cx="${o.image[0] * 12700}" cy="${o.image[1] * 12700}"/></wp:inline></w:drawing></w:r>` : "";
    const pPr = o.align ? `<w:pPr><w:jc w:val="${o.align}"/></w:pPr>` : "";
    const runs = (o.runs ?? [o.text.replace(/^\f/, "")]).map((t) => `<w:r>${rPr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`).join("");
    return `<w:p>${pPr}${pageBreak ? '<w:r><w:br w:type="page"/></w:r>' : ""}${runs}${img}</w:p>`;
  };
  const block = (b: DocBlock): string => {
    if (typeof b === "object" && "table" in b) {
      const cols = Math.max(...b.table.map((r) => r.length));
      return `<w:tbl><w:tblPr>${b.borders ? '<w:tblBorders><w:top w:val="single"/></w:tblBorders>' : ""}</w:tblPr><w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(cols)}</w:tblGrid>` +
        b.table.map((r) => `<w:tr>${r.map((c) => `<w:tc>${para(c)}</w:tc>`).join("")}</w:tr>`).join("") + "</w:tbl>";
    }
    return para(b);
  };
  const body = paragraphs.map(block).join("");
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/_rels/document.xml.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'),
    "word/document.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
        `<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    ),
  });
}

/** The sample template offered in Settings. Its wording is English; the filled values follow the quote's language. */
export function sampleWordTemplate(): Uint8Array {
  return wordDocx([
    { text: "QUOTATION", bold: true, size: 20 },
    "{reference}",
    "{date}",
    "",
    "{greeting}",
    "",
    { text: "Routing", bold: true, size: 13 },
    "{routing}",
    "",
    { text: "Options", bold: true, size: 13 },
    "{options}",
    "",
    "{closing}",
    "",
    "{broker_name}",
    "{broker_email}",
    "{#aircraft}",
    { text: "\fOption {number}: {aircraft}", bold: true, size: 15 },
    { text: "{price}", bold: true, size: 13 },
    "{owner_approval}",
    "Capacity: {seats}",
    "Year of manufacture: {yom}    Refurbished: {yor}",
    "Wi-Fi: {wifi}    Smoking: {smoking}    Pets: {pets}",
    "Operator: {operator}    Tail: {tail}    Base: {base}",
    "",
    "{photo_exterior}",
    "{photo_cabin 7.9cm} {photo_cabin2 7.9cm}",
    "{photo_floorplan}",
    "",
    "{extra}",
    "{notes}",
    "{/aircraft}",
  ]);
}
