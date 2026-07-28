export type InvoiceReminderEmailDraft = {
  subject: string;
  bodyPlain: string;
  bodyHtml: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function plainTextToHtml(text: string): string {
  const paragraphs = text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return "<p></p>";
  }

  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const INVOICE_REMINDER_IMAGE_URL =
  "https://res.cloudinary.com/dggils0xr/image/upload/v1782084423/zahlungserinnerung_ggoqcw.png";

function formatGermanShootDate(value?: string): string {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  // Prefer YYYY-MM-DD without timezone shift.
  const isoDay = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDay) {
    return `${isoDay[3]}.${isoDay[2]}.${isoDay[1]}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}

export function buildInvoiceReminderEmailHtml(bodyPlain: string): string {
  const bodyHtml = plainTextToHtml(bodyPlain);

  return `<html>
<head></head>
<body>
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
    <h2 style="text-align: center; color: #222;">Zahlungserinnerung</h2>

    <img src="${INVOICE_REMINDER_IMAGE_URL}" alt="Zahlungserinnerung" style="width: 100%; max-width: 600px; height: auto; display: block; margin: 20px auto; border-radius: 8px;" />

    <div style="font-size: 16px; line-height: 1.5;">
      ${bodyHtml}
    </div>
  </div>
</body>
</html>`;
}

export function generateInvoiceReminderEmail(input: {
  invoiceNumber: string;
  /** Business/client name for the subject line. */
  clientName: string;
  /** Greeting: contact person if available, otherwise business name. */
  contactNameOrBusinessName: string;
  location: string;
  photoshootDate?: string;
}): InvoiceReminderEmailDraft {
  const client = input.clientName.trim() || "Kunde";
  const location = input.location.trim() || "Ihrem Standort";
  const date = formatGermanShootDate(input.photoshootDate) || "—";
  const contactNameOrBusinessName =
    input.contactNameOrBusinessName.trim() || input.clientName.trim() || "Kunde";
  const invoiceNumber = input.invoiceNumber.trim() || "Rechnung";

  const subject = `Zahlungserinnerung | ${client} - ${location} - ${date}`;

  const bodyPlain = [
    `Hallo ${contactNameOrBusinessName},`,
    "",
    `dies ist eine freundliche Erinnerung, dass die Rechnung ${invoiceNumber} für unser Shooting in ${location} noch offen ist.`,
    "",
    "Sollten Sie den Betrag in der Zwischenzeit bereits überwiesen haben, betrachten Sie diese Nachricht bitte als gegenstandslos.",
    "",
    "Viele Grüße,",
    "Aaron Bowser",
    "Aaron Bowser Photography",
  ].join("\n");

  return {
    subject,
    bodyPlain,
    bodyHtml: buildInvoiceReminderEmailHtml(bodyPlain),
  };
}
