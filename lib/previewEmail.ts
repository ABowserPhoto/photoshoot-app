import {
  resolveImmobilienPreviewEmailAssets,
  resolvePreviewEmailVariant,
  resolveStandardPreviewEmailAssets,
  type PreviewEmailVariant,
} from "@/lib/emailTemplateAssets";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildPreviewEmailSubject(input: {
  clientName?: string;
  shootLocation?: string;
}): string {
  const location = input.shootLocation?.trim();
  if (location) {
    return `Ihre Foto-Vorschau ist bereit – ${location}`;
  }
  const client = input.clientName?.trim();
  if (client) {
    return `Ihre Foto-Vorschau ist bereit – ${client}`;
  }
  return "Ihre Foto-Vorschau ist bereit";
}

function buildStepImageCell(imageUrl: string, alt: string, widthPercent: number): string {
  const src = escapeHtml(imageUrl);
  const altText = escapeHtml(alt);
  return `<td align="center" valign="top" width="${widthPercent}%" style="width:${widthPercent}%; padding:8px 6px;">
  <img src="${src}" alt="${altText}" width="100%" style="display:block; width:100%; max-width:100%; height:auto; border:0; outline:none; text-decoration:none;">
</td>`;
}

/** Escapes copy while preserving trusted <strong>/<b> tags from the template. */
function formatTrustedStepBodyHtml(bodyHtml: string): string {
  const tokenOpen = "%%STRONG_OPEN%%";
  const tokenClose = "%%STRONG_CLOSE%%";
  const normalized = bodyHtml
    .replace(/<\/?strong>/gi, (tag) => (tag.startsWith("</") ? tokenClose : tokenOpen))
    .replace(/<\/?b>/gi, (tag) => (tag.startsWith("</") ? tokenClose : tokenOpen));
  return escapeHtml(normalized)
    .replaceAll(tokenOpen, "<strong>")
    .replaceAll(tokenClose, "</strong>");
}

function buildImmobilienStepCell(input: {
  imageUrl: string;
  title: string;
  bodyHtml: string;
  widthPercent: number;
}): string {
  const src = escapeHtml(input.imageUrl);
  const title = escapeHtml(input.title);
  const body = formatTrustedStepBodyHtml(input.bodyHtml);
  return `<td align="center" valign="top" width="${input.widthPercent}%" style="width:${input.widthPercent}%; padding:8px 6px;">
  <img src="${src}" alt="${title}" width="100%" style="display:block; width:100%; max-width:100%; height:auto; border:0; outline:none; text-decoration:none;">
  <div style="font-family:arial,sans-serif;font-size:13px;line-height:1.4;color:rgb(95,99,104);padding:12px 4px 4px; text-align:center;">
    <div style="font-size:15px;font-weight:bold;color:rgb(32,33,36);margin-bottom:6px;">${title}</div>
    <div>${body}</div>
  </div>
</td>`;
}

