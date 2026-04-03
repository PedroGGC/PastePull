export function safeBtoa(str: string): string {
  try {
    return btoa(encodeURIComponent(str)).replace(/=/g, '');
  } catch {
    return btoa(str).replace(/=/g, '');
  }
}

export function normalizeFileName(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

export function normalizeFilepath(filepath: string): string {
  return filepath
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/\\+/g, '/')
    .trim();
}