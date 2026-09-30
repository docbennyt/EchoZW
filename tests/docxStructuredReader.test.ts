import { describe, expect, it } from "vitest";
import { readStructuredDocx } from "../server/docxStructuredReader";

function buildStoredDocx(xml: string, declaredSize = Buffer.byteLength(xml)) {
  const name = Buffer.from("word/document.xml", "utf8");
  const data = Buffer.from(xml, "utf8");
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(data.length, 18);
  localHeader.writeUInt32LE(declaredSize, 22);
  localHeader.writeUInt16LE(name.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt32LE(0, 16);
  centralHeader.writeUInt32LE(data.length, 20);
  centralHeader.writeUInt32LE(declaredSize, 24);
  centralHeader.writeUInt16LE(name.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);

  const centralOffset = localHeader.length + name.length + data.length;
  const centralSize = centralHeader.length + name.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, name, data, centralHeader, name, eocd]);
}

describe("structured DOCX reader", () => {
  it("reads Word table and paragraph XML from a bounded DOCX container", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Department of Biotechnology - 2026</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>TIME</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>MONDAY</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

    const parsed = readStructuredDocx(buildStoredDocx(xml));

    expect(parsed.paragraphs).toContain("Department of Biotechnology - 2026");
    expect(parsed.tables[0][0]).toEqual(["TIME", "MONDAY"]);
  });

  it("rejects a DOCX entry that declares an unsafe expanded document.xml size", () => {
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:tbl /></w:document>`;
    const unsafeDeclaredSize = 8 * 1024 * 1024 + 1;

    expect(() =>
      readStructuredDocx(buildStoredDocx(xml, unsafeDeclaredSize)),
    ).toThrow("DOCX_DOCUMENT_XML_TOO_LARGE");
  });

  it("fails closed on a truncated ZIP container", () => {
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:tbl /></w:document>`;
    const docx = buildStoredDocx(xml);

    expect(() =>
      readStructuredDocx(docx.subarray(0, docx.length - 10)),
    ).toThrow();
  });
});
