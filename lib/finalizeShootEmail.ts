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
}): string {
  const driveLink = escapeHtml(input.googleDriveLink.trim());
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
                            <img src="https://res.cloudinary.com/dggils0xr/image/upload/v1778187091/FotosDa_cmxr5c.png" alt="CoverImage" width="100%" style="display:block; height:auto;">
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
  clientName?: string;
  invoiceNumber?: string;
  photoshootDate?: string;
}): string {
  const client = input.clientName?.trim() || "Client";
  const invoiceNumber = input.invoiceNumber?.trim() || "Rechnung";
  const date = formatGermanShootDate(input.photoshootDate) || "—";
  return `Invoice | ${client} - ${invoiceNumber} - ${date}`;
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

function resolveInvoiceContactSalutationName(input: {
  contactFirstName?: string;
  contactName?: string;
}): string {
  const first = input.contactFirstName?.trim();
  if (first) return first;
  const full = input.contactName?.trim();
  if (!full) return "Kunde";
  return full.split(/\s+/).filter(Boolean)[0] || full;
}

export function buildSeparateInvoiceEmailHtml(input: {
  contactFirstName?: string;
  contactName?: string;
  invoiceNumber?: string;
  photoshootDate?: string;
  invoiceViewUrl?: string | null;
}): string {
  const contactName = escapeHtml(resolveInvoiceContactSalutationName(input));
  const invoiceNumber = escapeHtml(input.invoiceNumber?.trim() || "Rechnung");
  const date = escapeHtml(formatGermanShootDate(input.photoshootDate) || "dem Shooting-Termin");
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
    <p>Hallo ${contactName},</p>
    <p>anbei erhalten Sie die Rechnung ${invoiceNumber} für unser Fotoshooting vom ${date}.</p>
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
  contactFirstName?: string;
  contactName?: string;
  invoiceNumber?: string;
  photoshootDate?: string;
  invoiceViewUrl?: string | null;
}): string {
  const contactName = resolveInvoiceContactSalutationName(input);
  const invoiceNumber = input.invoiceNumber?.trim() || "Rechnung";
  const date = formatGermanShootDate(input.photoshootDate) || "dem Shooting-Termin";
  const lines = [
    `Hallo ${contactName},`,
    "",
    `anbei erhalten Sie die Rechnung ${invoiceNumber} für unser Fotoshooting vom ${date}.`,
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
