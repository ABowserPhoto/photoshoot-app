import { PDFParse } from "pdf-parse";

export function looksLikePdf(buffer: Uint8Array): boolean {
  if (buffer.byteLength < 5) return false;
  const header = String.fromCharCode(buffer[0]!, buffer[1]!, buffer[2]!, buffer[3]!, buffer[4]!);
  return header.startsWith("%PDF");
}

export async function extractPdfText(buffer: Uint8Array): Promise<{ text: string; pageCount: number }> {
  const data = Uint8Array.from(buffer);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText({ pageJoiner: "\n\n" });
    const text = typeof result.text === "string" ? result.text : "";
    return {
      text,
      pageCount: typeof result.total === "number" ? result.total : 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (/password/i.test(message)) {
      throw new Error("This PDF is password-protected. Remove the password and try again.");
    }
    throw new Error(message.trim() ? `Failed to extract text from PDF: ${message}` : "Failed to extract text from PDF.");
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
