import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Folder,
  Download,
  Settings,
  Gauge,
  ChevronDown,
  Pause,
  X,
  Film,
  Music,
  Play,
  Search,
  Clock,
  FileDown,
  FolderOpen,
  HardDrive
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import SettingsScreen from './SettingsScreen';

interface DownloadProgress {
  id: string;
  percent: number;
  speed: string;
  eta: string;
  status: 'downloading' | 'paused' | 'completed' | 'error' | 'idle' | 'preparing' | 'oauth_required' | 'skipped';
  filename: string;
  output_path: string;
  total_size: string;
  thumbnail_path: string;
  raw?: string;
  title?: string;
  thumbnail?: string;
  thumbnailBase64?: string;
  error_message?: string;
}

export interface DownloadHistoryItem {
  id: string;
  title: string;
  filename: string;
  filepath: string;
  type: 'video' | 'audio' | 'image' | 'other';
  ext?: string;
  completedAt: number;
  sizeLabel: string;
  thumbnailDataUrl?: string; // stored base64 image data
}

function inferFileType(filename: string): 'video' | 'audio' | 'other' {
  const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.m4v'];
  const audioExts = ['.mp3', '.flac', '.aac', '.wav', '.ogg', '.m4a', '.opus'];
  const lower = filename.toLowerCase();
  if (videoExts.some((ext) => lower.endsWith(ext))) return 'video';
  if (audioExts.some((ext) => lower.endsWith(ext))) return 'audio';
  return 'other';
}

const isEnglish = navigator.language.toLowerCase().startsWith('en');
function t(en: string, pt: string) {
  return isEnglish ? en : pt;
}

