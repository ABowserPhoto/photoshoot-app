export function getDirectoryFromFilePath(absolutePath: string): string {
  const lastSeparator = Math.max(absolutePath.lastIndexOf("/"), absolutePath.lastIndexOf("\\"));
  if (lastSeparator <= 0) {
    return absolutePath;
  }
  return absolutePath.slice(0, lastSeparator);
}

export function getElectronFilePath(file: File): string | null {
  const electronPath = (file as File & { path?: string }).path?.trim();
  return electronPath || null;
}
