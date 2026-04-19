import { SetStateAction, Dispatch, MutableRefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DownloadProgress, DownloadHistoryItem, Settings } from '../types';
import { safeBtoa } from '../utils/helpers';
import { t } from '../utils/i18n';

interface DownloadConfig {
  url: string;
  downloadPath: string;
  selectedQuality: string;
  selectedFormat: 'video' | 'audio';
  selectedExtension: string;
  analyzedMedia: {
    title?: string;
    qualityLabel?: string;
  } | null;
  metadataTitle: string;
  metadataThumbnail: string;
  settings: Settings;
  playlistIndex?: number;
  playlistTotal?: number;
  isPlaylist?: boolean;
}

interface DownloadHandlersProps {
  config: DownloadConfig;
  currentProgress: Record<string, DownloadProgress>;
  setCurrentProgress: Dispatch<SetStateAction<Record<string, DownloadProgress>>>;
  downloadItems: DownloadHistoryItem[];
  setDownloadItems: Dispatch<SetStateAction<DownloadHistoryItem[]>>;
  activeDownloadsRef: MutableRefObject<Set<string>>;
  onNotification: (type: 'success' | 'error' | 'warning', message: string, duration?: number, onClick?: () => void) => void;
}

export async function startDownload({
  config,
  currentProgress,
  setCurrentProgress,
  downloadItems,
  setDownloadItems,
  activeDownloadsRef,
  onNotification,
}: DownloadHandlersProps): Promise<void> {
  const { 
    url, 
    downloadPath, 
    selectedQuality, 
    selectedFormat, 
    selectedExtension, 
    analyzedMedia,
    metadataTitle,
    metadataThumbnail,
    settings 
  } = config;

  if (!url) return;

  const existingInDownloads = downloadItems.find(item => 
    item.status === 'active' && 
    item.url === url && 
    item.ext?.toUpperCase() === selectedExtension.toUpperCase()
  );
  
  if (existingInDownloads) {
    onNotification('warning', t('Already downloaded!', 'Já foi baixado!'), 10000);
    return;
  }

  const activeCount = (currentProgress ? Object.values(currentProgress) : []).filter((p: DownloadProgress) => 
    !['completed', 'error', 'skipped', 'converting'].includes(p.status)
  ).length;

  if (activeCount >= settings.maxDownloads) {
    onNotification('warning', t('Maximum simultaneous downloads reached!', 'Máximo de downloads simultâneos atingido!'), 10000);
    return;
  }

  const titleToUse = analyzedMedia?.qualityLabel?.startsWith('AUDIO') 
    ? (metadataTitle || t('Audio', 'Áudio')) 
    : (metadataTitle || t('Video', 'Vídeo'));

  const normalizedDownloadPath = downloadPath.endsWith('\\') || downloadPath.endsWith('/') 
    ? downloadPath 
    : downloadPath + '\\';
  activeDownloadsRef.current.add(normalizedDownloadPath);

  try {
    const newId = await invoke<string>('start_download', { 
      url, 
      outputDir: downloadPath, 
      quality: selectedQuality || null, 
      formatType: selectedFormat,
      title: titleToUse,
      extension: selectedExtension,
      isPlaylist: config.isPlaylist || false
    });

    const intentId = config.isPlaylist && config.playlistIndex
      ? safeBtoa(`${url}_${selectedQuality || ''}_${selectedFormat}_${selectedExtension}_${config.playlistIndex}`)
      : safeBtoa(`${url}_${selectedQuality || ''}_${selectedFormat}_${selectedExtension}`);
    
    setDownloadItems(h => {
      const next = h.filter(item => item.id !== intentId);
      return next;
    });

    setCurrentProgress(prev => ({
      ...prev,
      [newId]: {
        id: newId,
        percent: 0,
        speed: '-',
        eta: '-',
        status: 'preparing' as const,
        filename: titleToUse,
        title: titleToUse,
        output_path: '',
        total_size: '',
        thumbnail_path: '',
        raw: '',
        thumbnail: metadataThumbnail || '',
        extension: selectedExtension
      }
    }));
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    
    if (errMsg.includes('ARQUIVO_JA_EXISTE')) {
      onNotification('warning', t('Already downloaded!', 'Já foi baixado!'), 10000);
    } else if (errMsg.includes('oauth_required') || errMsg.toLowerCase().includes('login')) {
      onNotification('warning', t('OAuth login required! Check the terminal.', 'Login OAuth necessário! Verifique o terminal.'), 10000);
    } else if (errMsg.toLowerCase().includes('requested format') || errMsg.toLowerCase().includes('format is not available')) {
      onNotification('error', t('Format not available. Try another quality.', 'Formato não disponível. Tente outra qualidade.'), 10000);
    } else if (errMsg.toLowerCase().includes('youtube') || errMsg.toLowerCase().includes('bot') || errMsg.toLowerCase().includes('sign in to confirm')) {
      onNotification('error', t('YouTube is being boring, try again later!', 'YouTube está sendo chato, tente novamente mais tarde!'), 10000);
    } else if (errMsg.toLowerCase().includes('http error 403') || errMsg.toLowerCase().includes('blocked') || errMsg.toLowerCase().includes('rate limit')) {
      onNotification('error', t('Problem with request. Try again later!', 'Houve um problema na requisição. Tente novamente mais tarde!'), 10000);
    } else {
      onNotification('error', t('Error downloading. Check the link.', 'Erro no download. Verifique o link.'), 10000);
      console.error('Download error:', error);
    }
    
    if (settings.desktopNotification && !errMsg.includes('ARQUIVO_JA_EXISTE')) {
      try {
        const { sendNotification } = await import('@tauri-apps/plugin-notification');
        sendNotification({
          title: t('Error', 'Erro'),
          body: t(`Failed: ${metadataTitle || url}`, `Falha: ${metadataTitle || url}`),
        });
      } catch (err) { 
        console.error('Desktop notification failed', err); 
      }
    }
  }
}
