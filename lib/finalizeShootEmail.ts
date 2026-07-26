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
  shootLocation?: string;
  shootName?: string;
}): string {
  const place = input.shootLocation?.trim() || input.shootName?.trim() || "Photoshoot";
  return `Invoice for Photoshoot - ${place}`;
}

export function buildSeparateInvoiceEmailHtml(input: {
  shootLocation?: string;
  shootName?: string;
  invoiceViewUrl?: string | null;
}): string {
  const place = escapeHtml(
    input.shootLocation?.trim() || input.shootName?.trim() || "your recent photoshoot"
  );
  const invoiceUrl =
    typeof input.invoiceViewUrl === "string" && input.invoiceViewUrl.trim()
      ? escapeHtml(input.invoiceViewUrl.trim())
      : "";

  const linkBlock = invoiceUrl
    ? `<p style="margin:18px 0 0;"><a href="${invoiceUrl}" target="_blank" style="color:rgb(32,33,36);">Open invoice</a></p>`
    : `<p style="margin:18px 0 0;">The invoice PDF is attached to this email.</p>`;

  return `<html>
<head></head>
<body>
  <div dir="ltr" style="font-family:arial,sans-serif;font-size:15px;line-height:1.5;color:rgb(32,33,36);">
    <p>Hello,</p>
    <p>Attached/linked is the invoice for the recent photoshoot at <strong>${place}</strong>. Let us know if you have any questions!</p>
    ${linkBlock}
    <br>
    <div>
      <b>Aaron Bowser</b><br>
      Photographer<br>
      <a href="http://aaronbowser-photography.com">aaronbowser-photography.com</a>
    </div>
  </div>
</body>
</html>`;
}

export function buildSeparateInvoiceEmailPlainText(input: {
  shootLocation?: string;
  shootName?: string;
  invoiceViewUrl?: string | null;
}): string {
  const place = input.shootLocation?.trim() || input.shootName?.trim() || "your recent photoshoot";
  const lines = [
    "Hello,",
    "",
    `Attached/linked is the invoice for the recent photoshoot at ${place}. Let us know if you have any questions!`,
    "",
  ];
  if (input.invoiceViewUrl?.trim()) {
    lines.push(`Open invoice: ${input.invoiceViewUrl.trim()}`, "");
  } else {
    lines.push("The invoice PDF is attached to this email.", "");
  }
  lines.push("--", "Aaron Bowser", "Photographer", "http://aaronbowser-photography.com");
  return lines.join("\n");
}
