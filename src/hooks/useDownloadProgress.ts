import { useEffect, useState, useCallback, Dispatch, SetStateAction } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { DownloadProgress, DownloadHistoryItem } from '../types';
import { cleanTitle, formatYtDlpSize, inferFileType } from '../utils/formatters';
import { t } from '../utils/i18n';

interface UseDownloadProgressProps {
  currentProgress: Record<string, DownloadProgress>;
  setCurrentProgress: Dispatch<SetStateAction<Record<string, DownloadProgress>>>;
  downloadHistory: DownloadHistoryItem[];
  setDownloadHistory: Dispatch<SetStateAction<DownloadHistoryItem[]>>;
  saveHistoryToBackend: (items: DownloadHistoryItem[]) => Promise<void>;
  playNotificationSound: () => void;
  setNotification: Dispatch<SetStateAction<{type: 'success' | 'error' | 'warning', message: string, onClick?: () => void} | null>>;
}

export function useDownloadProgress({
  currentProgress,
  setCurrentProgress,
  downloadHistory,
  setDownloadHistory,
  saveHistoryToBackend,
  playNotificationSound,
  setNotification,
}: UseDownloadProgressProps) {
  const [metadataTitleCache, setMetadataTitleCache] = useState<Record<string, { title: string; thumbnail: string }>>({});

  useEffect(() => {
    const unlisten = listen<DownloadProgress>('download-progress', (event) => {
      const p = event.payload;
      if (!p.id) return;

      console.log("[Front] Evento recebido:", p.id, p.status, p.percent + "%");
      
      const cachedMeta = metadataTitleCache[p.url];

      setCurrentProgress((prev) => {
        const existing = prev[p.id];
        const updated: DownloadProgress = {
          ...p,
          thumbnailBase64: existing?.thumbnailBase64 || p.thumbnailBase64,
          title: cachedMeta?.title || existing?.title || p.title || p.filename,
        };

        if (p.status === 'skipped' || p.status === 'completed') {
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
              const historyId = btoa(`${p.url}_${p.quality}_${p.format}`).replace(/=/g, '');
              const newItem: DownloadHistoryItem = {
                id: historyId,
                url: p.url,
                title: cleanTitle(cachedMeta?.title || p.title || p.filename),
                filename: p.filename,
                filepath: p.output_path || '',
                type: inferFileType(p.filename),
                ext: (p.filename.split('.').pop() || '').toUpperCase(),
                completedAt: Date.now(),
                sizeLabel: formatYtDlpSize(p.total_size || ''),
                thumbnailDataUrl: dataUrl || cachedMeta?.thumbnail || undefined,
                format: p.format,
                quality: p.quality,
              };

              setDownloadHistory((h) => {
                const filtered = h.filter((item) => item.id !== newItem.id);
                const next = [newItem, ...filtered].slice(0, 100);
                saveHistoryToBackend(next);
                return next;
              });

              if (p.status === 'skipped') {
                setNotification({ type: 'warning', message: t('Already downloaded!', 'Já foi baixado!') });
                setTimeout(() => setNotification(null), 10000);
              }

              setCurrentProgress((curr) => {
                const next = { ...curr };
                delete next[p.id];
                return next;
              });
            }, 2000);
          });
          return { ...prev, [p.id]: { ...updated, percent: 100 } };
        }

        if (p.status === 'error' || p.status === 'idle') {
          if (p.status === 'error') {
            const lowErr = (p.error_message || '').toLowerCase();
            if (lowErr.includes('403') || lowErr.includes('sign in') || lowErr.includes('bot') || lowErr.includes('blocked') || lowErr.includes('rate limit')) {
              playNotificationSound();
              setNotification({
                type: 'error', 
                message: t('YouTube blocked the request. Try again later or use cookies!', 'O YouTube bloqueou a requisição. Tente novamente mais tarde ou use cookies!')
              });
              setTimeout(() => setNotification(null), 10000);
            } else {
              setNotification({ type: 'error', message: t('Download error!', 'Erro no download!') });
              setTimeout(() => setNotification(null), 5000);
            }
          }

          setTimeout(() => {
            setCurrentProgress((curr) => {
              const next = { ...curr };
              delete next[p.id];
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
  }, [metadataTitleCache]);

  useEffect(() => {
    (Object.values(currentProgress) as DownloadProgress[]).forEach((p) => {
      if (p.thumbnail_path && !p.thumbnailBase64) {
        invoke<string>('read_thumbnail_as_base64', { path: p.thumbnail_path })
          .then((dataUrl) => {
            setCurrentProgress((prev) => ({
              ...prev,
              [p.id]: { ...prev[p.id], thumbnailBase64: dataUrl }
            }));
          }).catch(() => {});
      }
    });
  }, [currentProgress]);

  const cacheMetadata = useCallback((url: string, title: string, thumbnail: string) => {
    setMetadataTitleCache((prev) => ({ ...prev, [url]: { title, thumbnail } }));
  }, []);

  return { cacheMetadata };
}