function buildPreviewEmailHtml(input: {
  previewLink: string;
  headerImageUrl: string;
  stepCellsHtml: string;
}): string {
  const previewLink = escapeHtml(input.previewLink.trim());
  const headerImageUrl = escapeHtml(input.headerImageUrl);

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
                            <img src="${headerImageUrl}" alt="PreviewHeader" width="100%" style="display:block; width:100%; max-width:100%; height:auto; border:0; outline:none; text-decoration:none;">
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    <table width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="white">
                      <tbody>
                        <tr>
                          <td align="center" style="padding:20px 10px 0px;">
                            <div style="font-family:arial,sans-serif;font-size:32px;color:rgb(32,33,36)">Ihre Vorschau ist bereit!</div>
                          </td>
                        </tr>
                        <tr>
                          <td align="center" style="padding:18px 40px 0px;">
                            <div style="font-family:arial,sans-serif;font-size:15px;line-height:1.4;color:rgb(95,99,104)">
                              Schau dir die Vorschaubilder an und triff deine Auswahl. Klicke einfach auf den Button, um zur Galerie zu gelangen.
                            </div>
                          </td>
                        </tr>

                        <tr>
                          <td align="center" style="padding:30px 0px 40px;">
                            <table border="0" cellpadding="0" cellspacing="0" style="background:rgb(240,167,57);border-radius:4px;line-height:100%;padding:12px 24px">
                              <tbody>
                                <tr>
                                  <td align="center" bgcolor="#f0a739">
                                    <a href="${previewLink}" style="color:rgb(0,0,0);font-family:arial,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;" target="_blank">Zur Galerie</a>
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
                          <td align="center" style="padding:24px 16px 8px;">
                            <div style="font-family:arial,sans-serif;font-size:18px;color:rgb(32,33,36)">So funktioniert's</div>
                          </td>
                        </tr>
                        <tr>
                          <td align="center" style="padding:8px 12px 28px;">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
                              <tbody>
                                <tr>
                                  ${input.stepCellsHtml}
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
                              <p><a href="${previewLink}" target="_blank">${previewLink}</a></p>
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

export function buildImmobilienPreviewEmailHtml(input: { previewLink: string }): string {
  const assets = resolveImmobilienPreviewEmailAssets();
  const stepWidth = Math.floor(100 / 3);
  const [step1, step2, step3] = assets.stepImageUrls;
  const stepCellsHtml = [
    buildImmobilienStepCell({
      imageUrl: step1,
      title: "Anschauen",
      bodyHtml: "Schau dir die Fotos an und entscheide, welche Fotos dir am besten gefallen.",
      widthPercent: stepWidth,
    }),
    buildImmobilienStepCell({
      imageUrl: step2,
      title: "Auswahl Treffen",
      bodyHtml:
        'Bitte markiere das Kästchen neben jedem Foto, das dir am besten gefällt. <strong>Neu!! Klick auf den Button "Auswahl Absenden"</strong>',
      widthPercent: stepWidth,
    }),
    buildImmobilienStepCell({
      imageUrl: step3,
      title: "Geduld",
      bodyHtml:
        "Die Fotos werden bearbeitet und in digitaler Form per E-Mail mit einem Link zum Herunterladen der Fotos geliefert.",
      widthPercent: stepWidth,
    }),
  ].join("\n");

  return buildPreviewEmailHtml({
    previewLink: input.previewLink,
    headerImageUrl: assets.headerImageUrl,
    stepCellsHtml,
  });
}

export function buildStandardPreviewEmailHtml(input: { previewLink: string }): string {
  const assets = resolveStandardPreviewEmailAssets();
  const stepWidth = Math.floor(100 / 3);
  const [step1, step2, step3] = assets.stepImageUrls;
  const stepCellsHtml = [
    buildStepImageCell(step1, "1. Anschauen", stepWidth),
    buildStepImageCell(step2, "2. Auswahl treffen", stepWidth),
    buildStepImageCell(step3, "3. Geduld", stepWidth),
  ].join("\n");

  return buildPreviewEmailHtml({
    previewLink: input.previewLink,
    headerImageUrl: assets.headerImageUrl,
    stepCellsHtml,
  });
}

export function buildPreviewEmailPlainText(input: {
  previewLink: string;
  emailVariant: PreviewEmailVariant;
}): string {
  const steps =
    input.emailVariant === "immobilien"
      ? [
          "Anschauen: Schau dir die Fotos an und entscheide, welche Fotos dir am besten gefallen.",
          'Auswahl Treffen: Bitte markiere das Kästchen neben jedem Foto, das dir am besten gefällt. Neu!! Klick auf den Button "Auswahl Absenden"',
          "Geduld: Die Fotos werden bearbeitet und in digitaler Form per E-Mail mit einem Link zum Herunterladen der Fotos geliefert.",
        ]
      : ["1. Anschauen", "2. Auswahl treffen", "3. Geduld"];

  return [
    "Ihre Vorschau ist bereit!",
    "",
    "Schau dir die Vorschaubilder an und triff deine Auswahl. Klicke einfach auf den Link, um zur Galerie zu gelangen.",
    "",
    `Zur Galerie: ${input.previewLink}`,
    "",
    "So funktioniert's:",
    ...steps,
    "",
    "--",
    "Aaron Bowser",
    "Photographer",
    "http://aaronbowser-photography.com",
  ].join("\n");
}

export function buildPreviewEmailContent(input: {
  photoshootType?: string | null;
  previewLink: string;
  clientName?: string;
  shootLocation?: string;
}): {
  emailVariant: PreviewEmailVariant;
  subject: string;
  htmlBody: string;
  plainTextBody: string;
} {
  const emailVariant = resolvePreviewEmailVariant(input.photoshootType);
  const subject = buildPreviewEmailSubject({
    clientName: input.clientName,
    shootLocation: input.shootLocation,
  });
  const htmlBody =
    emailVariant === "immobilien"
      ? buildImmobilienPreviewEmailHtml({ previewLink: input.previewLink })
      : buildStandardPreviewEmailHtml({ previewLink: input.previewLink });
  const plainTextBody = buildPreviewEmailPlainText({
    previewLink: input.previewLink,
    emailVariant,
  });

  return { emailVariant, subject, htmlBody, plainTextBody };
}
