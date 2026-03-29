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
}

interface DownloadHistoryItem {
  id: string;
  title: string;
  filepath: string;
  type: 'video' | 'audio' | 'other';
  completedAt: number;
  sizeLabel: string;
  thumbnailDataUrl: string | null;
}

function inferFileType(filename: string): 'video' | 'audio' | 'other' {
  const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.m4v'];
  const audioExts = ['.mp3', '.flac', '.aac', '.wav', '.ogg', '.m4a', '.opus'];
  const lower = filename.toLowerCase();
  if (videoExts.some((ext) => lower.endsWith(ext))) return 'video';
  if (audioExts.some((ext) => lower.endsWith(ext))) return 'audio';
  return 'other';
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return 'Agora mesmo';
  if (minutes < 60) return `${minutes} min atrás`;
  if (hours < 24) return `${hours}h atrás`;
  if (days === 1) return 'Ontem';
  return `${days} dias atrás`;
}
/** 
 * Cleans up yt-dlp filenames by stripping format identifiers, mangled URLs
 * and leftover ID hashes. Keeps the meaningful title + original extension.
 * Examples:
 *   "Out of Context Mex - httpst.conAElyqLBcY.fhls-audio-128000-Audio.mp4" → "Out of Context Mex.mp4"
 *   "Big Buck Bunny [abc123].mp4" → "Big Buck Bunny.mp4"
 */
function cleanTitle(filename: string): string {
  // Preserve extension for display (e.g. .mp4)
  const extMatch = filename.match(/\.([a-z0-9]{2,5})$/i);
  const ext = extMatch ? `.${extMatch[1]}` : '';

  // Remove extension to work on stem
  let t = filename.replace(/\.[a-z0-9]{2,5}$/i, '');

  // Remove yt-dlp format markers like ".fhls-audio-128000-Audio", "-f137"
  t = t.replace(/[.\s-]+(?:fhls|dash|hls|avc|aac|opus|av1|vp9|f\d{3})[-.]?[\w.-]*$/i, '');

  // Remove actual URLs like " - https://t.co/nAElyqLBcY" or " - https://twitter.com/..."
  t = t.replace(/\s+-\s+https?:\/\/[^\s]+|https?:\/\/[^\s]+/i, '');

  // Remove mangled URLs like " - httpst.conAElyqLBcY"
  t = t.replace(/\s+-\s+\S*[a-z]{2,}\.[a-z]{2,}\S*/i, '');

  // Remove trailing YouTube/general video IDs like " [dQw4w9WgXcQ]"
  t = t.replace(/\s+\[[a-zA-Z0-9_-]{6,}\]$/, '');

  // Remove trailing bare alphanumeric IDs after a dash " - dQw4w9WgXcQ"
  t = t.replace(/\s+-\s+[a-zA-Z0-9_-]{8,}$/, '');

  const result = t.trim();
  return result ? `${result}${ext}` : filename;
}



