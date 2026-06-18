import { google } from "googleapis";
import type { JWT } from "google-auth-library";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/gmail.compose",
] as const;

export interface CreateDriveFolderResult {
  id: string;
  webViewLink: string | null;
}

export interface CreateGmailDraftResult {
  id: string;
}

let jwtClient: JWT | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function normalizePrivateKey(raw: string): string {
  let key = raw.trim();

  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }

  // .env / Vercel / Electron often store PEM newlines as the two-char sequence "\n".
  return key.replace(/\\n/g, "\n");
}

function getPrivateKey(): string {
  const key = normalizePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY"));
  if (!key.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      "GOOGLE_PRIVATE_KEY does not look like a PEM private key. Check newline escaping in your environment file."
    );
  }
  return key;
}

function getJwtClient(): JWT {
  if (!jwtClient) {
    const privateKey = getPrivateKey();
    jwtClient = new google.auth.JWT({
      email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
      key: privateKey,
      scopes: [...GOOGLE_SCOPES],
      subject: requiredEnv("GOOGLE_WORKSPACE_USER_EMAIL"),
    });
  }
  return jwtClient;
}

async function getGoogleClients() {
  const auth = getJwtClient();
  await auth.authorize();

  return {
    drive: google.drive({ version: "v3", auth }),
    gmail: google.gmail({ version: "v1", auth }),
    senderEmail: requiredEnv("GOOGLE_WORKSPACE_USER_EMAIL"),
  };
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function foldBase64(value: string): string {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += 76) {
    chunks.push(value.slice(index, index + 76));
  }
  return chunks.join("\r\n");
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodeSubject(subject: string): string {
  const sanitized = sanitizeHeaderValue(subject);
  if (/^[\x20-\x7E]*$/.test(sanitized)) {
    return sanitized;
  }
  const encoded = Buffer.from(sanitized, "utf8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

function sanitizeAttachmentFileName(fileName: string): string {
  const trimmed = fileName.trim() || "attachment.pdf";
  return trimmed.replace(/[^\w.\-() ]+/g, "_");
}

function buildRawEmail(options: {
  from: string;
  to: string;
  subject: string;
  htmlBody: string;
  plainTextFallback?: string;
  attachmentBuffer?: Buffer;
  attachmentFileName?: string;
}): string {
  const from = sanitizeHeaderValue(options.from);
  const to = sanitizeHeaderValue(options.to);
  const subject = encodeSubject(options.subject);
  const htmlBody = options.htmlBody.replace(/\r?\n/g, "\r\n");
  const plainText = (options.plainTextFallback ?? "").replace(/\r?\n/g, "\r\n");
  const htmlBase64 = foldBase64(Buffer.from(htmlBody, "utf8").toString("base64"));

  if (!options.attachmentBuffer) {
    if (plainText) {
      const alternativeBoundary = `alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const plainBase64 = foldBase64(Buffer.from(plainText, "utf8").toString("base64"));
      return [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        "MIME-Version: 1.0",
        `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
        "",
        `--${alternativeBoundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        plainBase64,
        `--${alternativeBoundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        htmlBase64,
        `--${alternativeBoundary}--`,
        "",
      ].join("\r\n");
    }

    return [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      htmlBase64,
    ].join("\r\n");
  }

  const mixedBoundary = `mixed_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const alternativeBoundary = `alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const attachmentFileName = sanitizeAttachmentFileName(options.attachmentFileName ?? "attachment.pdf");
  const attachmentBase64 = foldBase64(options.attachmentBuffer.toString("base64"));

  const parts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    "",
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(Buffer.from(plainText || "Ihre Fotos sind da!", "utf8").toString("base64")),
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    htmlBase64,
    `--${alternativeBoundary}--`,
    `--${mixedBoundary}`,
    `Content-Type: application/pdf; name="${attachmentFileName}"`,
    `Content-Disposition: attachment; filename="${attachmentFileName}"`,
    "Content-Transfer-Encoding: base64",
    "",
    attachmentBase64,
    `--${mixedBoundary}--`,
    "",
  ];

  return parts.join("\r\n");
}

function extractGoogleApiError(error: unknown): string {
  if (error && typeof error === "object") {
    const apiError = error as {
      message?: string;
      response?: { data?: { error?: { message?: string } } };
    };
    const nested = apiError.response?.data?.error?.message;
    if (typeof nested === "string" && nested.trim()) {
      return nested.trim();
    }
    if (typeof apiError.message === "string" && apiError.message.trim()) {
      return apiError.message.trim();
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export async function createDriveFolder(
  folderName: string,
  parentFolderId?: string
): Promise<CreateDriveFolderResult> {
  const trimmedName = folderName.trim();
  if (!trimmedName) {
    throw new Error("folderName is required.");
  }

  const parentId = parentFolderId?.trim();
  const { drive } = await getGoogleClients();

  try {
    const response = await drive.files.create({
      requestBody: {
        name: trimmedName,
        mimeType: "application/vnd.google-apps.folder",
        ...(parentId ? { parents: [parentId] } : {}),
      },
      fields: "id, webViewLink",
    });

    const id = typeof response.data.id === "string" ? response.data.id.trim() : "";
    if (!id) {
      throw new Error("Google Drive folder was created but no folder id was returned.");
    }

    const webViewLink =
      typeof response.data.webViewLink === "string" && response.data.webViewLink.trim()
        ? response.data.webViewLink.trim()
        : null;

    return { id, webViewLink };
  } catch (error) {
    throw new Error(`Google Drive folder creation failed: ${extractGoogleApiError(error)}`);
  }
}

export async function createGmailDraft(
  to: string,
  subject: string,
  htmlBody: string,
  attachmentBuffer?: Buffer,
  attachmentFileName?: string,
  options?: { plainTextFallback?: string }
): Promise<CreateGmailDraftResult> {
  const recipient = to.trim();
  if (!recipient) {
    throw new Error("Recipient email address is required.");
  }
  if (!subject.trim()) {
    throw new Error("Email subject is required.");
  }
  if (!htmlBody.trim()) {
    throw new Error("htmlBody is required.");
  }
  if (attachmentBuffer && attachmentBuffer.length === 0) {
    throw new Error("attachmentBuffer cannot be empty when provided.");
  }

  const { gmail, senderEmail } = await getGoogleClients();
  const rawEmail = buildRawEmail({
    from: senderEmail,
    to: recipient,
    subject,
    htmlBody,
    plainTextFallback: options?.plainTextFallback,
    attachmentBuffer,
    attachmentFileName,
  });

  try {
    const response = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          raw: encodeBase64Url(rawEmail),
        },
      },
    });

    const id = typeof response.data.id === "string" ? response.data.id.trim() : "";
    if (!id) {
      throw new Error("Gmail draft was created but no draft id was returned.");
    }

    return { id };
  } catch (error) {
    throw new Error(`Gmail draft creation failed: ${extractGoogleApiError(error)}`);
  }
}
