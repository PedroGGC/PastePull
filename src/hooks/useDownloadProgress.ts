import { useEffect, useCallback, Dispatch, SetStateAction, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { DownloadProgress, DownloadHistoryItem } from '../types';
import { cleanTitle, formatYtDlpSize, inferFileType } from '../utils/formatters';
import { t } from '../utils/i18n';

interface UseDownloadProgressProps {
  currentProgress: Record<string, DownloadProgress>;
  setCurrentProgress: Dispatch<SetStateAction<Record<string, DownloadProgress>>>;
  downloadItems: DownloadHistoryItem[];
  setDownloadItems: Dispatch<SetStateAction<DownloadHistoryItem[]>>;
  saveHistoryToBackend: (items: DownloadHistoryItem[]) => Promise<void>;
  onDownloadComplete?: (item: DownloadHistoryItem) => void;
  playNotificationSound: () => void;
  showNotification: (type: 'success' | 'error' | 'warning', message: string, duration?: number) => void;
}

export function useDownloadProgress({
  currentProgress,
  setCurrentProgress,
  downloadItems,
  setDownloadItems,
  saveHistoryToBackend,
  onDownloadComplete,
  playNotificationSound,
  showNotification,
}: UseDownloadProgressProps) {
  // Fix 6: ref em vez de state — evita re-registro do listener a cada metadata cacheado.
  // O listener 'download-progress' é registrado apenas 1x (dependência []) e 
  // lê o cache via ref sem precisar de re-bind.
  const metadataTitleCacheRef = useRef<Record<string, { title: string; thumbnail: string }>>({});
  const processedCompletedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unlisten = listen<DownloadProgress>('download-progress', (event) => {
      const p = event.payload;
      if (!p.id) return;

      // Fix 6: lê do ref (sem causar re-render ou re-registration do listener)
      const cachedMeta = metadataTitleCacheRef.current[p.url];

      setCurrentProgress((prev) => {
        if (!prev || !prev[p.id]) {
          return prev || {};
        }
        const existing = prev[p.id];
        const updated: DownloadProgress = {
          ...p,
          thumbnail: existing?.thumbnail || p.thumbnail || '',
          thumbnailBase64: existing?.thumbnailBase64 || p.thumbnailBase64,
          title: cachedMeta?.title || existing?.title || p.title || p.filename,
        };

        if (p.status === 'converting') {
          return { ...prev, [p.id]: { ...prev[p.id], status: 'converting', percent: 99 } };
        }

        if (p.status === 'skipped' || p.status === 'completed') {
          if (processedCompletedRef.current.has(p.id)) {
            return prev;
          }
          processedCompletedRef.current.add(p.id);
          
          // Don't try to update prev if ID doesn't exist - just return prev
          const prevHasId = prev && prev[p.id];
          
          const resolveThumbnail = async () => {
            if (!p.thumbnail_path && !p.thumbnail) return null;
            if (p.thumbnailBase64) return p.thumbnailBase64;
            try { 
              return await invoke<string>('read_thumbnail_as_base64', { path: p.thumbnail_path || '' }); 
            }
            catch (err) { 
              console.error('History thumb error:', err); 
              return null; 
            }
          };

          resolveThumbnail().then((dataUrl) => {
            setTimeout(() => {
              playNotificationSound();
              
              // Rebuild correct filepath using requested extension
              const getCorrectFilepath = () => {
                if (!p.output_path) return '';
                
                const lastSlash = Math.max(p.output_path.lastIndexOf('/'), p.output_path.lastIndexOf('\\'));
                const dir = lastSlash > 0 ? p.output_path.substring(0, lastSlash + 1) : '';
                
                // Get file base name (without extension)
                const filenameBase = p.filename ? p.filename.replace(/\.[^.]+$/, '') : '';
                
                // Use requested extension (p.extension), not temp file extension
                const ext = p.extension ? p.extension.toLowerCase() : 'mp3';
                
                // Use filename base if available, otherwise extract from output_path
                const baseName = filenameBase || (p.output_path ? p.output_path.replace(/[\\/][^\\/]+$/, '').split(/[\\/]/).pop() : '');
                
                return dir + (baseName || 'download') + '.' + ext;
              };
              
              const historyId = btoa(`${p.url}_${p.quality}_${p.format}_${p.extension || ''}`).replace(/=/g, '');
              const newItem: DownloadHistoryItem = {
                id: historyId,
                url: p.url,
                title: cleanTitle(cachedMeta?.title || p.title || p.filename),
                filename: p.filename,
                filepath: getCorrectFilepath(),
                type: inferFileType(p.filename),
                ext: p.extension || (p.filename.split('.').pop() || '').toUpperCase(),
                completedAt: Date.now(),
                sizeLabel: formatYtDlpSize(p.total_size || ''),
                thumbnailDataUrl: dataUrl || cachedMeta?.thumbnail || undefined,
                format: p.format,
                quality: p.quality,
                status: 'active',
              };

              // Don't add here - App.tsx handles via onDownloadComplete
              if (onDownloadComplete) {
                onDownloadComplete(newItem);
              }

              if (p.status === 'skipped') {
                showNotification('warning', t('Already downloaded!', 'Já foi baixado!'), 10000);
              }

              setCurrentProgress((curr) => {
                const next = { ...curr };
                delete next[p.id];
                // Fix 7: limpar o set para evitar memory leak de UUIDs por sessão
                processedCompletedRef.current.delete(p.id);
                return next;
              });
            }, 200);
          });
          
          // Only update progress if the ID exists in prev
          if (prevHasId) {
            return { ...prev, [p.id]: { ...updated, percent: 100 } };
          } else {
            // ID doesn't exist - just return prev (don't add to history since it's already done via async)
            return prev || {};
          }
        }

        if (p.status === 'error' || p.status === 'idle') {
          // Don't process if ID doesn't exist in prev
          if (!prev || !prev[p.id]) {
            return prev || {};
          }
          
          if (p.status === 'error') {
            const lowErr = (p.error_message || '').toLowerCase();
            if (lowErr.includes('requested format') || lowErr.includes('format is not available')) {
              playNotificationSound();
              showNotification(
                'error', 
                t('Format not available. Try another quality.', 'Formato não disponível. Tente outra qualidade.'),
                10000
              );
            } else if (lowErr.includes('403') || lowErr.includes('sign in') || lowErr.includes('bot') || lowErr.includes('blocked') || lowErr.includes('rate limit')) {
              playNotificationSound();
              showNotification(
                'error', 
                t('YouTube blocked the request. Try again later or use cookies!', 'O YouTube bloqueou a requisição. Tente novamente mais tarde ou use cookies!'),
                10000
              );
            } else {
              showNotification('error', t('Download error!', 'Erro no download!'), 5000);
            }
          }

          setTimeout(() => {
            setCurrentProgress((curr) => {
              const next = { ...curr };
              delete next[p.id];
              // Fix 7: limpar o set para evitar memory leak de UUIDs por sessão
              processedCompletedRef.current.delete(p.id);
              return next;
            });
          }, 4000);
          return { ...prev, [p.id]: updated };
        }

        return { ...prev, [p.id]: updated };
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []); // Fix 6: dependência vazia — listener registrado 1x, não re-registra ao cachear metadata

  const cacheMetadata = useCallback((url: string, title: string, thumbnail: string) => {
    // Fix 6: escrever diretamente no ref (sem setState, sem re-render, sem re-bind do listener)
    metadataTitleCacheRef.current[url] = { title, thumbnail };
    
    // Opt 10: LRU simples com limite de 100 metadados pra não estourar a memória num longo tempo de app aberto
    const keys = Object.keys(metadataTitleCacheRef.current);
    if (keys.length > 100) {
      const oldest = keys[0];
      delete metadataTitleCacheRef.current[oldest];
    }
  }, []);

  return { cacheMetadata };
}
