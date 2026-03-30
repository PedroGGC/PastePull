import { motion, AnimatePresence } from 'motion/react';
import { Play, ChevronDown } from 'lucide-react';
import { DownloadProgress } from '../types';
import { cleanTitle } from '../utils/formatters';
import { t } from '../utils/i18n';
import type { ChangeEvent } from 'react';

interface MediaInputProps {
  url: string;
  setUrl: (url: string) => void;
  analyzedMedia: { title: string; thumbnail: string; qualityLabel: string; type: 'video' | 'audio' } | null;
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
}: MediaInputProps) {
  const handleUrlChange = (e: ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
  };

  const isActiveForThisUrl = (Object.values(currentProgress) as DownloadProgress[]).some(
    p => p.url === url && p.status !== 'completed'
  );

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
                <p className="text-sm font-bold text-white truncate w-full" title={analyzedMedia.title}>
                  {cleanTitle(analyzedMedia.title)}
                </p>
                <p className="text-[10px] text-white/40 mt-0.5 font-medium">
                  {t('Ready to pull', 'Pronto para baixar')}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col sm:flex-row gap-4 relative">
        <div className="w-full sm:w-32 shrink-0 relative">
          <select
            value={selectedFormat}
            onChange={(e) => setSelectedFormat(e.target.value as 'video' | 'audio')}
            disabled={isAnalyzing}
            className="w-full appearance-none bg-[#1a1a1a] border border-white/5 rounded-xl pl-4 pr-10 py-4 text-xs font-bold tracking-wider text-white focus:outline-none cursor-pointer disabled:opacity50 disabled:cursor-not-allowed"
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
      </div>
    </div>
  );
}
