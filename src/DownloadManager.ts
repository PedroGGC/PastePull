import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface DownloadProgress {
  percent: number;
  size: string;
  speed: string;
  eta: string;
  raw: string;
  status: 'downloading' | 'skipped' | 'finished' | 'error' | 'oauth_required';
  thumbnail?: string;
  title?: string;
}

export class DownloadManager {
  async startDownload(url: string, quality: string, downloadPath: string, onProgress: (progress: DownloadProgress) => void): Promise<void> {
    const unlisten = await listen<string>('download-progress', (event) => {
      const line = event.payload;
      
      const oauthMatch = line.match(/go to\s+(https?:\/\/[^\s]+)\s+and enter code\s+([A-Z0-9-]+)/i);
      if (oauthMatch) {
        onProgress({ 
          percent: 0, size: '', speed: '', eta: '', raw: line, 
          status: 'oauth_required', 
          title: oauthMatch[1], 
          thumbnail: oauthMatch[2] 
        });
        return;
      }

      if (/has already been downloaded/i.test(line)) {
        onProgress({ percent: 100, size: '', speed: '', eta: '', raw: line, status: 'skipped' });
        return;
      }

      const regex = /\[download\]\s+([\d\.]+)%\s+of\s+([^ ]+)\s+at\s+([^ ]+)\s+ETA\s+([^ ]+)/;
      const match = line.match(regex);
      
      if (match) {
        onProgress({
          percent: parseFloat(match[1]),
          size: match[2],
          speed: match[3],
          eta: match[4],
          raw: line,
          status: 'downloading'
        });
      } else {
        onProgress({ percent: 0, size: '', speed: '', eta: '', raw: line, status: 'downloading' });
      }
    });

    try {
      await invoke('download_video', { 
        url: url, 
        quality: quality, 
        downloadPath: downloadPath 
      });
      onProgress({ percent: 100, size: '', speed: '', eta: '', raw: 'Download concluído', status: 'finished' });
    } catch (error) {
      throw error;
    } finally {
      setTimeout(() => {
        if (unlisten) {
          unlisten();
        }
      }, 500);
    }
  }
}