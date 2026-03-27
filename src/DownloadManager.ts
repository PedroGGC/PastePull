import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export class DownloadManager {
  async startDownload(url: string, quality: string, downloadPath: string, onProgress: (progress: string) => void): Promise<void> {
    const unlisten = await listen<string>('download-progress', (event) => {
      onProgress(event.payload);
    });

    try {
      const respostaDoRust = await invoke('download_video', { 
        url: url, 
        quality: quality, 
        downloadPath: downloadPath 
      });
      
      console.log("SUCESSO:", respostaDoRust);
      
    } catch (error) {
      console.error("ERRO DO RUST:", error);
    } finally {
      unlisten();
    }
  }
}