export default function App() {
  const [currentScreen, setCurrentScreen] = useState('search');
  const [isDownloading, setIsDownloading] = useState(false);
  const [url, setUrl] = useState('');
  const [currentProgress, setCurrentProgress] = useState<DownloadProgress | null>(null);
  const [downloadPath, setDownloadPath] = useState('');
  const [notification, setNotification] = useState<{type: 'success' | 'error' | 'warning', message: string} | null>(null);
  const [downloadHistory, setDownloadHistory] = useState<DownloadHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('ud_download_history');
      if (!saved) return [];
      const parsed: DownloadHistoryItem[] = JSON.parse(saved);
      // Filter out old items that stored a file path instead of a base64 data URL
      const clean = parsed.map(item => ({
        ...item,
        thumbnailDataUrl: item.thumbnailDataUrl?.startsWith('data:') ? item.thumbnailDataUrl : null,
      }));
      // Persist the cleaned version back
      localStorage.setItem('ud_download_history', JSON.stringify(clean));
      return clean;
    } catch {
      return [];
    }
  });

  const [isPaused, setIsPaused] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  // Ref to metadata title — avoids stale closure in the download-progress event listener
  const metadataTitleRef = useRef<string>('');

  const speedMatch = currentProgress?.speed && currentProgress.speed !== '-' ? currentProgress.speed.match(/^([\d.]+)(.*)$/) : null;
  const speedValue = speedMatch ? parseFloat(speedMatch[1]).toFixed(1) : '0.0';
  const speedUnit = speedMatch ? speedMatch[2].trim() : 'MB/s';

  useEffect(() => {
    const unlisten = listen<DownloadProgress>('download-progress', (event) => {
      const p = event.payload;

      if (p.status === 'completed') {
        setIsDownloading(false);
        // Force visual progress to 100% before the 1.5s timeout hides the active card
        setCurrentProgress(prev => prev ? { ...prev, percent: 100, status: 'completed' } : null);

        // Convert thumbnail to base64 data URL for safe storage in history
        const resolveThumbnail = async (): Promise<string | null> => {
          if (!p.thumbnail_path) {
            return null;
          }
          try {
            const dataUrl = await invoke<string>('read_thumbnail_as_base64', { path: p.thumbnail_path });
            return dataUrl;
          } catch (err) {
            console.error('[Universal Downloader] Falha ao ler thumbnail do disco:', err);
            return null;
          }
        };
        resolveThumbnail().then((dataUrl) => {
          setTimeout(() => {
            const newItem: DownloadHistoryItem = {
              id: Date.now().toString(),
              title: cleanTitle(metadataTitleRef.current || p.filename || 'video'),
              filepath: p.output_path || '',
              type: inferFileType(p.filename),
              completedAt: Date.now(),
              sizeLabel: p.total_size || '',
              thumbnailDataUrl: dataUrl,
            };
            setDownloadHistory((prev) => {
              const updated = [newItem, ...prev].slice(0, 5);
              localStorage.setItem('ud_download_history', JSON.stringify(updated));
              return updated;
            });
            setCurrentProgress(null);
          }, 1500);
        });
      } else if (p.status === 'idle' || p.status === 'error') {
        setIsDownloading(false);
        setCurrentProgress(null);
      } else if (p.status === 'skipped') {
        setIsDownloading(false);
        setNotification({type: 'warning', message: 'Este vídeo já foi baixado!'});
        setTimeout(() => setNotification(null), 10000);
        setTimeout(() => setCurrentProgress(null), 1500);
      } else if (p.status === 'downloading' || p.status === 'paused' || p.status === 'preparing') {
        setIsDownloading(true);
        setCurrentProgress(prev => ({
          ...p,
          thumbnailBase64: prev?.thumbnailBase64,
          thumbnail: prev?.thumbnail || p.thumbnail,
          // Preserve clean title from metadata (correct encoding). Fallback to prev state to avoid flicker.
          filename: metadataTitleRef.current || prev?.filename || p.filename || 'Vídeo',
          title: metadataTitleRef.current || prev?.title || p.title || 'Vídeo',
        }));
      }
    });

    const unlistenPaused = listen<boolean>('download-paused', (event) => {
      setIsPaused(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
      unlistenPaused.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const path = currentProgress?.thumbnail_path;
    if (!path) return;
    console.group('[Thumbnail] useEffect — thumbnail_path mudou');
    console.log('  path:', path);
    console.groupEnd();
    invoke<string>('read_thumbnail_as_base64', { path })
      .then((dataUrl) => {
        console.log('[Thumbnail] Carregado para card ativo. length:', dataUrl?.length, 'prefix:', dataUrl?.slice(0, 40));
        setCurrentProgress(prev => prev ? { ...prev, thumbnailBase64: dataUrl } : null);
      })
      .catch(err => {
        console.error('[Thumbnail] Falha ao carregar para card ativo:', err);
      });
  }, [currentProgress?.thumbnail_path]);

  const handleDownloadClick = async () => {
    if (!url) return;
    setCurrentProgress({
      percent: 0,
      speed: '-',
      eta: '-',
      status: 'preparing',
      filename: 'Extraindo informações...',
      output_path: '',
      total_size: '',
      thumbnail_path: '',
      title: 'Carregando...',
      thumbnail: ''
    });
    setIsPaused(false);
    setIsDownloading(true);

    // Yield to the event loop so React renders the 'preparing' state
    // before the blocking metadata fetch starts
    await new Promise(resolve => setTimeout(resolve, 30));

    try {
      const metadataJson = await invoke<string>('get_video_metadata', { url });
      const metadata = JSON.parse(metadataJson);

      // Pre-download duplicate check using fuzzy title matching on the output dir
      const effectiveDir = downloadPath || '';
      if (effectiveDir) {
        const alreadyExists = await invoke<boolean>('find_file_by_title', {
          dir: effectiveDir,
          title: metadata.title || '',
        });
        console.log('[DupCheck] dir:', effectiveDir, '| title:', metadata.title, '| alreadyExists:', alreadyExists);
        if (alreadyExists) {
          setNotification({ type: 'warning', message: 'Este vídeo já foi baixado!' });
          setTimeout(() => setNotification(null), 10000);
          setCurrentProgress(null);
          setIsDownloading(false);
          return;
        }
      }
      
      setCurrentProgress(prev => prev ? {
        ...prev,
        title: metadata.title || 'Vídeo',
        thumbnail: metadata.thumbnail || '',
        filename: metadata.title || 'Vídeo'
      } : null);
      metadataTitleRef.current = metadata.title || ''; // keep in ref for event listener

      await invoke('start_download', { url, outputDir: downloadPath });
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('ARQUIVO_JA_EXISTE')) {
        setNotification({type: 'warning', message: 'Este vídeo já foi baixado!'});
        setTimeout(() => setNotification(null), 10000);
      } else if (errMsg.includes('oauth_required') || errMsg.toLowerCase().includes('login')) {
        setNotification({type: 'warning', message: 'Login OAuth necessário! Verifique o terminal.'});
        setTimeout(() => setNotification(null), 10000);
      } else if (errMsg.toLowerCase().includes('http error 403') || errMsg.toLowerCase().includes('sign in to confirm') || errMsg.toLowerCase().includes('bot') || errMsg.toLowerCase().includes('blocked')) {
        setNotification({type: 'error', message: 'Houve um problema na requisição. Tente novamente mais tarde!'});
        setTimeout(() => setNotification(null), 10000);
        console.error('[App] yt-dlp foi provávelmente bloqueado (Rate Limit / Bot). ERRO REAL:', errMsg);
      } else {
        setNotification({type: 'error', message: 'Erro crítico no download. Verifique o link e tente novamente.'});
        setTimeout(() => setNotification(null), 10000);
        console.error('Erro no download:', error);
      }
      
      // Sempre limpar o painel "Extraindo informações..." se a extração final abortou
      setCurrentProgress(null);
      setIsDownloading(false);
    }
  };
  
  return (
    <div className="flex h-screen bg-[#0a0a0a] text-white font-sans selection:bg-white/20">
      {/* Sidebar */}
      <aside className="w-64 bg-[#111111] border-r border-white/5 flex flex-col justify-between shrink-0">
        <div>
          {/* Logo */}
          <div className="p-8 flex items-center gap-3">
            <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
               <Download className="w-4 h-4 text-[#111111]" strokeWidth={3} />
            </div>
            <span className="font-bold tracking-widest text-lg">PASTEPULL</span>
          </div>

          {/* Navigation */}
          <nav className="px-4 space-y-1">
            <button 
              onClick={() => setCurrentScreen('search')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${currentScreen === 'search' ? 'bg-[#1e1e1e] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
            >
              <Search className="w-4 h-4" />
              SEARCH
            </button>
            <button 
              onClick={() => setCurrentScreen('downloads')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${currentScreen === 'downloads' ? 'bg-[#1e1e1e] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
            >
              <Download className="w-4 h-4" />
              DOWNLOADS
            </button>
            <button 
              onClick={() => setCurrentScreen('settings')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${currentScreen === 'settings' ? 'bg-[#1e1e1e] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
            >
              <Settings className="w-4 h-4" />
              SETTINGS
            </button>
          </nav>
        </div>

        {/* Global Speed */}
        <div className="p-4">
          <div className="bg-[#171717] rounded-xl p-4 border border-white/5">
            <div className="flex items-center gap-2 text-white/50 mb-2">
              <Gauge className="w-4 h-4" />
              <span className="text-[10px] font-bold tracking-widest">GLOBAL SPEED</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold">{speedValue}</span>
              <span className="text-xs text-white/50 font-medium">{speedUnit}</span>
            </div>
          </div>
        </div>
        </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between p-8">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold capitalize">{currentScreen}</h1>
          </div>
        </header>

        {/* Notification Toast */}
        <AnimatePresence>
          {notification && (
            <motion.div 
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className={`fixed top-6 right-6 px-6 py-4 rounded-xl shadow-2xl z-50 border backdrop-blur-md flex items-center gap-4 min-w-[320px] max-w-md ${
                notification.type === 'warning' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' : 
                notification.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 
                'bg-green-500/10 border-green-500/20 text-green-400'
              }`}
            >
              <div className="flex-1 font-medium text-sm">{notification.message}</div>
              <button 
                onClick={() => setNotification(null)} 
                className="opacity-60 hover:opacity-100 transition-opacity p-1.5 hover:bg-white/10 rounded-md shrink-0"
              >
                <X size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Cancel Download Modal */}
        <AnimatePresence>
          {showCancelModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-[#1a1a1a] border border-white/10 p-6 rounded-2xl shadow-2xl max-w-sm w-full"
              >
                <div className="flex items-center gap-3 text-red-400 mb-4">
                  <div className="w-10 h-10 rounded-full bg-red-400/10 flex items-center justify-center">
                    <X size={20} />
                  </div>
                  <h3 className="text-lg font-bold text-white">Cancelar Download?</h3>
                </div>
                <p className="text-white/60 text-sm mb-6">
                  Tem certeza que deseja cancelar o download do vídeo? O progresso atual será perdido.
                </p>
                <div className="flex gap-3 justify-end">
                  <button 
                    onClick={() => setShowCancelModal(false)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    Voltar
                  </button>
                  <button 
                    onClick={async () => {
                      setShowCancelModal(false);
                      try {
                        await invoke('cancel_download');
                        console.log('[Universal Downloader] Download cancelado via backend.');
                      } catch (error) {
                        console.error('[Universal Downloader] Erro ao cancelar download:', error);
                      } finally {
                        setCurrentProgress(null);
                        setIsDownloading(false);
                      }
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-500 hover:bg-red-600 text-white transition-colors"
                  >
                    Sim, Cancelar
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-8 pt-12">
          <div className="max-w-3xl mx-auto space-y-12">
            
            {currentScreen === 'search' && (
            <>
            {/* Hero Section */}
            <div className="text-center space-y-4">
              <h2 className="text-4xl font-bold tracking-tight">PastePull</h2>
              <p className="text-white/50 text-lg">Enter a URL and download it :).</p>
            </div>

            {/* Input Section */}
            <div className="space-y-4">
              <input 
                type="text" 
                placeholder="Paste your link here (YouTube, TikTok, Reddit...)" 
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-white/5 rounded-xl px-6 py-5 text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-all"
              />
              <div className="flex gap-4">
                <button className="flex-1 flex items-center justify-between bg-[#1a1a1a] border border-white/5 rounded-xl px-6 py-4 hover:bg-[#222] transition-colors">
                  <span className="text-xs font-bold tracking-wider">1080P HIGH DEFINITION</span>
                  <ChevronDown className="w-4 h-4 text-white/50" />
                </button>
                <button onClick={handleDownloadClick} className="flex-1 bg-[#2a2a2a] hover:bg-[#333] text-white rounded-xl px-6 py-4 font-bold tracking-wider text-sm transition-colors">
                  DOWNLOAD
                </button>
              </div>
            </div>

            {/* Active Download */}
            {currentProgress && (['downloading', 'preparing', 'paused', 'oauth_required', 'completed'].includes(currentProgress.status)) && (
            <div className="bg-[#171717] border border-white/5 rounded-2xl p-6 flex items-center gap-6">
              <div className="w-14 h-14 bg-white/5 rounded-lg border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                {currentProgress?.thumbnailBase64 ? (
                  <img
                    src={currentProgress.thumbnailBase64}
                    alt="thumbnail"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : currentProgress?.thumbnail ? (
                  <img
                    src={currentProgress.thumbnail}
                    alt={currentProgress.title || "Thumbnail"}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Play size={20} className="text-white/30" />
                )}
              </div>
              
              <div className="flex-1 space-y-3">
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-[10px] font-bold tracking-widest text-white/50 mb-1">ACTIVE DOWNLOAD</div>
                    <p className="text-sm font-semibold text-white truncate">
                      {currentProgress.title === 'Carregando...' ? 'Extraindo informações...' : cleanTitle(currentProgress.title || currentProgress.filename || 'Vídeo')}
                    </p>
                  </div>
                  <span className="text-xs font-bold text-yellow-400 tabular-nums">
                    {currentProgress.percent > 0 || currentProgress.status !== 'preparing' ? `${Math.round(currentProgress.percent)}%` : '...'}
                  </span>
                </div>
                
                <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yellow-400 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${currentProgress ? currentProgress.percent : 0}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 ml-4 shrink-0">
                <button 
                  onClick={async () => {
                    try {
                      await invoke('pause_download');
                      console.log('[Universal Downloader] Download pausado via backend.');
                    } catch (error) {
                      console.error('[Universal Downloader] Erro ao pausar download:', error);
                    }
                  }}
                  className="text-white/50 hover:text-white transition-colors"
                >
                  {isPaused ? (
                    <Play size={14} className="text-white/60" fill="currentColor" />
                  ) : (
                    <Pause size={14} className="text-white/60" fill="currentColor" />
                  )}
                </button>
                <button 
                  onClick={() => setShowCancelModal(true)}
                  className="text-white/50 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            )}

            {/* Recent Activity */}
            <div className="pt-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-white/40">
                  Recent Activity
                </h2>
                <button
                  onClick={() => setCurrentScreen('downloads')}
                  className="text-xs font-semibold uppercase tracking-widest text-yellow-400/70 hover:text-yellow-400 transition-colors duration-200"
                >
                  View History
                </button>
              </div>

              {downloadHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
                    <Clock size={18} className="text-white/20" />
                  </div>
                  <p className="text-sm text-white/25">Nenhum arquivo baixado recentemente</p>
                </div>
              ) : (
                <ul className="space-y-1">
                  {downloadHistory.map((item) => (
                    <li
                      key={item.id}
                      className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors duration-150"
                    >
                      <div
                        className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center cursor-pointer"
                        onClick={() => console.log('Abrir arquivo:', item.filepath)}
                      >
                        {item.thumbnailDataUrl?.startsWith('data:') ? (
                          <img
                            src={item.thumbnailDataUrl}
                            alt={item.title}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : item.type === 'video' ? (
                          <Film size={20} className="text-yellow-400/70" />
                        ) : item.type === 'audio' ? (
                          <Music size={20} className="text-blue-400/70" />
                        ) : (
                          <FileDown size={20} className="text-white/30" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white/90 truncate">{item.title}</p>
                        <p className="text-xs text-white/35 mt-0.5 truncate">
                          Concluído {formatRelativeTime(item.completedAt)}
                          {item.sizeLabel ? ` • ${item.sizeLabel}` : ''}
                        </p>
                      </div>

                      <button
                        title="Abrir localização do arquivo"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const folderToOpen = downloadPath || 'C:\\Users\\Lux\\Downloads';
                            console.log("Tentando abrir pasta:", folderToOpen);
                            await invoke('open_folder_natively', { path: folderToOpen });
                          } catch (error) {
                            console.error('[Universal Downloader] Erro ao abrir pasta:', error);
                          }
                        }}
                        className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all duration-150 cursor-pointer"
                      >
                        <FolderOpen size={15} className="text-white/50 hover:text-white/80 transition-colors" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            </>
            )}

            {currentScreen === 'downloads' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-white/5 pb-6">
                  <h2 className="text-2xl font-bold tracking-tight text-white">Downloads</h2>
                  {downloadHistory.length > 0 && (
                    <span className="bg-white/10 text-white/70 text-xs font-bold px-3 py-1 rounded-full">
                      {downloadHistory.length} {downloadHistory.length === 1 ? 'file' : 'files'}
                    </span>
                  )}
                </div>
                
                {downloadHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                      <Download size={24} className="text-white/20" />
                    </div>
                    <p className="text-white/40">Nenhum download concluído ainda. Vamos a isso!</p>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {downloadHistory.map((item) => (
                      <div
                        key={item.id}
                        className="group flex flex-col sm:flex-row items-center gap-4 p-4 bg-[#1a1a1a] border border-white/5 rounded-2xl hover:bg-[#1e1e1e] transition-colors"
                      >
                        <div className="shrink-0 w-full sm:w-32 h-20 rounded-lg overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center">
                          {item.thumbnailDataUrl?.startsWith('data:') ? (
                            <img
                              src={item.thumbnailDataUrl}
                              alt={item.title}
                              className="w-full h-full object-cover"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          ) : item.type === 'video' ? (
                            <Film size={24} className="text-yellow-400/70" />
                          ) : item.type === 'audio' ? (
                            <Music size={24} className="text-blue-400/70" />
                          ) : (
                            <FileDown size={24} className="text-white/30" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0 w-full space-y-2">
                          <h3 className="text-sm font-semibold text-white/90 line-clamp-2" title={item.title}>
                            {item.title}
                          </h3>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/40">
                            <span className="flex items-center gap-1.5"><Clock size={12} /> {formatRelativeTime(item.completedAt)}</span>
                            {item.sizeLabel && <span className="flex items-center gap-1.5"><HardDrive size={12} /> {item.sizeLabel}</span>}
                            <span className="flex items-center gap-1.5 truncate max-w-[200px] sm:max-w-xs" title={item.filepath}><Folder size={12} /> {item.filepath}</span>
                          </div>
                        </div>

                        <div className="shrink-0 w-full sm:w-auto flex justify-end">
                          <button
                            title="Abrir localização do arquivo"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const folderToOpen = item.filepath.substring(0, Math.max(item.filepath.lastIndexOf('\\'), item.filepath.lastIndexOf('/'))) || downloadPath || 'C:\\Users\\Lux\\Downloads';
                                console.log("Tentando abrir pasta:", folderToOpen);
                                await invoke('open_folder_natively', { path: folderToOpen });
                              } catch (error) {
                                console.error('[Universal Downloader] Erro ao abrir pasta:', error);
                              }
                            }}
                            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 px-4 py-2.5 rounded-lg transition-colors text-xs font-semibold text-white/70 hover:text-white"
                          >
                            <FolderOpen size={14} />
                            <span>Abrir Pasta</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {currentScreen === 'settings' && (
              <SettingsScreen downloadPath={downloadPath} onDownloadPathChange={setDownloadPath} />
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
