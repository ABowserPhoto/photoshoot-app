import { resolveFinalEmailCoverImageUrl } from "@/lib/emailTemplateAssets";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildFinalizeShootEmailSubject(input: {
  photoshootType?: string;
  companyName?: string;
  shootLocation?: string;
  shootName?: string;
}): string {
  const parts = [
    input.photoshootType?.trim(),
    input.companyName?.trim(),
    input.shootLocation?.trim(),
  ].filter(Boolean);

  if (parts.length === 0 && input.shootName?.trim()) {
    return `Ihre Fotos sind da! ${input.shootName.trim()}`;
  }

  return `Ihre Fotos sind da! ${parts.join(" ")}`.trim();
}

export function buildFinalizeShootEmailHtml(input: {
  googleDriveLink: string;
  includeInvoiceNote?: boolean;
  photoshootType?: string;
}): string {
  const driveLink = escapeHtml(input.googleDriveLink.trim());
  const coverImageUrl = escapeHtml(resolveFinalEmailCoverImageUrl(input.photoshootType));
  const bodyText =
    input.includeInvoiceNote === false
      ? "Ich habe gute Nachrichten! Deine Fotos kannst du hier herunterladen."
      : "Ich habe gute Nachrichten! Deine Fotos kannst du hier herunterladen, und deine Rechnung ist dieser E-Mail beigefügt.";

  return `<html>
<head></head>
<body>
  <div dir="ltr">
    <table style="background-color:rgb(248,249,250);padding:0px 20px" role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
      <tbody>
        <tr>
          <td align="center" valign="top" width="900">
            <table width="900" border="0" cellspacing="0" cellpadding="0" style="width:100%;max-width:900px" bgcolor="#f8f9fa" role="presentation">
              <tbody>
                <tr>
                  <td>
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
                      <tbody>
                        <tr>
                          <td align="center" style="padding:26px 20px; background-color:#ffffff;">
                            <img src="${coverImageUrl}" alt="CoverImage" width="100%" style="display:block; width:100%; max-width:100%; height:auto; border:0; outline:none; text-decoration:none;">
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    <table width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="white">
                      <tbody>
                        <tr>
                          <td align="center" style="padding:20px 10px 0px;">
                            <div style="font-family:arial,sans-serif;font-size:32px;color:rgb(32,33,36)">Ihre Fotos sind da!</div>
                          </td>
                        </tr>
                        <tr>
                          <td align="center" style="padding:18px 40px 0px;">
                            <div style="font-family:arial,sans-serif;font-size:15px;line-height:1.4;color:rgb(95,99,104)">
                              ${bodyText}
                            </div>
                          </td>
                        </tr>

                        <tr>
                          <td align="center" style="padding:30px 0px 40px;">
                            <table border="0" cellpadding="0" cellspacing="0" style="background:rgb(240,167,57);border-radius:4px;line-height:100%;padding:12px 24px">
                              <tbody>
                                <tr>
                                  <td align="center" bgcolor="#f0a739">
                                    <a href="${driveLink}" style="color:rgb(0,0,0);font-family:arial,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;" target="_blank">Download Fotos</a>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    <table width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="white" style="border-top:1px solid #e8eaed;">
                      <tbody>
                        <tr>
                          <td align="center" style="padding:20px 30px;">
                            <div style="font-family:arial,sans-serif;font-size:12px;color:rgb(128,134,139)">
                              <p><a href="${driveLink}" target="_blank">${driveLink}</a></p>
                              <br>
                              -- <br>
                              <div dir="ltr">
                                <b>Aaron Bowser</b><br>
                                Photographer<br>
                                <a href="http://aaronbowser-photography.com">aaronbowser-photography.com</a>
                              </div>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

export function buildFinalizeShootEmailPlainText(input: {
  googleDriveLink: string;
  includeInvoiceNote?: boolean;
}): string {
  const bodyText =
    input.includeInvoiceNote === false
      ? "Ich habe gute Nachrichten! Deine Fotos kannst du hier herunterladen."
      : "Ich habe gute Nachrichten! Deine Fotos kannst du hier herunterladen, und deine Rechnung ist dieser E-Mail beigefügt.";

  const lines = [
    "Ihre Fotos sind da!",
    "",
    bodyText,
    "",
    `Download Fotos: ${input.googleDriveLink}`,
    "",
    "--",
    "Aaron Bowser",
    "Photographer",
    "http://aaronbowser-photography.com",
  ];

  return lines.join("\n");
}

export function buildSeparateInvoiceEmailSubject(input: {
  /** Billing entity / company name for the subject. */
  billingEntityName?: string;
  /** @deprecated Prefer billingEntityName. */
  clientName?: string;
  invoiceNumber?: string;
  /** Photoshoot location shown at a glance for accounting. */
  shootLocation?: string;
  photoshootDate?: string;
}): string {
  const client = input.billingEntityName?.trim() || input.clientName?.trim() || "Client";
  const invoiceNumber = input.invoiceNumber?.trim() || "Rechnung";
  const location = input.shootLocation?.trim() || "";
  const date = formatGermanShootDate(input.photoshootDate) || "—";
  const parts = [client, invoiceNumber, ...(location ? [location] : []), date];
  return `Invoice | ${parts.join(" - ")}`;
}

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

function resolveBillingEntitySalutationName(input: {
  billingEntityName?: string;
}): string {
  return input.billingEntityName?.trim() || "Kunde";
}

function buildSeparateInvoiceIntroSentence(input: {
  invoiceNumber?: string;
  shootLocation?: string;
  photoshootDate?: string;
}): string {
  const invoiceNumber = input.invoiceNumber?.trim() || "Rechnung";
  const location = input.shootLocation?.trim() || "";
  const date = formatGermanShootDate(input.photoshootDate) || "dem Shooting-Termin";
  if (location) {
    return `anbei erhalten Sie die Rechnung ${invoiceNumber} für unser Fotoshooting in ${location} vom ${date}.`;
  }
  return `anbei erhalten Sie die Rechnung ${invoiceNumber} für unser Fotoshooting vom ${date}.`;
}

export function buildSeparateInvoiceEmailHtml(input: {
  /** Billing entity / company name used in "Hallo …," */
  billingEntityName?: string;
  invoiceNumber?: string;
  shootLocation?: string;
  photoshootDate?: string;
  invoiceViewUrl?: string | null;
}): string {
  const billingEntityName = escapeHtml(resolveBillingEntitySalutationName(input));
  const intro = escapeHtml(buildSeparateInvoiceIntroSentence(input));
  const invoiceUrl =
    typeof input.invoiceViewUrl === "string" && input.invoiceViewUrl.trim()
      ? escapeHtml(input.invoiceViewUrl.trim())
      : "";

  const linkBlock = invoiceUrl
    ? `<p style="margin:18px 0 0;"><a href="${invoiceUrl}" target="_blank" style="color:rgb(32,33,36);">Rechnung online öffnen</a></p>`
    : "";

  return `<html>
<head></head>
<body>
  <div dir="ltr" style="font-family:arial,sans-serif;font-size:15px;line-height:1.5;color:rgb(32,33,36);">
    <p>Hallo ${billingEntityName},</p>
    <p>${intro}</p>
    <p>Bitte entnehmen Sie alle weiteren Details sowie die Zahlungsfrist dem angehängten PDF.</p>
    ${linkBlock}
    <p>Vielen Dank für die gute Zusammenarbeit!</p>
    <p>Viele Grüße,<br>
    Aaron Bowser<br>
    Aaron Bowser Photography</p>
  </div>
</body>
</html>`;
}

export function buildSeparateInvoiceEmailPlainText(input: {
  billingEntityName?: string;
  invoiceNumber?: string;
  shootLocation?: string;
  photoshootDate?: string;
  invoiceViewUrl?: string | null;
}): string {
  const billingEntityName = resolveBillingEntitySalutationName(input);
  const lines = [
    `Hallo ${billingEntityName},`,
    "",
    buildSeparateInvoiceIntroSentence(input),
    "",
    "Bitte entnehmen Sie alle weiteren Details sowie die Zahlungsfrist dem angehängten PDF.",
    "",
  ];
  if (input.invoiceViewUrl?.trim()) {
    lines.push(`Rechnung online öffnen: ${input.invoiceViewUrl.trim()}`, "");
  }
  lines.push(
    "Vielen Dank für die gute Zusammenarbeit!",
    "",
    "Viele Grüße,",
    "Aaron Bowser",
    "Aaron Bowser Photography"
  );
  return lines.join("\n");
}
