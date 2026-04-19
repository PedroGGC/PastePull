import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, ChevronDown, ChevronRight, CheckSquare, Square, AlertTriangle } from 'lucide-react';
import { DownloadProgress } from '../types';
import { cleanTitle } from '../utils/formatters';
import { t } from '../utils/i18n';
import type { ChangeEvent } from 'react';
import type { PlaylistItem } from '../hooks/useMediaAnalyzer';

interface MediaInputProps {
  url: string;
  setUrl: (url: string) => void;
  analyzedMedia: { title: string; thumbnail: string; qualityLabel: string; type: 'video' | 'audio'; isPlaylist?: boolean; playlistItems?: PlaylistItem[]; playlistCount?: number; playlistWarning?: string } | null;
  isAnalyzing: boolean;
  selectedFormat: 'video' | 'audio';
  setSelectedFormat: (format: 'video' | 'audio') => void;
  selectedQuality: string;
  setSelectedQuality: (quality: string) => void;
  availableQualities: string[];
  isQualityDropdownOpen: boolean;
  setIsQualityDropdownOpen: (open: boolean) => void;
  mediaCapabilities: { video: boolean; audio: boolean };
  currentProgress: Record<string, DownloadProgress>;
  isDownloading: boolean;
  selectedExtension: string;
  setSelectedExtension: (ext: string) => void;
  isExtensionDropdownOpen: boolean;
  setIsExtensionDropdownOpen: (open: boolean) => void;
  isFormatDropdownOpen: boolean;
  setIsFormatDropdownOpen: (open: boolean) => void;
  onTogglePlaylistItem?: (index: number) => void;
  onSelectAllPlaylist?: (select: boolean) => void;
}

