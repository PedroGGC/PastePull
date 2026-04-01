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

export function isTempFile(filepath: string): boolean {
  const lower = filepath.toLowerCase();
  const validMediaExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.m4v', '.ts', '.mp3', '.flac', '.aac', '.wav', '.ogg', '.m4a', '.opus'];
  const hasValidExt = validMediaExts.some(ext => lower.endsWith(ext));
  if (!hasValidExt) return true;
  
  return lower.includes('.fhls-') || 
         lower.includes('.fdash-') ||
         lower.includes('.fmp4') ||
         lower.includes('.part');
}