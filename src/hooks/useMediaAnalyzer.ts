import { useState, useEffect, useRef, useImperativeHandle } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface MediaInfo {
  title: string;
  thumbnail: string;
  qualityLabel: string;
  type: 'video' | 'audio';
}

interface UseMediaAnalyzerOptions {
  onError?: (message: string) => void;
}

interface UseMediaAnalyzerReturn {
  analyzedMedia: MediaInfo | null;
  isAnalyzing: boolean;
  videoQualities: string[];
  mediaCapabilities: { video: boolean; audio: boolean };
}

export function useMediaAnalyzer(url: string, options?: UseMediaAnalyzerOptions): UseMediaAnalyzerReturn {
  const [analyzedMedia, setAnalyzedMedia] = useState<MediaInfo | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [videoQualities, setVideoQualities] = useState<string[]>([]);
  const [mediaCapabilities, setMediaCapabilities] = useState({ video: true, audio: true });

  const metadataTitleRef = useRef<string>('');
  const metadataThumbnailRef = useRef<string>('');

  useEffect(() => {
    if (!url.startsWith('http')) {
      setAnalyzedMedia(null);
      setIsAnalyzing(false);
      return;
    }

    const timeout = setTimeout(async () => {
      setIsAnalyzing(true);
      setMediaCapabilities({ video: true, audio: true });

      try {
        const metadataJson = await invoke<string>('get_video_metadata', { url });
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
        
        setAnalyzedMedia({ 
          title: meta.title || '', 
          thumbnail: meta.thumbnail || '', 
          qualityLabel: vOptions.length > 0 ? vOptions[0] : 'AUDIO ONLY', 
          type 
        });
        setMediaCapabilities({ video: vOptions.length > 0, audio: true });
        
      } catch (err) {
        console.error('Análise do link falhou:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.toLowerCase().includes('requested format') || errMsg.toLowerCase().includes('format is not available')) {
          options?.onError?.('Formato não disponível para este conteúdo. Tente outra qualidade.');
        } else if (errMsg.toLowerCase().includes('youtube') || errMsg.toLowerCase().includes('bot')) {
          options?.onError?.('YouTube está sendo chato, tente novamente mais tarde!');
        } else if (errMsg.toLowerCase().includes('sign in to confirm') || errMsg.toLowerCase().includes('cookies')) {
          options?.onError?.('Login necessário para este conteúdo');
        } else {
          options?.onError?.('Erro ao analisar o link');
        }
        setAnalyzedMedia(null);
        setMediaCapabilities({ video: true, audio: true });
        setVideoQualities(['BEST QUALITY']);
      } finally {
        setIsAnalyzing(false);
      }
    }, 1000);

    return () => clearTimeout(timeout);
  }, [url]);

  return {
    analyzedMedia,
    isAnalyzing,
    videoQualities,
    mediaCapabilities,
  };
}