export function MediaInput({
  url,
  setUrl,
  analyzedMedia,
  isAnalyzing,
  selectedFormat,
  setSelectedFormat,
  selectedQuality,
  setSelectedQuality,
  availableQualities,
  isQualityDropdownOpen,
  setIsQualityDropdownOpen,
  mediaCapabilities,
  currentProgress,
  selectedExtension,
  setSelectedExtension,
  isExtensionDropdownOpen,
  setIsExtensionDropdownOpen,
  isFormatDropdownOpen,
  setIsFormatDropdownOpen,
  onTogglePlaylistItem,
  onSelectAllPlaylist,
}: MediaInputProps) {
  const [isPlaylistOpen, setIsPlaylistOpen] = useState(false);

  const handleUrlChange = (e: ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
  };

  const isPlaylist = analyzedMedia?.isPlaylist && analyzedMedia.playlistItems?.length;
  const playlistItems = analyzedMedia?.playlistItems || [];
  const availableItems = playlistItems.filter(i => i.available);
  const selectedCount = availableItems.filter(i => i.selected).length;
  const totalAvailable = availableItems.length;
  const playlistWarning = analyzedMedia?.playlistWarning;

  const isActiveForThisUrl = currentProgress ? (Object.values(currentProgress) as DownloadProgress[]).some(
    p => p.url === url && p.status !== 'completed'
  ) : false;

  const videoExtensions = ['MP4', 'MKV', 'WEBM'];
  const audioExtensions = ['MP3', 'M4A', 'OGG', 'FLAC', 'WAV'];
  const currentExtensions = selectedFormat === 'video' ? videoExtensions : audioExtensions;

  return (
    <div className="space-y-4">
      <input 
        type="text" 
        placeholder={t('Paste your link here (YouTube, TikTok, Reddit...)', 'Cole o seu link aqui (YouTube, TikTok, Reddit...)')}
        value={url}
        onChange={handleUrlChange}
        className="w-full bg-[#1a1a1a] border border-white/5 rounded-xl px-6 py-5 text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-all"
      />

      <AnimatePresence mode="wait">
        {analyzedMedia && !isActiveForThisUrl && (
          <motion.div 
            key="analysis-preview"
            initial={{ opacity: 0, y: 10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: 10, height: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="bg-yellow-400/5 border border-yellow-400/20 rounded-2xl p-5 flex items-center gap-5 mt-2">
              <div className="w-14 h-14 bg-white/5 rounded-lg border border-white/10 flex items-center justify-center shrink-0 overflow-hidden relative group">
                {analyzedMedia.thumbnail ? (
                  <img src={analyzedMedia.thumbnail} alt="thumb" className="w-full h-full object-cover" />
                ) : (
                  <Play size={20} className="text-white/30" />
                )}
                <div className="absolute inset-0 bg-yellow-400/10 animate-pulse opacity-50" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-bold tracking-[0.2em] text-yellow-400/70 mb-1 uppercase">
                  {t('Analysis Complete', 'Análise Concluída')}
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-white truncate w-full" title={analyzedMedia.title}>
                    {cleanTitle(analyzedMedia.title)}
                  </p>
                  {isPlaylist && (
                    <button 
                      onClick={() => setIsPlaylistOpen(!isPlaylistOpen)}
                      className="shrink-0 p-1 hover:bg-white/10 rounded transition-colors"
                    >
                      {isPlaylistOpen ? (
                        <ChevronDown className="w-4 h-4 text-yellow-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-yellow-400" />
                      )}
                    </button>
                  )}
                </div>
                {isPlaylist ? (
                  <p className="text-[10px] text-white/40 mt-0.5 font-medium">
                    {selectedCount} {t('selected', 'selecionado(s)')} / {analyzedMedia.playlistCount} {t('videos', 'vídeos')}
                  </p>
                ) : (
                  <p className="text-[10px] text-white/40 mt-0.5 font-medium">
                    {t('Ready to pull', 'Pronto para baixar')}
                  </p>
                )}
              </div>
            </div>

            <AnimatePresence>
              {isPlaylist && isPlaylistOpen && analyzedMedia.playlistItems && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-yellow-400/20 mt-4 pt-4 space-y-2 max-h-60 overflow-y-auto">
                    <button
                      onClick={() => onSelectAllPlaylist?.(selectedCount !== totalAvailable)}
                      className="flex items-center gap-2 text-xs font-bold text-yellow-400 hover:text-yellow-300 transition-colors w-full"
                    >
                      {selectedCount === totalAvailable ? (
                        <CheckSquare size={16} />
                      ) : (
                        <Square size={16} />
                      )}
                      {t('Select All', 'Selecionar Todos')}
                      <span className="text-white/40">({selectedCount}/{totalAvailable})</span>
                    </button>
                    {analyzedMedia.playlistItems.map((item, index) => {
                      const isUnavailable = !item.available;
                      return (
                        <div 
                          key={item.id}
                          onClick={() => !isUnavailable && onTogglePlaylistItem?.(index)}
                          className={`flex items-center gap-3 ${isUnavailable ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-white/5'} p-2 rounded-lg transition-colors`}
                        >
                          {isUnavailable ? (
                            <Square size={16} className="text-red-500/50 shrink-0" />
                          ) : item.selected ? (
                            <CheckSquare size={16} className="text-yellow-400 shrink-0" />
                          ) : (
                            <Square size={16} className="text-white/30 shrink-0" />
                          )}
                          <span className={`text-xs truncate flex-1 ${isUnavailable ? 'line-through text-white/50' : 'text-white'}`}>{item.title}</span>
                          <span className={`text-[10px] shrink-0 ${isUnavailable ? 'text-red-500/50' : 'text-white/40'}`}>{item.duration}</span>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col sm:flex-row gap-4 relative">
        <div className="w-full sm:w-28 shrink-0 relative">
          <button 
            onClick={() => setIsFormatDropdownOpen(!isFormatDropdownOpen)}
            disabled={isAnalyzing}
            className="w-full flex items-center justify-between bg-[#1a1a1a] border border-white/5 rounded-xl px-4 py-4 hover:bg-[#222] transition-colors"
          >
            <span className={`text-xs font-bold tracking-wider ${isAnalyzing ? 'text-white/50' : 'text-white'}`}>
              {selectedFormat === 'video' ? t('VIDEO', 'VÍDEO') : t('AUDIO', 'ÁUDIO')}
            </span>
            <ChevronDown className={`w-4 h-4 text-white/30 transition-transform duration-200 ${isFormatDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          {isFormatDropdownOpen && (
            <div className="absolute top-full left-0 w-full mt-2 bg-[#1a1a1a] border border-white/5 rounded-xl shadow-xl z-50 overflow-hidden divide-y divide-white/5">
              {mediaCapabilities.video && (
                <button
                  onClick={() => { setSelectedFormat('video'); setIsFormatDropdownOpen(false); }}
                  className={`w-full text-left px-4 py-3 text-xs font-bold tracking-wider hover:bg-[#222] transition-colors ${selectedFormat === 'video' ? 'text-yellow-400 bg-white/5' : 'text-white'}`}
                >
                  {t('VIDEO', 'VÍDEO')}
                </button>
              )}
              {mediaCapabilities.audio && (
                <button
                  onClick={() => { setSelectedFormat('audio'); setIsFormatDropdownOpen(false); }}
                  className={`w-full text-left px-4 py-3 text-xs font-bold tracking-wider hover:bg-[#222] transition-colors ${selectedFormat === 'audio' ? 'text-yellow-400 bg-white/5' : 'text-white'}`}
                >
                  {t('AUDIO', 'ÁUDIO')}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="w-full sm:w-28 shrink-0 relative">
          <button 
            onClick={() => setIsExtensionDropdownOpen(!isExtensionDropdownOpen)}
            disabled={isAnalyzing}
            className="w-full flex items-center justify-between bg-[#1a1a1a] border border-white/5 rounded-xl px-4 py-4 hover:bg-[#222] transition-colors"
          >
            <span className={`text-xs font-bold tracking-wider ${isAnalyzing ? 'text-white/50' : 'text-white'}`}>
              {selectedExtension}
            </span>
            <ChevronDown className={`w-4 h-4 text-white/30 transition-transform duration-200 ${isExtensionDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          {isExtensionDropdownOpen && (
            <div className="absolute top-full left-0 w-full mt-2 bg-[#1a1a1a] border border-white/5 rounded-xl shadow-xl z-50 overflow-hidden divide-y divide-white/5">
              {currentExtensions.map(ext => (
                <button
                  key={ext}
                  onClick={() => { setSelectedExtension(ext); setIsExtensionDropdownOpen(false); }}
                  className={`w-full text-left px-4 py-3 text-xs font-bold tracking-wider hover:bg-[#222] transition-colors ${selectedExtension === ext ? 'text-yellow-400 bg-white/5' : 'text-white'}`}
                >
                  {ext}
                </button>
              ))}
            </div>
          )}
        </div>

        <button 
          onClick={() => setIsQualityDropdownOpen(!isQualityDropdownOpen)}
          disabled={isAnalyzing || availableQualities.length === 0}
          className="flex-1 flex items-center justify-between bg-[#1a1a1a] border border-white/5 rounded-xl px-6 py-4 hover:bg-[#222] transition-colors relative"
        >
          <span className={`text-xs font-bold tracking-wider ${isAnalyzing ? 'animate-pulse text-white/50' : 'text-white'}`}>
            {isAnalyzing ? t('ANALYZING MEDIA...', 'ANALISANDO MÍDIA...') : (selectedQuality || t('AWAITING URL...', 'AGUARDANDO LINK...'))}
          </span>
          <ChevronDown className={`w-4 h-4 text-white/30 transition-transform duration-200 ${isQualityDropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {isQualityDropdownOpen && availableQualities.length > 0 && (
          <div className="absolute top-full left-0 sm:left-[calc(14rem+8rem+1rem)] w-full sm:w-[calc(100%-14rem-8rem-1rem)] mt-2 bg-[#1a1a1a] border border-white/5 rounded-xl shadow-xl z-50 overflow-hidden divide-y divide-white/5">
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
      </div>
    </div>
  );
}
