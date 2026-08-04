/**
 * Deliverable file types accepted on the Edited-stage upload path
 * (local 4_Final write + Google Drive upload).
 */

export const DELIVERABLE_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".tif", ".tiff"] as const;
export const DELIVERABLE_VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".mkv", ".webm"] as const;
export const DELIVERABLE_DOCUMENT_EXTENSIONS = [".pdf"] as const;

export const DELIVERABLE_EXTENSIONS = new Set<string>([
  ...DELIVERABLE_IMAGE_EXTENSIONS,
  ...DELIVERABLE_VIDEO_EXTENSIONS,
  ...DELIVERABLE_DOCUMENT_EXTENSIONS,
]);

/** HTML file-input `accept` value for the Edited upload modal. */
export const DELIVERABLE_FILE_INPUT_ACCEPT = [
  "image/jpeg",
  "image/jpg",
  ".jpg",
  ".jpeg",
  "video/*",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  "application/pdf",
  ".pdf",
].join(",");

export function getFileExtension(fileName: string): string {
  const base = fileName.trim().split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  return base.slice(dot).toLowerCase();
}

export function isDeliverableFileName(fileName: string): boolean {
  return DELIVERABLE_EXTENSIONS.has(getFileExtension(fileName));
}

/** True for raster images that gallery/Sharp pipelines may process. */
export function isDeliverableImageFileName(fileName: string): boolean {
  return (DELIVERABLE_IMAGE_EXTENSIONS as readonly string[]).includes(getFileExtension(fileName));
}

export function guessDeliverableMimeType(fileName: string): string {
  switch (getFileExtension(fileName)) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".avi":
      return "video/x-msvideo";
    case ".mkv":
      return "video/x-matroska";
    case ".webm":
      return "video/webm";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

/** Browser File check for the Edited upload dropzone / picker. */
export function isEditedUploadFile(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg") return true;
  if (mime.startsWith("video/")) return true;
  if (mime === "application/pdf") return true;
  // Some browsers omit MIME for .mov / certain PDFs — fall back to extension.
  return isDeliverableFileName(file.name);
}
