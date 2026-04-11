export interface DownloadProgress {
  id: string;
  percent: number;
  speed: string;
  eta: string;
  status: 'downloading' | 'paused' | 'completed' | 'error' | 'idle' | 'preparing' | 'oauth_required' | 'skipped' | 'converting';
  filename: string;
  output_path: string;
  total_size: string;
  thumbnail_path: string;
  raw?: string;
  title?: string;
  thumbnail?: string;
  thumbnailBase64?: string;
  error_message?: string;
  url: string;
  quality: string;
  format: string;
  extension?: string;
}

export interface DownloadHistoryItem {
  id: string;
  url: string;
  title: string;
  filename: string;
  filepath: string;
  type: 'video' | 'audio' | 'image' | 'other';
  ext?: string;
  completedAt: number;
  sizeLabel: string;
  thumbnailDataUrl?: string;
  format: string;
  quality: string;
  status: 'active' | 'deleted';
}

export interface Settings {
  theme: 'dark' | 'light';
  soundEnabled: boolean;
  desktopNotification: boolean;
  maxDownloads: number;
  useBrowserCookies: boolean;
}
