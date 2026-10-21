export function readComfyUploadFilename(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) {
    return "";
  }
  if (/[\\/]/.test(name) || /^[a-zA-Z]:/.test(name)) {
    throw new Error("ComfyUI image name must be a filename from the upload endpoint, not a disk path.");
  }
  return name;
}
