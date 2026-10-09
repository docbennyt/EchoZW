import { createRequire } from "node:module";

export type PdfTextDocument = {
  pageCount: number;
  text: string;
};

type PdfParseResult = {
  numpages: number;
  text: string;
};

const require = createRequire(import.meta.url);
const parsePdf = require("pdf-parse/lib/pdf-parse.js") as (
  buffer: Buffer,
) => Promise<PdfParseResult>;

export async function readPdfText(buffer: Buffer): Promise<PdfTextDocument> {
  const result = await parsePdf(buffer);
  const text = result.text.replace(/\u00a0/g, " ").trim();
  if (!text) {
    throw new Error("PDF_TEXT_LAYER_EMPTY");
  }
  return {
    pageCount: result.numpages,
    text,
  };
}
