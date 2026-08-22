import { jsPDF } from "jspdf";

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function htmlToPlainText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withBreaks = withoutScripts
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(stripped).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function htmlEmailToPdfBuffer(input: {
  subject: string;
  from: string;
  date: string;
  html: string;
}): Buffer {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;
  const body = htmlToPlainText(input.html);
  const content = [
    `From: ${input.from}`,
    `Subject: ${input.subject}`,
    `Date: ${input.date}`,
    "",
    body || "(No readable email body)",
  ].join("\n");

  const lines = doc.splitTextToSize(content, maxWidth);
  let cursorY = margin;
  const lineHeight = 14;

  for (const line of lines) {
    if (cursorY > pageHeight - margin) {
      doc.addPage();
      cursorY = margin;
    }
    doc.text(line, margin, cursorY);
    cursorY += lineHeight;
  }

  return Buffer.from(doc.output("arraybuffer"));
}

export function plainTextToPdfBuffer(title: string, text: string): Buffer {
  return htmlEmailToPdfBuffer({
    subject: title,
    from: "",
    date: new Date().toISOString(),
    html: `<pre>${text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`,
  });
}
