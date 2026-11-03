// A small Word file, built here so that Clarion needs no extra library. Word files are zip archives of XML; this one
// stores them uncompressed, which Word reads happily.

export type Block = { kind: "title" | "heading" | "question" | "text" | "bullet" | "note"; text: string };

const encoder = new TextEncoder();
const escapeXml = (s: string) => s.replace(/[^\u0009\u000a\u000d -퟿-�\u{10000}-\u{10ffff}]/gu, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: [string, string][]): Uint8Array {
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  const fields = (list: [number, number][]) => { const out = new Uint8Array(list.reduce((n, [, size]) => n + size, 0)), view = new DataView(out.buffer); let at = 0; for (const [v, size] of list) { if (size === 2) view.setUint16(at, v, true); else view.setUint32(at, v, true); at += size; } return out; };
  for (const [name, text] of files) {
    const nameBytes = encoder.encode(name), data = encoder.encode(text), crc = crc32(data);
    const common: [number, number][] = [[20, 2], [0x0800, 2], [0, 2], [0, 2], [0x21, 2], [crc, 4], [data.length, 4], [data.length, 4], [nameBytes.length, 2], [0, 2]];
    const local = fields([[0x04034b50, 4], ...common]);
    parts.push(local, nameBytes, data);
    central.push(fields([[0x02014b50, 4], [20, 2], ...common, [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]]), nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const size = central.reduce((n, x) => n + x.length, 0);
  const all = [...parts, ...central, fields([[0x06054b50, 4], [0, 2], [0, 2], [files.length, 2], [files.length, 2], [size, 4], [offset, 4], [0, 2]])];
  const out = new Uint8Array(all.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of all) { out.set(x, at); at += x.length; }
  return out;
}

const STYLES: Record<Block["kind"], string> = { title: "Title", heading: "Heading1", question: "Question", text: "Normal", bullet: "ListParagraph", note: "Note" };
const paragraph = (b: Block) => `<w:p><w:pPr><w:pStyle w:val="${STYLES[b.kind]}"/></w:pPr><w:r><w:t xml:space="preserve">${b.kind === "bullet" ? "• " : ""}${escapeXml(b.text)}</w:t></w:r></w:p>`;
const WORD = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const style = (id: string, name: string, props: string) => `<w:style w:type="paragraph" w:styleId="${id}"${id === "Normal" ? ' w:default="1"' : ""}><w:name w:val="${name}"/>${id === "Normal" ? "" : '<w:basedOn w:val="Normal"/>'}${props}</w:style>`;

export function wordFile(blocks: Block[]): Uint8Array {
  const body = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${WORD}><w:body>${blocks.map(paragraph).join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${WORD}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>${style("Normal", "Normal", "")}${style("Title", "Title", '<w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="1A3452"/><w:sz w:val="40"/></w:rPr>')}${style("Heading1", "heading 1", '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="264A6F"/><w:sz w:val="28"/></w:rPr>')}${style("ListParagraph", "List Paragraph", '<w:pPr><w:ind w:left="284" w:hanging="284"/></w:pPr>')}${style("Question", "Question", '<w:pPr><w:keepNext/><w:spacing w:before="120" w:after="40"/></w:pPr><w:rPr><w:b/></w:rPr>')}${style("Note", "Note", '<w:rPr><w:color w:val="5F7085"/><w:sz w:val="18"/></w:rPr>')}</w:styles>`;
  return zip([
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ["word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ["word/document.xml", body], ["word/styles.xml", styles],
  ]);
}
