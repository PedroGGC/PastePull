import { t, isEnglish } from './i18n';

export function inferFileType(filename: string): 'video' | 'audio' | 'other' {
  const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.m4v'];
  const audioExts = ['.mp3', '.flac', '.aac', '.wav', '.ogg', '.m4a', '.opus'];
  const lower = filename.toLowerCase();
  if (videoExts.some((ext) => lower.endsWith(ext))) return 'video';
  if (audioExts.some((ext) => lower.endsWith(ext))) return 'audio';
  return 'other';
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (isEnglish) {
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    return `${days} days ago`;
  }

  if (minutes < 1) return 'Agora mesmo';
  if (minutes < 60) return `${minutes} min atrás`;
  if (hours < 24) return `${hours}h atrás`;
  if (days === 1) return 'Ontem';
  return `${days} dias atrás`;
}

export function formatYtDlpSize(sizeStr: string): string {
  if (!sizeStr) return '';
  const clean = sizeStr.replace('~', '').trim();
  const match = clean.match(/^([\d.]+)\s*([a-zA-Z]+)?/);
  if (!match) return sizeStr;
  
  const val = parseFloat(match[1]);
  const unit = (match[2] || '').toUpperCase();
  
  let mb = val;
  if (unit.includes('K')) mb = val / 1024;
  else if (unit.includes('G')) mb = val * 1024;
  else if (unit.includes('T')) mb = val * 1024 * 1024;
  else if (unit === 'B' || unit === 'BYTES') mb = val / 1048576;
  
  if (mb >= 1000) {
    return `${(mb / 1024).toFixed(2).replace(/\.00$/, '')} GB`;
  } else if (mb >= 0.1) {
    return `${mb.toFixed(2).replace(/\.00$/, '')} MB`;
  } else {
    if (mb === 0) return sizeStr;
    return `${(mb * 1024).toFixed(0)} KB`;
  }
}

export function cleanTitle(filename: string | undefined): string {
  if (!filename) return t('Unknown Title', 'Título Desconhecido');
  let cleanStr = filename.replace(/\.[a-zA-Z0-9]{2,5}$/i, '');
  cleanStr = cleanStr.replace(/[.\s-]+(?:fhls|dash|hls|avc|aac|opus|av1|vp9|f\d{3})[-.]?[\w.-]*$/i, '');
  cleanStr = cleanStr.replace(/\s+-\s+https?:\/\/[^\s]+|https?:\/\/[^\s]+/i, '');
  cleanStr = cleanStr.replace(/\s+-\s+\S*[a-z]{2,}\.[a-z]{2,}\S*/i, '');
  cleanStr = cleanStr.replace(/\s+\[[a-zA-Z0-9_-]{6,}\]$/, '');
  cleanStr = cleanStr.replace(/\s+-\s+[a-zA-Z0-9_-]{8,}$/, '');

  const result = cleanStr.trim();
  return result.length > 0 ? result : t('Unknown Title', 'Título Desconhecido');
}
