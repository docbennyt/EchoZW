import { inflateRawSync } from "node:zlib";
import type { StaticTimetableDocumentStructure } from "../src/domain/staticTimetableDocument.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(buffer: Buffer) {
  const lowerBound = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("DOCX_ZIP_DIRECTORY_NOT_FOUND");
}

function readZipEntry(buffer: Buffer, expectedName: string) {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error("DOCX_ZIP_CENTRAL_DIRECTORY_INVALID");
    }
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("utf8");
    if (name === expectedName) {
      if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_SIGNATURE) {
        throw new Error("DOCX_ZIP_LOCAL_HEADER_INVALID");
      }
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      const contents =
        compressionMethod === 0
          ? Buffer.from(compressed)
          : compressionMethod === 8
            ? inflateRawSync(compressed)
            : null;
      if (!contents) throw new Error("DOCX_ZIP_COMPRESSION_UNSUPPORTED");
      if (uncompressedSize > 0 && contents.length !== uncompressedSize) {
        throw new Error("DOCX_ZIP_ENTRY_SIZE_MISMATCH");
      }
      return contents;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("DOCX_DOCUMENT_XML_NOT_FOUND");
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function textFromXml(fragment: string) {
  const withBreaks = fragment
    .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/g, "\n")
    .replace(/<w:tab\b[^>]*\/?\s*>/g, "\t");
  const parts = [
    ...withBreaks.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g),
  ].map((match) => decodeXml(match[1]));
  return parts.join("").replace(/\u00a0/g, " ").trim();
}

function paragraphsFromXml(fragment: string) {
  return [...fragment.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map((match) => textFromXml(match[1]))
    .filter(Boolean);
}

function tablesFromXml(xml: string) {
  return [...xml.matchAll(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g)].map(
    (tableMatch) =>
      [...tableMatch[1].matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map(
        (rowMatch) =>
          [...rowMatch[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map(
            (cellMatch) => paragraphsFromXml(cellMatch[1]).join("\n").trim(),
          ),
      ),
  );
}

export function readStructuredDocx(buffer: Buffer): StaticTimetableDocumentStructure {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new Error("DOCX_ZIP_INVALID");
  }
  const xml = readZipEntry(buffer, "word/document.xml").toString("utf8");
  const tables = tablesFromXml(xml);
  const paragraphs = paragraphsFromXml(xml);
  if (tables.length === 0) throw new Error("DOCX_STRUCTURED_TABLES_REQUIRED");
  return { paragraphs, tables };
}
