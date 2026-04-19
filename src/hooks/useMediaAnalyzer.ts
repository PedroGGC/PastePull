import { useState, useEffect, useRef, useImperativeHandle } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface MediaInfo {
  title: string;
  thumbnail: string;
  qualityLabel: string;
  type: 'video' | 'audio';
  isPlaylist?: boolean;
  playlistItems?: PlaylistItem[];
  playlistCount?: number;
  playlistWarning?: string;
}

export interface PlaylistItem {
  id: string;
  title: string;
  duration: string;
  selected: boolean;
  available: boolean;
  videoUrl?: string;
}

interface UseMediaAnalyzerOptions {
  onError?: (message: string) => void;
}

interface UseMediaAnalyzerReturn {
  analyzedMedia: MediaInfo | null;
  isAnalyzing: boolean;
  videoQualities: string[];
  mediaCapabilities: { video: boolean; audio: boolean };
  togglePlaylistItem: (index: number) => void;
  selectAllPlaylist: (select: boolean) => void;
  getSelectedPlaylistItems: () => PlaylistItem[];
}

export function useMediaAnalyzer(url: string, options?: UseMediaAnalyzerOptions): UseMediaAnalyzerReturn {
  const [analyzedMedia, setAnalyzedMedia] = useState<MediaInfo | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [videoQualities, setVideoQualities] = useState<string[]>([]);
  const [mediaCapabilities, setMediaCapabilities] = useState({ video: true, audio: true });

  const metadataTitleRef = useRef<string>('');
  const metadataThumbnailRef = useRef<string>('');
  const playlistItemsRef = useRef<PlaylistItem[]>([]);

  useEffect(() => {
    if (!url.startsWith('http')) {
      setAnalyzedMedia(null);
      setIsAnalyzing(false);
      return;
    }

    // Opt 2 (frontend): prevenir parse e setStates se o usuário mudou a URL logo depois
    let isAborted = false;

    const timeout = setTimeout(async () => {
      if (isAborted) return;
      setIsAnalyzing(true);
      setMediaCapabilities({ video: true, audio: true });

      try {
        // Primeiro, detectar se é playlist
        let isPlaylist = false;
        let playlistData: PlaylistItem[] = [];
        let playlistCount = 0;
        let playlistWarning = '';
        
        try {
          const playlistJson = await invoke<string>('get_playlist_items', { url });
          if (!isAborted && playlistJson && !playlistJson.includes("não é uma playlist")) {
            const items = playlistJson.split('|||').filter(i => i);
            playlistCount = items.length;
            
            // Só é playlist se tiver mais de 1 vídeo
            if (playlistCount > 1) {
              isPlaylist = true;
              playlistData = items.map((item, index) => {
                const parts = item.split('|');
                const title = parts[0] || '';
                const duration = parts[1] || '00:00';
                const status = parts[2] || 'available';
                const videoId = parts[3] || '';
                const isAvailable = status === 'available';
                const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined;
                
                return {
                  id: `playlist_${index}`,
                  title: title || `Video ${index + 1}`,
                  duration: duration,
                  selected: isAvailable,
                  available: isAvailable,
                  videoUrl
                };
              });
              playlistItemsRef.current = playlistData;
            }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errMsg.includes("unavailable") || errMsg.includes("Video unavailable")) {
            playlistWarning = 'unavailable';
          } else {
            playlistWarning = 'generic';
          }
        }
        
        const metadataJson = await invoke<string>('get_video_metadata', { url });
        if (isAborted) return;
        const meta = JSON.parse(metadataJson);
        
        metadataTitleRef.current = meta.title || '';
        metadataThumbnailRef.current = meta.thumbnail || '';
        
        const hSet = new Set<number>();
        if (meta.formats) {
          for (const f of meta.formats) {
            if (f.vcodec !== 'none' && f.height && f.height >= 360) hSet.add(f.height);
          }
        }
        const heights = Array.from(hSet).sort((a, b) => b - a);
        const vOptions: string[] = [];
        heights.forEach(h => vOptions.push(`${h}P`));
        if (vOptions.length === 0 && meta.vcodec === 'none') {
        } else if (vOptions.length === 0) {
           vOptions.push('BEST QUALITY');
        }
        
        setVideoQualities(vOptions);
        
        let type: 'video' | 'audio' = vOptions.length === 0 ? 'audio' : 'video';
        
        const availableCount = playlistData.filter(i => i.available).length;
        
        setAnalyzedMedia({ 
          title: meta.title || '', 
          thumbnail: meta.thumbnail || '', 
          qualityLabel: vOptions.length > 0 ? vOptions[0] : 'AUDIO ONLY', 
          type,
          isPlaylist: isPlaylist,
          playlistItems: playlistData,
          playlistCount,
          playlistWarning: playlistWarning
        });
        setMediaCapabilities({ video: vOptions.length > 0, audio: true });
        
      } catch (err) {
        console.error('Análise do link falhou:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        
        // Se erro contém "INFO - X unavailable", é erro de playlist (não é bloqueio real)
        // Não mostrar erro, deixar continuar
        const isPlaylistInfo = errMsg.includes('INFO') && errMsg.includes('unavailable');
        
        if (!isPlaylistInfo) {
          if (errMsg.toLowerCase().includes('requested format') || errMsg.toLowerCase().includes('format is not available')) {
            options?.onError?.('Formato não disponível para este conteúdo. Tente outra qualidade.');
          } else if (errMsg.toLowerCase().includes('youtube') || errMsg.toLowerCase().includes('bot')) {
            options?.onError?.('YouTube está sendo chato, tente novamente mais tarde!');
          } else if (errMsg.toLowerCase().includes('sign in to confirm') || errMsg.toLowerCase().includes('cookies')) {
            options?.onError?.('Login necessário para este conteúdo');
          } else {
            options?.onError?.('Erro ao analisar o link');
          }
        }
        
        if (isAborted) return;
        
        // Se erro contém "INFO - unavailable", criar analyzedMedia com warning
        // para que o alerta apareça no MediaInput
        if (isPlaylistInfo) {
          // Mostrar pop-up de notificação AMARELO (warning) igual ao do YouTube
          options?.onError?.('Esta playlist contém vídeos removidos. Tente colar o link de um vídeo específico da playlist.');
          
          setAnalyzedMedia(null);
        } else {
          setAnalyzedMedia(null);
          setMediaCapabilities({ video: true, audio: true });
          setVideoQualities(['BEST QUALITY']);
        }
      } finally {
        if (!isAborted) setIsAnalyzing(false);
      }
    }, 1000);

    return () => {
      isAborted = true;
      clearTimeout(timeout);
    };
  }, [url]);

  const togglePlaylistItem = (index: number) => {
    if (!analyzedMedia?.playlistItems) return;
    const item = analyzedMedia.playlistItems[index];
    if (!item.available) return;
    
    const newItems = [...analyzedMedia.playlistItems];
    newItems[index] = { ...newItems[index], selected: !newItems[index].selected };
    playlistItemsRef.current = newItems;
    setAnalyzedMedia({ ...analyzedMedia, playlistItems: newItems });
  };

  const selectAllPlaylist = (select: boolean) => {
    if (!analyzedMedia?.playlistItems) return;
    const newItems = analyzedMedia.playlistItems.map(item => ({
      ...item,
      selected: item.available ? select : item.selected
    }));
    playlistItemsRef.current = newItems;
    setAnalyzedMedia({ ...analyzedMedia, playlistItems: newItems });
  };

  const getSelectedPlaylistItems = (): PlaylistItem[] => {
    return playlistItemsRef.current.filter(item => item.selected && item.available);
  };

  return {
    analyzedMedia,
    isAnalyzing,
    videoQualities,
    mediaCapabilities,
    togglePlaylistItem,
    selectAllPlaylist,
    getSelectedPlaylistItems,
  };
}
