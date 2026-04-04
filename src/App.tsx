import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Folder,
  Download,
  Settings,
  Gauge,
  X,
  Clock,
  FolderOpen,
  Trash2,
  CheckSquare,
  Square,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import SettingsScreen from './SettingsScreen';
import { MediaInput } from './components/MediaInput';
import { ActiveDownloads } from './components/ActiveDownloads';
import { HistoryList } from './components/HistoryList';
import { RecentActivity } from './components/RecentActivity';
import { useMediaAnalyzer } from './hooks/useMediaAnalyzer';
import { useDownloadProgress } from './hooks/useDownloadProgress';
import { DownloadProgress, DownloadHistoryItem, Settings as SettingsType } from './types';
import { t } from './utils/i18n';
import { safeBtoa, normalizeFileName, normalizeFilepath } from './utils/helpers';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'search' | 'downloads' | 'settings'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [isDownloading, setIsDownloading] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  
  useEffect(() => {
    setSelectedItems([]);
  }, [showArchive]);
  
  const [url, setUrl] = useState('');
  const [currentProgress, setCurrentProgress] = useState<Record<string, DownloadProgress>>({});
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [downloadPath, setDownloadPath] = useState(() => {
    try {
      return localStorage.getItem('ud_download_path') || '';
    } catch {
      return '';
    }
  });

  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const processingDeleteRef = useRef(new Set<string>());
  const [deleteModal, setDeleteModal] = useState<{
    show: boolean;
    items: DownloadHistoryItem[];
    mode: 'trash' | 'history';
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const fromRedownloadRef = useRef(false);

  useEffect(() => {
    localStorage.setItem('ud_download_path', downloadPath);
  }, [downloadPath]);

  const [notification, setNotification] = useState<{type: 'success' | 'error' | 'warning', message: string, onClick?: () => void} | null>(null);
  const [settings, setSettings] = useState<SettingsType>(() => {
    try {
      const saved = localStorage.getItem('ud_settings');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { theme: 'dark', soundEnabled: false, desktopNotification: false, maxDownloads: 3 };
  });

  const [downloadItems, setDownloadItems] = useState<DownloadHistoryItem[]>([]);
  const downloadItemsRef = useRef<DownloadHistoryItem[]>(downloadItems);
  const activeDownloadsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    downloadItemsRef.current = downloadItems;
  }, [downloadItems]);

  const thumbnailCache = useRef<Record<string, string>>({});

  useEffect(() => {
    invoke<DownloadHistoryItem[]>('load_history')
      .then(items => {
        const savedPath = localStorage.getItem('ud_download_path');
        if (savedPath) {
          invoke('start_file_watcher', { path: savedPath })
            .catch((err) => console.error('[FileWatcher] Failed to start:', err));
          
          // NÃO roda scan para adicionar ao histórico
          // O histórico vem apenas do history.json + file watcher cuida de tempo real
          setDownloadItems(items);
        } else {
          setDownloadItems(items);
        }
      })
      .catch(err => console.error('[History] Load failed:', err));
  }, []);

  const saveHistoryToBackend = useCallback(async (items: DownloadHistoryItem[]) => {
    try { await invoke('save_history', { items }); }
    catch (err) { console.error('[History] Save failed:', err); }
  }, []);

  const saveHistoryRef = useRef(saveHistoryToBackend);
  useEffect(() => {
    saveHistoryRef.current = saveHistoryToBackend;
  }, [saveHistoryToBackend]);

  const loadThumbnail = useCallback(async (filepath: string): Promise<string | null> => {
    const cached = thumbnailCache.current[filepath];
    if (cached) return cached;
    
    try {
      const result = await invoke<string>('read_thumbnail_as_base64', { path: filepath });
      thumbnailCache.current[filepath] = result;
      return result;
    } catch {
      return null;
    }
  }, []);

  const loadThumbnailRef = useRef(loadThumbnail);
  useEffect(() => {
    loadThumbnailRef.current = loadThumbnail;
  }, [loadThumbnail]);

  useEffect(() => {
    const unlisten = listen<{ filepath: string; action: string }>('file-changed', (event) => {
      const { filepath, action } = event.payload;
       
      const normalizedPath = filepath.replace(/\//g, '\\');
      const fileDir = normalizedPath.substring(0, Math.max(normalizedPath.lastIndexOf('/'), normalizedPath.lastIndexOf('\\')) + 1);
      const normalizedFileDir = fileDir.endsWith('\\') ? fileDir : fileDir + '\\';
      
      if (action !== 'restored') {
        if (activeDownloadsRef.current.has(normalizedFileDir)) {
          return;
        }
        
        const isUnderActiveDir = [...activeDownloadsRef.current].some(activeDir => 
          normalizedFileDir.startsWith(activeDir) || normalizedFileDir.includes(activeDir.replace(/\\$/, ''))
        );
        if (isUnderActiveDir) {
          return;
        }
      }
      
      const eventFilename = normalizedPath.split(/[\\/]/).pop() || '';
      const eventFilenameBase = eventFilename.replace(/\.[^.]+$/, ''); 
      const eventExt = eventFilename.split('.').pop()?.toUpperCase() || '';

if (action === 'deleted') {
        // Debounce: prevent deduplication
        if (processingDeleteRef.current.has(filepath)) {
          return;
        }
        processingDeleteRef.current.add(filepath);
        
        // Delay to prevent race condition
        setTimeout(() => {
          processingDeleteRef.current.delete(filepath);
          
          const existingItem = downloadItems.find(item => item.filepath === normalizedPath);
          
          const urlFromMemory = existingItem?.url || '';
          const thumbnailFromMemory = existingItem?.thumbnailDataUrl;
          const sizeFromMemory = existingItem?.sizeLabel || '';
          const extFromMemory = existingItem?.ext || eventExt;
          const qualityFromMemory = existingItem?.quality || '';

          const existsInItems = downloadItems.some(item => {
            const itemFilename = item.filepath.split(/[\\/]/).pop() || '';
            const itemFilenameBase = itemFilename.replace(/\.[^.]+$/, '');
            const itemExt = item.ext?.toUpperCase() || '';
            return itemFilenameBase.toLowerCase() === eventFilenameBase.toLowerCase() && itemExt === eventExt;
          });

          if (existingItem) {

            const updatedItems = downloadItems.map(item => 
              item.filepath === normalizedPath ? { ...item, status: 'deleted' as const } : item
            );

            setDownloadItems(updatedItems);
            saveHistoryRef.current(updatedItems);
          } else if (!existsInItems && urlFromMemory) {
          const newHistoryItem: DownloadHistoryItem = {
            id: safeBtoa(normalizedPath),
            url: '',
            title: eventFilenameBase,
            filename: eventFilename,
            filepath: normalizedPath,
            type: eventExt.match(/^(MP3|M4A|OGG|FLAC|WAV)$/i) ? 'audio' : 'video',
            ext: extFromMemory,
            completedAt: Date.now(),
            sizeLabel: sizeFromMemory,
            format: eventExt.match(/^(MP3|M4A|OGG|FLAC|WAV)$/i) ? 'audio' : 'video',
            quality: qualityFromMemory,
            thumbnailDataUrl: thumbnailFromMemory || undefined,
            status: 'deleted',
          };
          
          setDownloadItems(prev => [newHistoryItem, ...prev]);
            saveHistoryRef.current([newHistoryItem, ...downloadItems]);
          }
        });
      } else if (action === 'restored') {
        const normalizedPath = normalizeFilepath(filepath);
        
        const existingItem = downloadItems.find(item => 
          normalizeFilepath(item.filepath || '') === normalizedPath
        );
        
        if (existingItem) {
          setDownloadItems(prev => {
            const updated = prev.map(item => {
              if (normalizeFilepath(item.filepath || '') === normalizedPath) {
                return { ...item, status: 'active' as const };
              }
              return item;
            });
            saveHistoryRef.current(updated);
            return updated;
          });
        } else {
          // SKIP temp files - se não tem URL, é arquivo temporário (.webm de conversão)
          // Arquivos reais SEMPRE têm URL do YouTube/etc
          // Isso evita .webm temporários no histórico
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [downloadItems]);

  useEffect(() => {
    if ((currentScreen === 'search' || currentScreen === 'downloads') && downloadItems.length > 0) {
      const items = downloadItems;
      const paths = items.map(item => item.filepath || '');
      invoke<(string | null)[]>('resolve_paths', { paths })
        .then((resolvedArray) => {
          let hasChanges = false;
          const updatedHistory = items.map((item, index) => {
            const resolvedPath = resolvedArray[index];
            const exists = !!resolvedPath;
            const isDeleted = !exists && !!item.filepath && item.status === 'deleted';
            
            let newItem = { ...item };
            
            if (resolvedPath && resolvedPath !== item.filepath) {
              newItem.filepath = resolvedPath;
              hasChanges = true;
            }

            if (exists && item.status === 'deleted') {
              newItem.status = 'active';
              hasChanges = true;
            }
            return newItem;
          });
          if (hasChanges) {
            setDownloadItems(updatedHistory);
            saveHistoryToBackend(updatedHistory);
          }
        })
        .catch(() => {});
    }
  }, [currentScreen, downloadItems.length, saveHistoryToBackend]);

  useEffect(() => {
    if (currentScreen === 'downloads') {
      const loadMissingThumbnails = async () => {
        const itemsToLoad = downloadItems.slice(0, 10);
        
        const loadPromises = itemsToLoad
          .filter(item => !item.thumbnailDataUrl && item.filepath)
          .map(async (item) => {
            const filepathWithoutExt = item.filepath.replace(/\.[^.]+$/, '');
            const thumb = await loadThumbnail(filepathWithoutExt + '.jpg');
            return thumb ? { id: item.id, thumb } : null;
          });
        
        const results = await Promise.all(loadPromises);
        
        results.filter(Boolean).forEach(result => {
          if (result) {
            setDownloadItems(prev => prev.map(h => 
              h.id === result!.id ? { ...h, thumbnailDataUrl: result!.thumb } : h
            ));
          }
        });
      };
      
      loadMissingThumbnails();
    }
  }, [currentScreen, downloadItems]);

  const [isPaused, setIsPaused] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  
  const [availableQualities, setAvailableQualities] = useState<string[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<string>('');
  const [isQualityDropdownOpen, setIsQualityDropdownOpen] = useState(false);
  
  const [selectedFormat, setSelectedFormat] = useState<'video' | 'audio'>('video');
  const [selectedExtension, setSelectedExtension] = useState<string>('MP4');
  const [isExtensionDropdownOpen, setIsExtensionDropdownOpen] = useState(false);
  const [isFormatDropdownOpen, setIsFormatDropdownOpen] = useState(false);
  
  const { analyzedMedia, isAnalyzing, videoQualities, mediaCapabilities } = useMediaAnalyzer(url);

  const metadataTitleRef = useRef<string>('');
  const metadataThumbnailRef = useRef<string>('');

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
    localStorage.setItem('ud_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (analyzedMedia) {
      metadataTitleRef.current = analyzedMedia.title;
      metadataThumbnailRef.current = analyzedMedia.thumbnail;
    }
  }, [analyzedMedia]);

  useEffect(() => {
    if (selectedFormat === 'audio') {
      setAvailableQualities(['AUDIO ONLY']);
      setSelectedQuality('AUDIO ONLY');
      setSelectedExtension('MP3');
    } else {
      if (fromRedownloadRef.current && selectedQuality) {
        fromRedownloadRef.current = false;
      } else {
        if (videoQualities.length > 0) {
          setAvailableQualities(videoQualities);
          setSelectedQuality(videoQualities[0]);
        } else {
          setAvailableQualities(['BEST QUALITY']);
          setSelectedQuality('BEST QUALITY');
        }
        setSelectedExtension('MP4');
      }
    }
  }, [selectedFormat, videoQualities]);

  const playNotificationSound = () => {
    if (settingsRef.current.soundEnabled) {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.5);
        osc.stop(ctx.currentTime + 0.5);
      } catch (err) {
        console.error("Audio playback failed", err);
      }
    }
  };

  const activeList = useMemo(() => 
    (currentProgress ? Object.values(currentProgress) as DownloadProgress[] : []).filter((p) => 
      ['downloading', 'preparing', 'paused', 'converting'].includes(p.status)
    ), [currentProgress]);
  
  const totalSpeedMiB = useMemo(() => {
    return activeList.reduce((acc, p) => {
      if (!p.speed || p.speed === '-') return acc;
      const match = p.speed.match(/^([\d.]+)\s*([a-zA-Z/]+)/);
      if (!match) return acc;
      const val = parseFloat(match[1]);
      const unit = match[2].toUpperCase();
      if (unit.includes('G')) return acc + val * 1024;
      if (unit.includes('M')) return acc + val;
      if (unit.includes('K')) return acc + val / 1024;
      return acc + val / 1048576;
    }, 0);
  }, [activeList]);

  const speedValue = totalSpeedMiB >= 100 ? totalSpeedMiB.toFixed(0) : totalSpeedMiB.toFixed(1);
  const speedUnit = 'MB/s';

  useDownloadProgress({
    currentProgress,
    setCurrentProgress,
    downloadItems,
    setDownloadItems,
    saveHistoryToBackend,
    onDownloadComplete: async (newItem) => {
      const ext = newItem.ext?.toLowerCase() || '';
      if (ext === 'jpg') {
        return;
      }
      if (ext === 'webp') {
        return;
      }

      let realSizeLabel = newItem.sizeLabel;
      
      const normalizedPath = newItem.filepath.replace(/\//g, '\\');
      
      // Função para normalizar nome para fuzzy match
      const normalizeForMatch = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      // Tenta path normalizado primeiro
      let foundPath: string | null = null;
      try {
        const fileSize = await invoke<number>('get_file_size', { path: normalizedPath });
        foundPath = normalizedPath;
        const mb = fileSize / (1024 * 1024);
        if (mb >= 1024) {
          realSizeLabel = `${(mb / 1024).toFixed(2)} GB`;
        } else if (mb >= 0.1) {
          realSizeLabel = `${mb.toFixed(2)} MB`;
        } else {
          realSizeLabel = `${(mb * 1024).toFixed(0)} KB`;
        }
      } catch {
        // Fuzzy match
        const dir = newItem.filepath.replace(/[\\/][^\\/]+$/, '').replace(/\//g, '\\');
        const baseName = normalizeForMatch(newItem.filename.replace(/\.[^.]+$/, ''));
        
        try {
          const files = await invoke<string[]>('list_files_in_folder', { folderPath: dir });
          if (files && files.length > 0) {
            const extRequested = newItem.ext?.toLowerCase() || '';
            
            for (const file of files) {
              const fileExt = file.split('.').pop()?.toLowerCase() || '';
              const fileMatch = normalizeForMatch(file.replace(/\.[^.]+$/, ''));
              
              if (fileExt === extRequested && (fileMatch.includes(baseName) || baseName.includes(fileMatch))) {
                const fullPath = dir + '\\' + file;
                try {
                  const fileSize = await invoke<number>('get_file_size', { path: fullPath });
                  foundPath = fullPath;
                  const mb = fileSize / (1024 * 1024);
                  if (mb >= 1024) {
                    realSizeLabel = `${(mb / 1024).toFixed(2)} GB`;
                  } else if (mb >= 0.1) {
                    realSizeLabel = `${mb.toFixed(2)} MB`;
                  } else {
                    realSizeLabel = `${(mb * 1024).toFixed(0)} KB`;
                  }
                  break;
                } catch {
                  continue;
                }
              }
            }
          }
        } catch {}
      }

      const newFilePathNormalized = normalizeFilepath(foundPath || newItem.filepath || '');
      const itemWithStatus = { ...newItem, sizeLabel: realSizeLabel, status: 'active' as const, filepath: foundPath || newItem.filepath };
      
      setDownloadItems(prev => {
        const existingIndex = prev.findIndex(i => 
          normalizeFilepath(i.filepath || '') === newFilePathNormalized
        );
        
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            ...itemWithStatus,
            thumbnailDataUrl: newItem.thumbnailDataUrl || updated[existingIndex].thumbnailDataUrl,
            sizeLabel: itemWithStatus.sizeLabel || updated[existingIndex].sizeLabel,
            url: newItem.url || updated[existingIndex].url,
            format: newItem.format || updated[existingIndex].format,
            quality: newItem.quality || updated[existingIndex].quality,
          };
          return updated;
        }
        
        const newList = [itemWithStatus, ...prev];
        // Deduplicate by filepath before saving
        const seen = new Set<string>();
        const deduped = newList.filter(item => {
          const key = item.filepath?.toLowerCase() || item.id;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        saveHistoryRef.current(deduped);
        return deduped;
      });

      if (newItem.filepath) {
        const normalizedPath = newItem.filepath.replace(/\//g, '\\');
        const fileDir = normalizedPath.substring(0, Math.max(normalizedPath.lastIndexOf('/'), normalizedPath.lastIndexOf('\\')) + 1);
        const normalizedFileDir = fileDir.endsWith('\\') ? fileDir : fileDir + '\\';
        activeDownloadsRef.current.delete(normalizedFileDir);
      }
    },
    playNotificationSound,
    setNotification,
  });

  const handleCancelDownload = async (id: string) => {
    try {
      await invoke('cancel_download', { id });
      setCurrentProgress(curr => {
        const next = { ...curr };
        delete next[id];
        return next;
      });
      if (downloadPath) {
        const dir = downloadPath + (downloadPath.endsWith('\\') || downloadPath.endsWith('/') ? '' : '\\');
        activeDownloadsRef.current.delete(dir);
      }
    } catch (error) { console.error('Cancel error:', error); }
  };

  const handleOpenFolder = async (path: string) => {
    try { 
      await invoke('open_folder_natively', { path }); 
    } catch (error) { 
      console.error('Erro ao abrir pasta:', error); 
    }
  };

  const handleRedownload = (item: DownloadHistoryItem) => {
    fromRedownloadRef.current = true;
    setUrl(item.url);
    setSelectedFormat(item.format as 'video' | 'audio');
    setSelectedQuality(item.quality);
    setSelectedExtension(item.ext || 'MP4');
    setCurrentScreen('search');
    setNotification({ type: 'success', message: t('Download settings restored!', 'Configurações restauradas!') });
    setTimeout(() => setNotification(null), 10000);
  };

  const handleMoveToTrash = useCallback(async (items: DownloadHistoryItem[]) => {
    setIsDeleting(true);
    
    try {
      const paths = items.map(item => item.filepath);
      await invoke('move_multiple_to_trash', { paths });
    } catch (err) {
      console.error('Error moving to trash:', err);
    }
    
    setIsDeleting(false);
    
    setDownloadItems(prev => {
      const newItems = prev.map(item => {
        if (items.some(i => i.id === item.id)) {
          return { ...item, status: 'deleted' as const };
        }
        return item;
      });
      saveHistoryRef.current(newItems);
      return newItems;
    });
    
    setNotification({ type: 'success', message: t(`${items.length} item(s) moved to trash`, `${items.length} item(s) movido(s) para a lixeira`) });
    setTimeout(() => setNotification(null), 5000);
  }, [setNotification]);

  const handleDeleteFromHistory = useCallback((items: DownloadHistoryItem[]) => {
    const newHistory = downloadItems.filter(h => !items.some(i => i.id === h.id));
    setDownloadItems(newHistory);
    saveHistoryToBackend(newHistory);
    setNotification({ type: 'success', message: t(`${items.length} item(s) removed from history`, `${items.length} item(s) removido(s) do histórico`) });
    setTimeout(() => setNotification(null), 5000);
  }, [downloadItems, saveHistoryToBackend, setNotification]);

  const handleDownloadClick = async () => {
    if (!url) return;
    
    // Check if file already exists in download folder (only active items)
    const existingInDownloads = downloadItems.find(item => 
      item.status === 'active' && 
      item.url === url && 
      item.ext?.toUpperCase() === selectedExtension.toUpperCase()
    );
    
    if (existingInDownloads) {
      setNotification({ 
        type: 'warning', 
        message: t('Already downloaded!', 'Já foi baixado!')
      });
      setTimeout(() => setNotification(null), 10000);
      return;
    }

    const activeCount = (currentProgress ? Object.values(currentProgress) : []).filter((p: DownloadProgress) => !['completed', 'error', 'skipped', 'converting'].includes(p.status)).length;

    if (activeCount >= settings.maxDownloads) {
      setNotification({
        type: 'warning', 
        message: t('Maximum simultaneous downloads reached!', 'Máximo de downloads simultâneos atingido!'),
        onClick: () => setCurrentScreen('settings')
      });
      setTimeout(() => setNotification(null), 10000);
      return;
    }

    try {
      const effectiveDir = downloadPath || '';
      
      const titleToUse = analyzedMedia?.qualityLabel.startsWith('AUDIO') 
        ? (metadataTitleRef.current || t('Audio', 'Áudio')) 
        : (metadataTitleRef.current || t('Video', 'Vídeo'));

      const normalizedDownloadPath = downloadPath.endsWith('\\') || downloadPath.endsWith('/') 
        ? downloadPath 
        : downloadPath + '\\';
      activeDownloadsRef.current.add(normalizedDownloadPath);

      const newId = await invoke<string>('start_download', { 
        url, 
        outputDir: downloadPath, 
        quality: selectedQuality || null, 
        formatType: selectedFormat,
        title: titleToUse,
        extension: selectedExtension
      });

      const intentId = safeBtoa(`${url}_${selectedQuality || ''}_${selectedFormat}_${selectedExtension}`);
      
      setDownloadItems(h => {
        const next = h.filter(item => item.id !== intentId);
        if (next.length !== h.length) saveHistoryToBackend(next);
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
          thumbnail: metadataThumbnailRef.current || '',
          extension: selectedExtension
        }
      }));
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('ARQUIVO_JA_EXISTE')) {
        playNotificationSound();
        setNotification({type: 'warning', message: t('Already downloaded!', 'Já foi baixado!')});
        setTimeout(() => setNotification(null), 10000);
      } else if (errMsg.includes('oauth_required') || errMsg.toLowerCase().includes('login')) {
        setNotification({type: 'warning', message: t('OAuth login required! Check the terminal.', 'Login OAuth necessário! Verifique o terminal.')});
        setTimeout(() => setNotification(null), 10000);
      } else if (errMsg.toLowerCase().includes('http error 403') || errMsg.toLowerCase().includes('sign in to confirm') || errMsg.toLowerCase().includes('bot') || errMsg.toLowerCase().includes('blocked') || errMsg.toLowerCase().includes('rate limit')) {
        setNotification({type: 'error', message: t('Problem with request. Try again later!', 'Houve um problema na requisição. Tente novamente mais tarde!')});
        setTimeout(() => setNotification(null), 10000);
      } else {
        setNotification({type: 'error', message: t('Error downloading. Check the link.', 'Erro no download. Verifique o link.')});
        setTimeout(() => setNotification(null), 10000);
        console.error('Download error:', error);
      }
      
      if (settingsRef.current.desktopNotification && !errMsg.includes('ARQUIVO_JA_EXISTE')) {
        try {
          import('@tauri-apps/plugin-notification').then(({ sendNotification }) => {
            sendNotification({
              title: t('Error', 'Erro'),
              body: t(`Failed: ${metadataTitleRef.current || url}`, `Falha: ${metadataTitleRef.current || url}`),
            });
          }).catch(console.error);
        } catch (err) { console.error('Desktop notification failed', err); }
      }
    }
  };
  
  return (
    <div className={`flex h-screen bg-[#0a0a0a] text-white font-sans selection:bg-white/20 transition-all ${settings.theme === 'light' ? 'light-theme' : ''}`}>
      <aside className="w-64 bg-[#111111] border-r border-white/5 flex flex-col justify-between shrink-0">
        <div>
          <div className="p-8 flex items-center gap-3">
            <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
               <Download className="w-4 h-4 text-[#111111]" strokeWidth={3} />
            </div>
            <span className="font-bold tracking-widest text-lg">PASTEPULL</span>
          </div>

          <nav className="px-4 space-y-1">
            <button onClick={() => setCurrentScreen('search')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${currentScreen === 'search' ? 'bg-[#1e1e1e] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}><Download className="w-4 h-4" />{t('SEARCH', 'BUSCA')}</button>
            <button onClick={() => setCurrentScreen('downloads')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${currentScreen === 'downloads' ? 'bg-[#1e1e1e] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}><Folder className="w-4 h-4" />{t('DOWNLOADS', 'DOWNLOADS')}</button>
            <button onClick={() => setCurrentScreen('settings')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${currentScreen === 'settings' ? 'bg-[#1e1e1e] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}><Settings className="w-4 h-4" />{t('SETTINGS', 'CONFIGURAÇÕES')}</button>
          </nav>
        </div>

        <div className="p-4">
          <div className="bg-[#171717] rounded-xl p-4 border border-white/5">
            <div className="flex items-center gap-2 text-white/50 mb-2">
              <Gauge className="w-4 h-4" />
              <span className="text-[10px] font-bold tracking-widest">{t('GLOBAL SPEED', 'VELOCIDADE GLOBAL')}</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold">{speedValue}</span>
              <span className="text-xs text-white/50 font-medium">{speedUnit}</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between p-8">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold capitalize">
              {currentScreen === 'search' ? t('Search', 'Busca') : 
               currentScreen === 'downloads' ? t('Downloads', 'Downloads') : 
               t('Settings', 'Configurações')}
            </h1>
          </div>
        </header>

        <AnimatePresence>
          {notification && (
            <motion.div 
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className={`fixed top-6 right-6 px-6 py-4 rounded-xl shadow-2xl z-50 border backdrop-blur-md flex items-center gap-4 min-w-[320px] max-w-md ${notification.onClick ? 'cursor-pointer hover:brightness-110' : ''} ${notification.type === 'warning' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' : notification.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}
              onClick={notification.onClick}
            >
              <div className="flex-1 font-medium text-sm">{notification.message}</div>
              <button onClick={() => setNotification(null)} className="opacity-60 hover:opacity-100 transition-opacity p-1.5 hover:bg-white/10 rounded-md shrink-0"><X size={16} /></button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {cancelingId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} className="bg-[#1a1a1a] border border-white/10 p-6 rounded-2xl shadow-2xl max-w-sm w-full">
                <div className="flex items-center gap-3 text-red-400 mb-4">
                  <div className="w-10 h-10 rounded-full bg-red-400/10 flex items-center justify-center"><X size={20} /></div>
                  <h3 className="text-lg font-bold text-white">{t('Cancel Download?', 'Cancelar Download?')}</h3>
                </div>
                <p className="text-white/60 text-sm mb-6">{t('Are you sure you want to cancel the download? Current progress will be lost.', 'Tem certeza que deseja cancelar o download? O progresso atual será perdido.')}</p>
                <div className="flex gap-3 justify-end">
                   <button onClick={() => setCancelingId(null)} className="px-4 py-2 rounded-lg text-sm font-semibold text-white/70 hover:text-white hover:bg-white/5 transition-colors">{t('Go Back', 'Voltar')}</button>
                   <button 
                    onClick={async () => {
                      if (!cancelingId) return;
                      const tid = cancelingId;
                      setCancelingId(null);
                      await handleCancelDownload(tid);
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-500 hover:bg-red-600 text-white transition-colors"
                  >{t('Yes, Cancel', 'Sim, Cancelar')}</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {deleteModal?.show && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} className="bg-[#1a1a1a] border border-white/10 p-6 rounded-2xl shadow-2xl max-w-sm w-full">
                <div className="flex items-center gap-3 text-red-400 mb-4">
                  <div className="w-10 h-10 rounded-full bg-red-400/10 flex items-center justify-center"><Trash2 size={20} /></div>
                  <h3 className="text-lg font-bold text-white">
                    {deleteModal.mode === 'trash' 
                      ? t('Move to trash?', 'Mover para lixeira?') 
                      : t('Remove from history?', 'Remover do histórico?')}
                  </h3>
                </div>
                <p className="text-white/60 text-sm mb-6">
                  {deleteModal.mode === 'trash'
                    ? t(`Are you sure you want to move ${deleteModal.items.length} item(s) to trash?`, `Tem certeza que deseja mover ${deleteModal.items.length} item(s) para a lixeira?`)
                    : t(`Are you sure you want to remove ${deleteModal.items.length} item(s) from history?`, `Tem certeza que deseja remover ${deleteModal.items.length} item(s) do histórico?`)}
                </p>
                <div className="flex gap-3 justify-end">
                  <button 
                    onClick={() => setDeleteModal(null)} 
                    disabled={isDeleting}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-white/70 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                  >
                    {t('Cancel', 'Cancelar')}
                  </button>
                  <button 
                    onClick={() => {
                      const items = deleteModal.items;
                      const mode = deleteModal.mode;
                      
                      if (mode === 'trash') {
                        handleMoveToTrash(items).then(() => {
                          setDeleteModal(null);
                          setSelectedItems([]);
                        });
                      } else {
                        const newItems = downloadItems.filter(h => !items.some(i => i.id === h.id));
                        setDownloadItems(newItems);
                        saveHistoryRef.current(newItems);
                        setDeleteModal(null);
                        setSelectedItems([]);
                      }
                    }}
                    disabled={isDeleting}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-500 hover:bg-red-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isDeleting ? (
                      <>
                        <span className="animate-spin">⟳</span>
                        {t('DELETANDO...', 'DELETANDO...')}
                      </>
                    ) : (
                      deleteModal.mode === 'trash' ? t('Move to trash', 'Mover para lixeira') : t('Remove', 'Remover')
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto p-8 pt-12">
          <div className="max-w-3xl mx-auto space-y-12">
            
            {currentScreen === 'search' && (
              <>
                <div className="text-center space-y-4">
                  <h2 className="text-4xl font-bold tracking-tight">PastePull</h2>
                  <p className="text-white/50 text-lg">{t('Enter a URL and download it :)', 'Insira um URL e baixe :)')}</p>
                </div>

                <MediaInput
                  url={url}
                  setUrl={setUrl}
                  analyzedMedia={analyzedMedia}
                  isAnalyzing={isAnalyzing}
                  selectedFormat={selectedFormat}
                  setSelectedFormat={setSelectedFormat}
                  selectedQuality={selectedQuality}
                  setSelectedQuality={setSelectedQuality}
                  availableQualities={availableQualities}
                  isQualityDropdownOpen={isQualityDropdownOpen}
                  setIsQualityDropdownOpen={setIsQualityDropdownOpen}
                  mediaCapabilities={mediaCapabilities}
                  currentProgress={currentProgress}
                  isDownloading={isDownloading}
                  selectedExtension={selectedExtension}
                  setSelectedExtension={setSelectedExtension}
                  isExtensionDropdownOpen={isExtensionDropdownOpen}
                  setIsExtensionDropdownOpen={setIsExtensionDropdownOpen}
                  isFormatDropdownOpen={isFormatDropdownOpen}
                  setIsFormatDropdownOpen={setIsFormatDropdownOpen}
                />

                <button 
                  onClick={handleDownloadClick} 
                  disabled={!url || !analyzedMedia || isAnalyzing}
                  className="w-full bg-[#2a2a2a] hover:bg-[#333] disabled:opacity-50 text-white rounded-xl px-6 py-4 font-bold tracking-wider text-sm transition-colors"
                >
                  {isAnalyzing ? t('LOADING...', 'CARREGANDO...') : t('DOWNLOAD', 'DOWNLOAD')}
                </button>

                <ActiveDownloads
                  currentProgress={currentProgress}
                  onCancel={(id) => setCancelingId(id)}
                />

                <RecentActivity
                  items={downloadItems}
                  onItemClick={() => {}}
                  onRedownload={handleRedownload}
                  onOpenFolder={handleOpenFolder}
                  downloadPath={downloadPath}
                  onViewAll={() => setCurrentScreen('downloads')}
                />
              </>
            )}

            {currentScreen === 'downloads' && (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 border-b border-white/5 pb-6">
                  <div className="flex items-center justify-end">
                    <div className="flex items-center gap-3">
                      {(downloadItems.length > 0 || downloadItems.length > 0) && (
                        <div className="flex items-center bg-white/5 p-1 rounded-xl border border-white/5">
                          <button 
                            onClick={() => setShowArchive(false)} 
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all text-[10px] font-bold uppercase tracking-wider ${!showArchive ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
                          >
                            <Folder size={14} />
                            {t('DOWNLOADS', 'DOWNLOADS')}
                          </button>
                          <button 
                            onClick={() => setShowArchive(true)} 
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all text-[10px] font-bold uppercase tracking-wider ${showArchive ? 'bg-yellow-400/10 text-yellow-500' : 'text-white/40 hover:text-white/60'}`}
                          >
                            <Clock size={14} />
                            {t('HISTORY', 'HISTÓRICO')}
                          </button>
                        </div>
                      )}
                      {(downloadItems.length > 0 || downloadItems.length > 0) && (
                        <button onClick={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : 'newest')} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white/70 px-3 py-1.5 rounded-lg transition-colors text-xs font-semibold uppercase tracking-widest cursor-pointer">
                          <Clock size={14} className={`transition-transform duration-300 ${sortOrder === 'oldest' ? 'rotate-180' : ''}`} />
                          {sortOrder === 'newest' ? t('Newest', 'Mais Novos') : t('Oldest', 'Mais Antigos')}
                        </button>
                      )}
                      {(downloadItems.length > 0 || downloadItems.length > 0) && (
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              if (selectedItems.length > 0) {
                                setSelectedItems([]);
                              } else {
                                const currentItems = showArchive 
                                  ? downloadItems.filter(i => i.status === 'deleted')
                                  : downloadItems.filter(i => i.status === 'active');
                                setSelectedItems(currentItems.map(i => i.id));
                              }
                            }}
                            className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white/70 px-3 py-1.5 rounded-lg transition-colors text-xs font-semibold uppercase tracking-widest cursor-pointer"
                          >
                            {selectedItems.length > 0 ? <CheckSquare size={14} /> : <Square size={14} />}
                            <Trash2 size={14} />
                          </button>
                          <span className="bg-white/10 text-white/70 text-xs font-bold px-3 py-1 rounded-full">
                            {showArchive 
                              ? downloadItems.filter(i => i.status === 'deleted').length
                              : downloadItems.filter(i => i.status === 'active').length
                            } {t('file', 'arquivo')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  {(downloadItems.length > 0) && (
                    <div className="relative">
                      <input type="text" placeholder={t('Search downloads...', 'Procurar downloads...')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-[#1a1a1a] border border-white/5 rounded-xl pl-12 pr-6 py-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-all" />
                    </div>
                  )}
                </div>
                  {selectedItems.length > 0 && (
                    <div className="flex items-center justify-between bg-[#1a1a1a] border border-white/10 p-4 rounded-xl">
                      <span className="text-sm font-semibold text-white">{selectedItems.length} {t('selected', 'selecionado(s)')}</span>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => setSelectedItems([])}
                        className="px-4 py-2 rounded-lg text-sm font-semibold text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                      >
                        {t('Cancel', 'Cancelar')}
                      </button>
                      <button 
                        onClick={() => {
                          const currentItems = showArchive 
                            ? downloadItems.filter(i => i.status === 'deleted')
                            : downloadItems.filter(i => i.status === 'active');
                          const itemsToDelete = currentItems.filter(i => selectedItems.includes(i.id));
                          setDeleteModal({ show: true, items: itemsToDelete, mode: showArchive ? 'history' : 'trash' });
                        }}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-red-500 hover:bg-red-600 text-white transition-colors"
                      >
                        <Trash2 size={16} />
                        {showArchive ? t('Remove from history', 'Remover do histórico') : t('Move to trash', 'Mover para lixeira')}
                      </button>
                    </div>
                  </div>
                )}
                <HistoryList
                  items={showArchive 
                    ? downloadItems.filter(i => i.status === 'deleted')
                    : downloadItems.filter(i => i.status === 'active')
                  }
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  showArchive={showArchive}
                  sortOrder={sortOrder}
                  onItemClick={() => {}}
                  onRedownload={handleRedownload}
                  onOpenFolder={handleOpenFolder}
                  downloadPath={downloadPath}
                  selectedItems={selectedItems}
                  setSelectedItems={setSelectedItems}
                  onDelete={(item) => setDeleteModal({ show: true, items: [item], mode: item.status === 'deleted' ? 'history' : 'trash' })}
                />
              </div>
            )}

            {currentScreen === 'settings' && (
              <SettingsScreen 
                downloadPath={downloadPath} 
                onDownloadPathChange={setDownloadPath} 
                settings={settings} 
                setSettings={setSettings} 
              />
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
