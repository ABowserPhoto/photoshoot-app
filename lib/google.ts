import { createReadStream } from "node:fs";
import fs from "node:fs";
import path from "node:path";

import { google } from "googleapis";
import type { JWT } from "google-auth-library";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/gmail.compose",
] as const;

export interface CreateDriveFolderResult {
  id: string;
  /** Shareable folder URL (`webViewLink`, or constructed Drive folders URL fallback). */
  webViewLink: string;
}

export interface CreateGmailDraftResult {
  id: string;
}

export interface UploadFilesToDriveResult {
  uploadedCount: number;
  fileNames: string[];
}

const GOOGLE_DRIVE_UPLOAD_DELAY_MS = 300;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff"]);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  cc?: string;
}): string {
  const from = sanitizeHeaderValue(options.from);
  const to = sanitizeHeaderValue(options.to);
  const cc = options.cc?.trim() ? sanitizeHeaderValue(options.cc.trim()) : "";
  const subject = encodeSubject(options.subject);
  const htmlBody = options.htmlBody.replace(/\r?\n/g, "\r\n");
  const plainText = (options.plainTextFallback ?? "").replace(/\r?\n/g, "\r\n");
  const htmlBase64 = foldBase64(Buffer.from(htmlBody, "utf8").toString("base64"));
  const ccHeader = cc ? [`Cc: ${cc}`] : [];

  if (!options.attachmentBuffer) {
    if (plainText) {
      const alternativeBoundary = `alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const plainBase64 = foldBase64(Buffer.from(plainText, "utf8").toString("base64"));
      return [
        `From: ${from}`,
        `To: ${to}`,
        ...ccHeader,
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
      ...ccHeader,
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
    ...ccHeader,
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

function guessImageMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    default:
      return "application/octet-stream";
  }
}

function listDeliverableImageFiles(localFolderPath: string): string[] {
  const trimmedPath = localFolderPath.trim();
  if (!fs.existsSync(trimmedPath)) {
    throw new Error(`Deliverables folder does not exist: ${trimmedPath}`);
  }

  const stats = fs.statSync(trimmedPath);
  if (!stats.isDirectory()) {
    throw new Error(`Deliverables path is not a directory: ${trimmedPath}`);
  }

  return fs
    .readdirSync(trimmedPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."))
    .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
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
        : `https://drive.google.com/drive/folders/${id}`;

    return { id, webViewLink };
  } catch (error) {
    throw new Error(`Google Drive folder creation failed: ${extractGoogleApiError(error)}`);
  }
}

export async function uploadFilesToDrive(
  folderId: string,
  localFolderPath: string
): Promise<UploadFilesToDriveResult> {
  const trimmedFolderId = folderId.trim();
  if (!trimmedFolderId) {
    throw new Error("folderId is required.");
  }

  const imageFiles = listDeliverableImageFiles(localFolderPath);
  if (imageFiles.length === 0) {
    throw new Error(`No image files found in deliverables folder: ${localFolderPath.trim()}`);
  }

  const { drive } = await getGoogleClients();
  const uploadedFileNames: string[] = [];

  for (let index = 0; index < imageFiles.length; index += 1) {
    const fileName = imageFiles[index];
    const filePath = path.join(localFolderPath.trim(), fileName);

    try {
      await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [trimmedFolderId],
        },
        media: {
          mimeType: guessImageMimeType(fileName),
          body: createReadStream(filePath),
        },
        fields: "id",
      });
      uploadedFileNames.push(fileName);
    } catch (error) {
      throw new Error(`Google Drive upload failed for "${fileName}": ${extractGoogleApiError(error)}`);
    }

    if (index < imageFiles.length - 1) {
      await delay(GOOGLE_DRIVE_UPLOAD_DELAY_MS);
    }
  }

  return {
    uploadedCount: uploadedFileNames.length,
    fileNames: uploadedFileNames,
  };
}

export async function createGmailDraft(
  to: string,
  subject: string,
  htmlBody: string,
  attachmentBuffer?: Buffer,
  attachmentFileName?: string,
  options?: { plainTextFallback?: string; cc?: string }
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
    cc: options?.cc,
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
