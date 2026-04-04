import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {Folder, Download, Settings, Gauge, X, Clock, Trash2, CheckSquare, Square} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import SettingsScreen from './SettingsScreen';
import { MediaInput } from './components/MediaInput';
import { ActiveDownloads } from './components/ActiveDownloads';
import { HistoryList } from './components/HistoryList';
import { RecentActivity } from './components/RecentActivity';
import { NotificationToast, CancelModal, DeleteModal } from './components/Modals';
import { useMediaAnalyzer } from './hooks/useMediaAnalyzer';
import { useDownloadProgress } from './hooks/useDownloadProgress';
import { useNotifications } from './hooks/useNotifications';
import { useDownloadHistory } from './hooks/useDownloadHistory';
import { startDownload } from './utils/downloadHandler';
import { DownloadProgress, DownloadHistoryItem, Settings as SettingsType } from './types';
import { t } from './utils/i18n';
import { safeBtoa, normalizeFilepath } from './utils/helpers';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'search' | 'downloads' | 'settings'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [showArchive, setShowArchive] = useState(false);
  const [url, setUrl] = useState('');
  const [currentProgress, setCurrentProgress] = useState<Record<string, DownloadProgress>>({});
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [downloadPath, setDownloadPath] = useState(() => {
    try { return localStorage.getItem('ud_download_path') || ''; } 
    catch { return ''; }
  });
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [deleteModal, setDeleteModal] = useState<{show: boolean; items: DownloadHistoryItem[]; mode: 'trash' | 'history'} | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [settings, setSettings] = useState<SettingsType>(() => {
    try {
      const saved = localStorage.getItem('ud_settings');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { theme: 'dark', soundEnabled: false, desktopNotification: false, maxDownloads: 3 };
  });
  
  const [availableQualities, setAvailableQualities] = useState<string[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<string>('');
  const [isQualityDropdownOpen, setIsQualityDropdownOpen] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<'video' | 'audio'>('video');
  const [selectedExtension, setSelectedExtension] = useState<string>('MP4');
  const [isExtensionDropdownOpen, setIsExtensionDropdownOpen] = useState(false);
  const [isFormatDropdownOpen, setIsFormatDropdownOpen] = useState(false);

  const { notification, clearNotification, showNotification } = useNotifications();
  const { 
    downloadItems, 
    setDownloadItems,
    moveToTrash, 
    removeHistoryItem, 
    saveHistoryToBackend,
    activeDownloadsRef 
  } = useDownloadHistory();
  
  const fromRedownloadRef = useRef(false);
  const thumbnailCache = useRef<Record<string, string>>({});
  const settingsRef = useRef(settings);
  const metadataTitleRef = useRef<string>('');
  const metadataThumbnailRef = useRef<string>('');

  const { analyzedMedia, isAnalyzing, videoQualities, mediaCapabilities } = useMediaAnalyzer(url, {
    onError: (message) => showNotification('error', message, 10000)
  });

  useEffect(() => { setSelectedItems([]); }, [showArchive]);
  useEffect(() => { localStorage.setItem('ud_download_path', downloadPath); }, [downloadPath]);
  useEffect(() => { settingsRef.current = settings; localStorage.setItem('ud_settings', JSON.stringify(settings)); }, [settings]);

  const loadThumbnail = useCallback(async (filepath: string): Promise<string | null> => {
    const cached = thumbnailCache.current[filepath];
    if (cached) return cached;
    try {
      const result = await invoke<string>('read_thumbnail_as_base64', { path: filepath });
      thumbnailCache.current[filepath] = result;
      return result;
    } catch { return null; }
  }, []);

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

  const playNotificationSound = useCallback(() => {
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
      } catch (err) { console.error("Audio playback failed", err); }
    }
  }, []);

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

  const handleDownloadClick = useCallback(async () => {
    await startDownload({
      config: {
        url, downloadPath, selectedQuality, selectedFormat, selectedExtension,
        analyzedMedia, metadataTitle: metadataTitleRef.current, metadataThumbnail: metadataThumbnailRef.current, settings
      },
      currentProgress, setCurrentProgress, downloadItems, setDownloadItems, activeDownloadsRef,
      onNotification: showNotification
    });
  }, [url, downloadPath, selectedQuality, selectedFormat, selectedExtension, analyzedMedia, settings, currentProgress, downloadItems, showNotification]);

  const handleCancelDownload = useCallback(async (id: string) => {
    try {
      await invoke('cancel_download', { id });
      setCurrentProgress(curr => { const next = { ...curr }; delete next[id]; return next; });
      if (downloadPath) {
        const dir = downloadPath + (downloadPath.endsWith('\\') || downloadPath.endsWith('/') ? '' : '\\');
        activeDownloadsRef.current.delete(dir);
      }
    } catch (error) { console.error('Cancel error:', error); }
  }, [downloadPath]);

  const handleOpenFolder = useCallback(async (path: string) => {
    try { await invoke('open_folder_natively', { path }); } 
    catch (error) { console.error('Erro ao abrir pasta:', error); }
  }, []);

  const handleRedownload = useCallback((item: DownloadHistoryItem) => {
    fromRedownloadRef.current = true;
    setUrl(item.url);
    setSelectedFormat(item.format as 'video' | 'audio');
    setSelectedQuality(item.quality);
    setSelectedExtension(item.ext || 'MP4');
    setCurrentScreen('search');
    showNotification('success', t('Download settings restored!', 'Configurações restauradas!'), 10000);
  }, [showNotification]);

  const handleMoveToTrashClick = useCallback(async (items: DownloadHistoryItem[]) => {
    setIsDeleting(true);
    await moveToTrash(items);
    setIsDeleting(false);
    setSelectedItems([]);
    setDeleteModal(null);
    showNotification('success', t(`${items.length} item(s) moved to trash`, `${items.length} item(s) movido(s) para a lixeira`), 5000);
  }, [moveToTrash, showNotification]);

  const handleDeleteFromHistory = useCallback((items: DownloadHistoryItem[]) => {
    removeHistoryItem(items.map(i => i.id));
    setSelectedItems([]);
    setDeleteModal(null);
    showNotification('success', t(`${items.length} item(s) removed from history`, `${items.length} item(s) removido(s) do histórico`), 5000);
  }, [removeHistoryItem, showNotification]);

  useDownloadProgress({
    currentProgress, setCurrentProgress, downloadItems, setDownloadItems, saveHistoryToBackend,
    onDownloadComplete: async (newItem) => {
      const ext = newItem.ext?.toLowerCase() || '';
      if (ext === 'jpg' || ext === 'webp') return;
      let realSizeLabel = newItem.sizeLabel;
      const normalizedPath = newItem.filepath.replace(/\//g, '\\');
      const normalizeForMatch = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      let foundPath: string | null = null;
      try {
        const fileSize = await invoke<number>('get_file_size', { path: normalizedPath });
        foundPath = normalizedPath;
        const mb = fileSize / (1024 * 1024);
        if (mb >= 1024) realSizeLabel = `${(mb / 1024).toFixed(2)} GB`;
        else if (mb >= 0.1) realSizeLabel = `${mb.toFixed(2)} MB`;
        else realSizeLabel = `${(mb * 1024).toFixed(0)} KB`;
      } catch {
        const dir = newItem.filepath.replace(/[\\/][^\\/]+$/, '').replace(/\//g, '\\');
        const baseName = normalizeForMatch(newItem.filename.replace(/\.[^.]+$/, ''));
        try {
          const files = await invoke<string[]>('list_files_in_folder', { folderPath: dir });
          if (files?.length) {
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
                  if (mb >= 1024) realSizeLabel = `${(mb / 1024).toFixed(2)} GB`;
                  else if (mb >= 0.1) realSizeLabel = `${mb.toFixed(2)} MB`;
                  else realSizeLabel = `${(mb * 1024).toFixed(0)} KB`;
                  break;
                } catch { continue; }
              }
            }
          }
        } catch {}
      }
      const newFilePathNormalized = normalizeFilepath(foundPath || newItem.filepath || '');
      const itemWithStatus = { ...newItem, sizeLabel: realSizeLabel, status: 'active' as const, filepath: foundPath || newItem.filepath };
      setDownloadItems(prev => {
        const existingIndex = prev.findIndex(i => normalizeFilepath(i.filepath || '') === newFilePathNormalized);
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = { ...updated[existingIndex], ...itemWithStatus, thumbnailDataUrl: newItem.thumbnailDataUrl || updated[existingIndex].thumbnailDataUrl };
          return updated;
        }
        const newList = [itemWithStatus, ...prev];
        const seen = new Set<string>();
        const deduped = newList.filter(item => { const key = item.filepath?.toLowerCase() || item.id; if (seen.has(key)) return false; seen.add(key); return true; });
        saveHistoryToBackend(deduped);
        return deduped;
      });
      if (newItem.filepath) {
        const np = newItem.filepath.replace(/\//g, '\\');
        const fileDir = np.substring(0, Math.max(np.lastIndexOf('/'), np.lastIndexOf('\\')) + 1);
        const nfd = fileDir.endsWith('\\') ? fileDir : fileDir + '\\';
        activeDownloadsRef.current.delete(nfd);
      }
    },
    playNotificationSound, setNotification: showNotification
  });

  return (
    <div className={`flex h-screen bg-[#0a0a0a] text-white font-sans selection:bg-white/20 ${settings.theme === 'light' ? 'light-theme' : ''}`}>
      <aside className="w-64 bg-[#111111] border-r border-white/5 flex flex-col justify-between shrink-0">
        <div>
          <div className="p-8 flex items-center gap-3">
            <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center"><Download className="w-4 h-4 text-[#111111]" strokeWidth={3} /></div>
            <span className="font-bold tracking-widest text-lg">PASTEPULL</span>
          </div>
          <nav className="px-4 space-y-1">
            <button onClick={() => setCurrentScreen('search')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold ${currentScreen === 'search' ? 'bg-[#1e1e1e] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}><Download className="w-4 h-4" />{t('SEARCH', 'BUSCA')}</button>
            <button onClick={() => setCurrentScreen('downloads')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold ${currentScreen === 'downloads' ? 'bg-[#1e1e1e] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}><Folder className="w-4 h-4" />{t('DOWNLOADS', 'DOWNLOADS')}</button>
            <button onClick={() => setCurrentScreen('settings')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold ${currentScreen === 'settings' ? 'bg-[#1e1e1e] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}><Settings className="w-4 h-4" />{t('SETTINGS', 'CONFIGURAÇÕES')}</button>
          </nav>
        </div>
        <div className="p-4">
          <div className="bg-[#171717] rounded-xl p-4 border border-white/5">
            <div className="flex items-center gap-2 text-white/50 mb-2"><Gauge className="w-4 h-4" /><span className="text-[10px] font-bold tracking-widest">{t('GLOBAL SPEED', 'VELOCIDADE GLOBAL')}</span></div>
            <div className="flex items-baseline gap-1"><span className="text-2xl font-bold">{speedValue}</span><span className="text-xs text-white/50 font-medium">MB/s</span></div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between p-8"><h1 className="text-lg font-semibold capitalize">{currentScreen === 'search' ? t('Search', 'Busca') : currentScreen === 'downloads' ? t('Downloads', 'Downloads') : t('Settings', 'Configurações')}</h1></header>

        <NotificationToast notification={notification} onClose={clearNotification} />
        <CancelModal cancelingId={cancelingId} onClose={() => setCancelingId(null)} onConfirm={handleCancelDownload} />
        <DeleteModal modal={deleteModal} isDeleting={isDeleting} onClose={() => setDeleteModal(null)} onConfirmMoveToTrash={handleMoveToTrashClick} onConfirmRemoveFromHistory={handleDeleteFromHistory} />

        <div className="flex-1 overflow-y-auto p-8 pt-12">
          <div className="max-w-3xl mx-auto space-y-12">
            {currentScreen === 'search' && (
              <>
                <div className="text-center space-y-4">
                  <h2 className="text-4xl font-bold tracking-tight">PastePull</h2>
                  <p className="text-white/50 text-lg">{t('Enter a URL and download it :)', 'Insira um URL e baixe :)')}</p>
                </div>
                <MediaInput url={url} setUrl={setUrl} analyzedMedia={analyzedMedia} isAnalyzing={isAnalyzing} selectedFormat={selectedFormat} setSelectedFormat={setSelectedFormat} selectedQuality={selectedQuality} setSelectedQuality={setSelectedQuality} availableQualities={availableQualities} isQualityDropdownOpen={isQualityDropdownOpen} setIsQualityDropdownOpen={setIsQualityDropdownOpen} mediaCapabilities={mediaCapabilities} currentProgress={currentProgress} isDownloading={false} selectedExtension={selectedExtension} setSelectedExtension={setSelectedExtension} isExtensionDropdownOpen={isExtensionDropdownOpen} setIsExtensionDropdownOpen={setIsExtensionDropdownOpen} isFormatDropdownOpen={isFormatDropdownOpen} setIsFormatDropdownOpen={setIsFormatDropdownOpen} />
                <button onClick={handleDownloadClick} disabled={!url || !analyzedMedia || isAnalyzing} className="w-full bg-[#2a2a2a] hover:bg-[#333] disabled:opacity-50 text-white rounded-xl px-6 py-4 font-bold tracking-wider text-sm">{isAnalyzing ? t('LOADING...', 'CARREGANDO...') : t('DOWNLOAD', 'DOWNLOAD')}</button>
                <ActiveDownloads currentProgress={currentProgress} onCancel={(id) => setCancelingId(id)} />
                <RecentActivity items={downloadItems} onItemClick={() => {}} onRedownload={handleRedownload} onOpenFolder={handleOpenFolder} downloadPath={downloadPath} onViewAll={() => setCurrentScreen('downloads')} />
              </>
            )}

            {currentScreen === 'downloads' && (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 border-b border-white/5 pb-6">
                  <div className="flex items-center justify-end">
                    <div className="flex items-center gap-3">
                      {downloadItems.length > 0 && (
                        <div className="flex items-center bg-white/5 p-1 rounded-xl border border-white/5">
                          <button onClick={() => setShowArchive(false)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-bold uppercase ${!showArchive ? 'bg-white/10 text-white' : 'text-white/40'}`}><Folder size={14} />{t('DOWNLOADS', 'DOWNLOADS')}</button>
                          <button onClick={() => setShowArchive(true)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-bold uppercase ${showArchive ? 'bg-yellow-400/10 text-yellow-500' : 'text-white/40'}`}><Clock size={14} />{t('HISTORY', 'HISTÓRICO')}</button>
                        </div>
                      )}
                      {downloadItems.length > 0 && (
                        <button onClick={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : 'newest')} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white/70 px-3 py-1.5 rounded-lg text-xs font-semibold uppercase"><Clock size={14} className={sortOrder === 'oldest' ? 'rotate-180' : ''} />{sortOrder === 'newest' ? t('Newest', 'Mais Novos') : t('Oldest', 'Mais Antigos')}</button>
                      )}
                      {downloadItems.length > 0 && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => selectedItems.length > 0 ? setSelectedItems([]) : setSelectedItems((showArchive ? downloadItems.filter(i => i.status === 'deleted') : downloadItems.filter(i => i.status === 'active')).map(i => i.id))} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white/70 px-3 py-1.5 rounded-lg text-xs font-semibold uppercase">{selectedItems.length > 0 ? <CheckSquare size={14} /> : <Square size={14} />}<Trash2 size={14} /></button>
                          <span className="bg-white/10 text-white/70 text-xs font-bold px-3 py-1 rounded-full">{showArchive ? downloadItems.filter(i => i.status === 'deleted').length : downloadItems.filter(i => i.status === 'active').length} {t('file', 'arquivo')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {downloadItems.length > 0 && (
                    <div className="relative">
                      <input type="text" placeholder={t('Search downloads...', 'Procurar downloads...')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-[#1a1a1a] border border-white/5 rounded-xl pl-12 pr-6 py-3 text-white placeholder:text-white/30 focus:outline-none" />
                    </div>
                  )}
                </div>
                {selectedItems.length > 0 && (
                  <div className="flex items-center justify-between bg-[#1a1a1a] border border-white/10 p-4 rounded-xl">
                    <span className="text-sm font-semibold text-white">{selectedItems.length} {t('selected', 'selecionado(s)')}</span>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setSelectedItems([])} className="px-4 py-2 rounded-lg text-sm font-semibold text-white/70 hover:text-white">{t('Cancel', 'Cancelar')}</button>
                      <button onClick={() => setDeleteModal({ show: true, items: (showArchive ? downloadItems.filter(i => i.status === 'deleted') : downloadItems.filter(i => i.status === 'active')).filter(i => selectedItems.includes(i.id)), mode: showArchive ? 'history' : 'trash' })} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-red-500 hover:bg-red-600"><Trash2 size={16} />{showArchive ? t('Remove from history', 'Remover') : t('Move to trash', 'Mover')}</button>
                    </div>
                  </div>
                )}
                <HistoryList items={showArchive ? downloadItems.filter(i => i.status === 'deleted') : downloadItems.filter(i => i.status === 'active')} searchQuery={searchQuery} setSearchQuery={setSearchQuery} showArchive={showArchive} sortOrder={sortOrder} onItemClick={() => {}} onRedownload={handleRedownload} onOpenFolder={handleOpenFolder} downloadPath={downloadPath} selectedItems={selectedItems} setSelectedItems={setSelectedItems} onDelete={(item) => setDeleteModal({ show: true, items: [item], mode: item.status === 'deleted' ? 'history' : 'trash' })} />
              </div>
            )}

            {currentScreen === 'settings' && <SettingsScreen downloadPath={downloadPath} onDownloadPathChange={setDownloadPath} settings={settings} setSettings={setSettings} />}
          </div>
        </div>
      </main>
    </div>
  );
}