function formatRelativeTime(timestamp: number): string {
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

function formatYtDlpSize(sizeStr: string): string {
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
/** 
 * Cleans up yt-dlp filenames by stripping format identifiers, mangled URLs
 * and leftover ID hashes. Keeps the meaningful title + original extension.
 * Example:
 *   "Big Buck Bunny [abc123].mp4" → "Big Buck Bunny"
 */
function cleanTitle(filename: string): string {
  let cleanStr = filename.replace(/\.[a-zA-Z0-9]{2,5}$/i, '');
  cleanStr = cleanStr.replace(/[.\s-]+(?:fhls|dash|hls|avc|aac|opus|av1|vp9|f\d{3})[-.]?[\w.-]*$/i, '');
  cleanStr = cleanStr.replace(/\s+-\s+https?:\/\/[^\s]+|https?:\/\/[^\s]+/i, '');
  cleanStr = cleanStr.replace(/\s+-\s+\S*[a-z]{2,}\.[a-z]{2,}\S*/i, '');
  cleanStr = cleanStr.replace(/\s+\[[a-zA-Z0-9_-]{6,}\]$/, '');
  cleanStr = cleanStr.replace(/\s+-\s+[a-zA-Z0-9_-]{8,}$/, '');

  const result = cleanStr.trim();
  return result.length > 0 ? result : t('Unknown Title', 'Título Desconhecido');
}



export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'search' | 'downloads' | 'settings'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [isDownloading, setIsDownloading] = useState(false);
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

  useEffect(() => {
    localStorage.setItem('ud_download_path', downloadPath);
  }, [downloadPath]);

  const [notification, setNotification] = useState<{type: 'success' | 'error' | 'warning', message: string, onClick?: () => void} | null>(null);
  const [settings, setSettings] = useState<{ theme: 'dark' | 'light', soundEnabled: boolean, desktopNotification: boolean, maxDownloads: number }>(() => {
    try {
      const saved = localStorage.getItem('ud_settings');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { theme: 'dark', soundEnabled: false, desktopNotification: false, maxDownloads: 3 };
  });

  const [downloadHistory, setDownloadHistory] = useState<DownloadHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('ud_download_history');
      if (!saved) return [];
      const parsed: DownloadHistoryItem[] = JSON.parse(saved);
      // Filter out old items that stored a local file path instead of a base64 data URL or HTTP link
      const clean = parsed.map(item => ({
        ...item,
        thumbnailDataUrl: (item.thumbnailDataUrl?.startsWith('data:') || item.thumbnailDataUrl?.startsWith('http')) ? item.thumbnailDataUrl : undefined,
      }));
      // Persist the cleaned version back
      localStorage.setItem('ud_download_history', JSON.stringify(clean));
      return clean;
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (currentScreen === 'downloads' && downloadHistory.length > 0) {
      const paths = downloadHistory.map(item => item.filepath || '');
      invoke<boolean[]>('check_files_exist', { paths })
        .then((existsArray) => {
          let hasChanges = false;
          const validItems = downloadHistory.filter((item, index) => {
            // Keep the item if it doesn't have a specific filepath, 
            // if the filepath suffers from Windows stdout encoding loss (), 
            // or if it successfully passes the Rust disk check.
            const stillValid = !item.filepath || item.filepath.includes('') || existsArray[index];
            if (!stillValid) hasChanges = true;
            return stillValid;
          });
          if (hasChanges) {
            setDownloadHistory(validItems);
            localStorage.setItem('ud_download_history', JSON.stringify(validItems));
            console.log('[Sync] Removed deleted files from history.');
          }
        })
        .catch(err => console.error('[Sync] Failed to verify files:', err));
    }
  }, [currentScreen]);

  const [isPaused, setIsPaused] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  
  const [availableQualities, setAvailableQualities] = useState<string[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<string>('');
  const [isQualityDropdownOpen, setIsQualityDropdownOpen] = useState(false);
  
  const [videoQualities, setVideoQualities] = useState<string[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<'video' | 'audio'>('video');
  const [mediaCapabilities, setMediaCapabilities] = useState({ video: true, audio: true });
  
  const [analyzedMedia, setAnalyzedMedia] = useState<{ qualityLabel: string, type: 'video' | 'audio' } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Automatically update quality dropdown options when the format changes
  useEffect(() => {
    if (selectedFormat === 'audio') {
      setAvailableQualities(['AUDIO ONLY']);
      setSelectedQuality('AUDIO ONLY');
    } else {
      setAvailableQualities(videoQualities.length > 0 ? videoQualities : ['BEST QUALITY']);
      setSelectedQuality(videoQualities.length > 0 ? videoQualities[0] : 'BEST QUALITY');
    }
  }, [selectedFormat, videoQualities]);

  // Ref to metadata title and thumbnail — avoids stale closure in the download-progress event listener
  const metadataTitleRef = useRef<string>('');
  const metadataThumbnailRef = useRef<string>('');
  
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
    localStorage.setItem('ud_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (!url.startsWith('http')) {
      setAnalyzedMedia(null);
      setIsAnalyzing(false);
      return;
    }
    const timeout = setTimeout(async () => {
      setIsAnalyzing(true);
      setMediaCapabilities({ video: true, audio: true }); // temporary while loading
      
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
        const heights = Array.from(hSet).sort((a,b) => b-a);
        const vOptions: string[] = [];
        heights.forEach(h => vOptions.push(`${h}P VIDEO`));
        if (vOptions.length === 0 && meta.vcodec === 'none') {
           // É apenas áudio naturalmente
        } else if (vOptions.length === 0) {
           vOptions.push('BEST QUALITY');
        }
        
        setVideoQualities(vOptions);
        
        let type: 'video' | 'audio' = vOptions.length === 0 ? 'audio' : 'video';
        
        setAnalyzedMedia({ qualityLabel: vOptions.length > 0 ? vOptions[0] : 'AUDIO ONLY', type });
        setMediaCapabilities({ video: vOptions.length > 0, audio: true }); 
        
        // Se a url for focada em audio puramente, setar como audio automatically
        if (vOptions.length === 0) {
            setSelectedFormat('audio');
        }
      } catch (err) {
        console.error('Análise do link falhou:', err);
        setAnalyzedMedia(null);
        setMediaCapabilities({ video: true, audio: true }); // Fallback para deixar tentar
        setVideoQualities(['BEST QUALITY']);
      } finally {
        setIsAnalyzing(false);
      }
    }, 1000); // 1s debounce

    return () => clearTimeout(timeout);
  }, [url]);

  const playNotificationSound = () => {
    if (settingsRef.current.soundEnabled) {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.5);
        osc.stop(ctx.currentTime + 0.5);
      } catch (err) {
        console.error("Audio playback failed", err);
      }
    }
  };

  const activeList = (Object.values(currentProgress) as DownloadProgress[]).filter((p) => ['downloading', 'preparing', 'paused'].includes(p.status));
  const totalSpeedMiB = activeList.reduce((acc, p) => {
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

  const speedValue = totalSpeedMiB >= 100 ? totalSpeedMiB.toFixed(0) : totalSpeedMiB.toFixed(1);
  const speedUnit = 'MB/s';

  useEffect(() => {
    const unlisten = listen<DownloadProgress>('download-progress', (event) => {
      const p = event.payload;
      if (!p.id) return;

      console.log("[Front] Evento recebido:", p.id, p.status, p.percent + "%");
      setCurrentProgress(prev => {
        const existing = prev[p.id];
        const updated: DownloadProgress = {
          ...p,
          thumbnailBase64: existing?.thumbnailBase64 || p.thumbnailBase64,
          title: metadataTitleRef.current || existing?.title || p.title || p.filename,
        };

        if (p.status === 'completed') {
          // Convert thumbnail to base64 for history
          const resolveThumbnail = async () => {
            if (!p.thumbnail_path) return null;
            try { return await invoke<string>('read_thumbnail_as_base64', { path: p.thumbnail_path }); }
            catch (err) { console.error('History thumb error:', err); return null; }
          };

          resolveThumbnail().then(dataUrl => {
            setTimeout(() => {
              playNotificationSound();
              const newItem: DownloadHistoryItem = {
                id: Date.now().toString(),
                title: cleanTitle(metadataTitleRef.current || p.title || p.filename),
                filename: p.filename,
                filepath: p.output_path || '',
                type: inferFileType(p.filename),
                ext: (p.filename.split('.').pop() || '').toUpperCase(),
                completedAt: Date.now(),
                sizeLabel: formatYtDlpSize(p.total_size || ''),
                thumbnailDataUrl: dataUrl || metadataThumbnailRef.current || undefined,
              };
              setDownloadHistory(h => [newItem, ...h].slice(0, 100));
              setCurrentProgress(curr => {
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
              setNotification({type: 'error', message: t('Download error!', 'Erro no download!')});
              setTimeout(() => setNotification(null), 5000);
            }
          }

          setTimeout(() => {
            setCurrentProgress(curr => {
              const next = { ...curr };
              delete next[p.id];
              return next;
            });
          }, 4000);
          return { ...prev, [p.id]: updated };
        }

        if (p.status === 'skipped') {
          playNotificationSound();
          setNotification({type: 'warning', message: t('Already downloaded!', 'Já foi baixado!')});
          setTimeout(() => setNotification(null), 10000);
          setTimeout(() => {
            setCurrentProgress(curr => {
              const next = { ...curr };
              delete next[p.id];
              return next;
            });
          }, 2000);
          return { ...prev, [p.id]: updated };
        }

        return { ...prev, [p.id]: updated };
      });
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  useEffect(() => {
    (Object.values(currentProgress) as DownloadProgress[]).forEach(p => {
      if (p.thumbnail_path && !p.thumbnailBase64) {
        invoke<string>('read_thumbnail_as_base64', { path: p.thumbnail_path })
          .then(dataUrl => {
            setCurrentProgress(prev => ({
              ...prev,
              [p.id]: { ...prev[p.id], thumbnailBase64: dataUrl }
            }));
          }).catch(() => {});
      }
    });
  }, [currentProgress]);

  const handleDownloadClick = async () => {
    if (!url) return;
    const activeCount = Object.values(currentProgress).filter((p: DownloadProgress) => !['completed', 'error', 'skipped'].includes(p.status)).length;

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
      if (effectiveDir) {
        const alreadyExists = await invoke<boolean>('find_file_by_title', {
          dir: effectiveDir,
          title: metadataTitleRef.current || '',
        });
        if (alreadyExists) {
          playNotificationSound();
          setNotification({ type: 'warning', message: t('Already downloaded!', 'Já foi baixado!') });
          setTimeout(() => setNotification(null), 10000);
          return;
        }
      }
      
      const titleToUse = analyzedMedia?.qualityLabel.startsWith('AUDIO') 
        ? (metadataTitleRef.current || t('Audio', 'Áudio')) 
        : (metadataTitleRef.current || t('Video', 'Vídeo'));

      const newId = await invoke<string>('start_download', { 
        url, 
        outputDir: downloadPath, 
        quality: selectedQuality || null, 
        formatType: selectedFormat,
        title: titleToUse
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
          thumbnail: metadataThumbnailRef.current || ''
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
            <button onClick={() => setCurrentScreen('search')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${currentScreen === 'search' ? 'bg-[#1e1e1e] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}><Search className="w-4 h-4" />SEARCH</button>
            <button onClick={() => setCurrentScreen('downloads')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${currentScreen === 'downloads' ? 'bg-[#1e1e1e] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}><Download className="w-4 h-4" />DOWNLOADS</button>
            <button onClick={() => setCurrentScreen('settings')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${currentScreen === 'settings' ? 'bg-[#1e1e1e] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}><Settings className="w-4 h-4" />SETTINGS</button>
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
            <h1 className="text-lg font-semibold capitalize">{currentScreen}</h1>
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
                      try {
                        await invoke('cancel_download', { id: tid });
                        setCurrentProgress(curr => {
                          const next = { ...curr };
                          delete next[tid];
                          return next;
                        });
                      } catch (error) { console.error('Cancel error:', error); }
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-500 hover:bg-red-600 text-white transition-colors"
                  >{t('Yes, Cancel', 'Sim, Cancelar')}</button>
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

                <div className="space-y-4">
                  <input 
                    type="text" 
                    placeholder={t('Paste your link here (YouTube, TikTok, Reddit...)', 'Cole o seu link aqui (YouTube, TikTok, Reddit...)')}
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setAnalyzedMedia(null);
                      setAvailableQualities([]);
                      metadataTitleRef.current = '';
                      metadataThumbnailRef.current = '';
                    }}
                    className="w-full bg-[#1a1a1a] border border-white/5 rounded-xl px-6 py-5 text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-all"
                  />
                  <div className="flex flex-col sm:flex-row gap-4 relative">
                    <div className="w-full sm:w-32 shrink-0 relative">
                      <select
                        value={selectedFormat}
                        onChange={(e) => setSelectedFormat(e.target.value as any)}
                        disabled={isAnalyzing}
                        className="w-full appearance-none bg-[#1a1a1a] border border-white/5 rounded-xl pl-4 pr-10 py-4 text-xs font-bold tracking-wider text-white focus:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="video" disabled={!mediaCapabilities.video}>{t('VIDEO', 'VÍDEO')}</option>
                        <option value="audio" disabled={!mediaCapabilities.audio}>{t('AUDIO', 'ÁUDIO')}</option>
                      </select>
                      <ChevronDown className="w-4 h-4 text-white/30 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>

                    <button 
                      onClick={() => setIsQualityDropdownOpen(!isQualityDropdownOpen)}
                      disabled={isAnalyzing || availableQualities.length === 0}
                      className="flex-1 flex items-center justify-between bg-[#1a1a1a] border border-white/5 rounded-xl px-6 py-4 hover:bg-[#222] transition-colors relative"
                    >
                      <span className={`text-xs font-bold tracking-wider ${isAnalyzing ? 'animate-pulse text-white/50' : 'text-white'}`}>
                        {isAnalyzing ? t('ANALYZING MEDIA...', 'ANALISANDO MÍDIA...') : (selectedQuality || t('AWAITING URL...', 'AGUARDANDO LINK...'))}
                      </span>
                      <ChevronDown className="w-4 h-4 text-white/30" />
                    </button>

                    {isQualityDropdownOpen && availableQualities.length > 0 && (
                      <div className="absolute top-18 left-0 sm:left-34 w-full sm:w-[calc(50%-4rem)] bg-[#1a1a1a] border border-white/5 rounded-xl shadow-xl z-50 overflow-hidden divide-y divide-white/5">
                        {availableQualities.map(q => (
                          <button
                            key={q}
                            onClick={() => { setSelectedQuality(q); setIsQualityDropdownOpen(false); }}
                            className={`w-full text-left px-6 py-4 text-xs font-bold tracking-wider hover:bg-[#222] transition-colors ${selectedQuality === q ? 'text-yellow-400 bg-white/5' : 'text-white'}`}
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    )}

                    <button 
                      onClick={handleDownloadClick} 
                      disabled={!url || !analyzedMedia || isAnalyzing}
                      className="flex-1 bg-[#2a2a2a] hover:bg-[#333] disabled:opacity-50 text-white rounded-xl px-6 py-4 font-bold tracking-wider text-sm transition-colors"
                    >
                      {isAnalyzing ? t('LOADING...', 'CARREGANDO...') : t('DOWNLOAD', 'DOWNLOAD')}
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  {(Object.values(currentProgress) as DownloadProgress[]).map((p) => (
                    <div key={p.id} className="bg-[#171717] border border-white/5 rounded-2xl p-6 flex items-center gap-6">
                      <div className="w-14 h-14 bg-white/5 rounded-lg border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                        {p.thumbnailBase64 ? <img src={p.thumbnailBase64} alt="thumb" className="w-full h-full object-cover" /> : p.thumbnail ? <img src={p.thumbnail} alt="thumb" className="w-full h-full object-cover" /> : <Play size={20} className="text-white/30" />}
                      </div>
                      <div className="flex-1 min-w-0 space-y-3">
                        <div className="flex justify-between items-end gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-bold tracking-widest text-white/50 mb-1">{t('ACTIVE DOWNLOAD', 'DOWNLOAD ATIVO')}</div>
                            <p className="text-sm font-semibold text-white truncate w-full">{p.status === 'preparing' ? t('Preparing...', 'Preparando...') : cleanTitle(p.title || p.filename || t('Video', 'Vídeo'))}</p>
                          </div>
                          <span className="text-xs font-bold text-yellow-400 tabular-nums shrink-0 pb-0.5">{p.percent > 0 || p.status !== 'preparing' ? `${Math.round(p.percent)}%` : '...'}</span>
                        </div>
                        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-yellow-400 rounded-full transition-all duration-300 ease-out" style={{ width: `${p.percent}%` }} /></div>
                      </div>
                      <div className="flex items-center gap-4 ml-4 shrink-0">
                        <button onClick={async () => { try { await invoke('pause_download', { id: p.id }); } catch (e) { console.error('Pause error:', e); } }} className="text-white/50 hover:text-white transition-colors">{p.status === 'paused' ? <Play size={14} className="text-white/60" fill="currentColor" /> : <Pause size={14} className="text-white/60" fill="currentColor" />}</button>
                        <button onClick={() => setCancelingId(p.id)} className="text-white/50 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-8">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-white/40">{t('Recent Activity', 'Atividade Recente')}</h2>
                    <button onClick={() => setCurrentScreen('downloads')} className="text-xs font-semibold uppercase tracking-widest text-yellow-400/70 hover:text-yellow-400 transition-colors duration-200">{t('View History', 'Ver Histórico')}</button>
                  </div>
                  {downloadHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-2">
                      <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center"><Clock size={18} className="text-white/20" /></div>
                      <p className="text-sm text-white/25">{t('No recent activity', 'Nenhum arquivo baixado recentemente')}</p>
                    </div>
                  ) : (
                    <ul className="space-y-1">
                      {downloadHistory.map((item) => (
                        <li key={item.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors duration-150">
                          <div className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center cursor-pointer" onClick={() => console.log('Abrir arquivo:', item.filepath)}>
                            {item.thumbnailDataUrl?.startsWith('data:') || item.thumbnailDataUrl?.startsWith('http') ? <img src={item.thumbnailDataUrl} alt={item.title} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : { video: <Film size={20} className="text-yellow-400/70" />, audio: <Music size={20} className="text-blue-400/70" /> }[item.type as string] || <FileDown size={20} className="text-white/30" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white/90 truncate">{item.title}</p>
                            <p className="text-xs text-white/35 mt-0.5 truncate">{isEnglish ? 'Completed' : 'Concluído'} {formatRelativeTime(item.completedAt)}{item.sizeLabel ? ` • ${item.sizeLabel}` : ''}</p>
                          </div>
                          <button onClick={async (e) => { e.stopPropagation(); try { const folder = downloadPath || ''; if (folder) await invoke('open_folder_natively', { path: folder }); } catch (error) { console.error('Erro ao abrir pasta:', error); } }} className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all duration-150 cursor-pointer"><FolderOpen size={15} className="text-white/50 hover:text-white/80 transition-colors" /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}

            {currentScreen === 'downloads' && (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 border-b border-white/5 pb-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold tracking-tight text-white">Downloads</h2>
                    <div className="flex items-center gap-3">
                      {downloadHistory.length > 0 && (
                        <button onClick={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : 'newest')} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white/70 px-3 py-1.5 rounded-lg transition-colors text-xs font-semibold uppercase tracking-widest cursor-pointer">
                          <Clock size={14} className={`transition-transform duration-300 ${sortOrder === 'oldest' ? 'rotate-180' : ''}`} />
                          {sortOrder === 'newest' ? t('Newest', 'Mais Novos') : t('Oldest', 'Mais Antigos')}
                        </button>
                      )}
                      {downloadHistory.length > 0 && <span className="bg-white/10 text-white/70 text-xs font-bold px-3 py-1 rounded-full">{downloadHistory.length} {downloadHistory.length === 1 ? t('file', 'arquivo') : t('files', 'arquivos')}</span>}
                    </div>
                  </div>
                  {downloadHistory.length > 0 && (
                    <div className="relative">
                      <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                      <input type="text" placeholder={t('Search downloads...', 'Procurar downloads...')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-[#1a1a1a] border border-white/5 rounded-xl pl-12 pr-6 py-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-all" />
                    </div>
                  )}
                </div>
                {downloadHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center"><Download size={24} className="text-white/20" /></div>
                    <p className="text-white/40">{t('No downloads completed yet. Let\'s go!', 'Nenhum download concluído ainda. Vamos a isso!')}</p>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {(() => {
                      let list = downloadHistory.filter(item => item.title.toLowerCase().includes(searchQuery.toLowerCase()));
                      if (sortOrder === 'oldest') list = [...list].reverse();
                      return list.map((item) => (
                        <div key={item.id} className="group flex flex-col sm:flex-row items-center gap-4 p-4 bg-[#1a1a1a] border border-white/5 rounded-2xl hover:bg-[#1e1e1e] transition-colors">
                          <div className="shrink-0 w-full sm:w-32 h-20 rounded-lg overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center">
                            {item.thumbnailDataUrl?.startsWith('data:') || item.thumbnailDataUrl?.startsWith('http') ? <img src={item.thumbnailDataUrl} alt={item.title} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : { video: <Film size={24} className="text-yellow-400/70" />, audio: <Music size={24} className="text-blue-400/70" /> }[item.type as string] || <FileDown size={24} className="text-white/30" />}
                          </div>
                          <div className="flex-1 min-w-0 w-full space-y-2">
                            <h3 className="text-sm font-semibold text-white/90 line-clamp-2" title={item.title}>{item.title}</h3>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/40">
                              <span className="flex items-center gap-1.5"><Clock size={12} /> {formatRelativeTime(item.completedAt)}</span>
                              {item.sizeLabel && <span className="flex items-center gap-1.5"><HardDrive size={12} /> {item.sizeLabel}</span>}
                              {item.ext && <span className="flex items-center gap-1.5 text-white/60 font-bold tracking-widest uppercase"><span className="w-1.5 h-1.5 rounded-full bg-white/20"></span>{item.ext}</span>}
                            </div>
                          </div>
                          <div className="shrink-0 w-full sm:w-auto flex justify-end">
                            <button onClick={async (e) => { e.stopPropagation(); try { const folder = item.filepath.substring(0, Math.max(item.filepath.lastIndexOf('\\'), item.filepath.lastIndexOf('/'))) || downloadPath || ''; if (folder) await invoke('open_folder_natively', { path: folder }); } catch (error) { console.error('Erro ao abrir pasta:', error); } }} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 px-4 py-2.5 rounded-lg transition-colors text-xs font-semibold text-white/70 hover:text-white"><FolderOpen size={14} /><span>{t('Open Folder', 'Abrir Pasta')}</span></button>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>
            )}

            {currentScreen === 'settings' && (
              <SettingsScreen downloadPath={downloadPath} onDownloadPathChange={setDownloadPath} settings={settings} setSettings={setSettings} />
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
