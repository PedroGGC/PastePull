import { invoke } from '@tauri-apps/api/core';
import { Play, Pause, X } from 'lucide-react';
import { DownloadProgress } from '../types';
import { cleanTitle } from '../utils/formatters';
import { t } from '../utils/i18n';

interface ActiveDownloadsProps {
  currentProgress: Record<string, DownloadProgress>;
  onCancel: (id: string) => void;
}

export function ActiveDownloads({ currentProgress, onCancel }: ActiveDownloadsProps) {
  const activeDownloads = Object.values(currentProgress).filter((p): p is DownloadProgress => 
    ['downloading', 'preparing', 'paused'].includes(p.status)
  );

  const handlePause = async (id: string) => {
    try {
      await invoke('pause_download', { id });
    } catch (e) {
      console.error('Pause error:', e);
    }
  };

  return (
    <div className="space-y-4">
      {activeDownloads.map((p) => (
        <div key={p.id} className="bg-[#171717] border border-white/5 rounded-2xl p-6 flex items-center gap-6">
          <div className="w-14 h-14 bg-white/5 rounded-lg border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
            {p.thumbnailBase64 ? (
              <img src={p.thumbnailBase64} alt="thumb" className="w-full h-full object-cover" />
            ) : p.thumbnail ? (
              <img src={p.thumbnail} alt="thumb" className="w-full h-full object-cover" />
            ) : (
              <Play size={20} className="text-white/30" />
            )}
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex justify-between items-end gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold tracking-widest text-white/50 mb-1">
                  {t('ACTIVE DOWNLOAD', 'DOWNLOAD ATIVO')}
                </div>
                <p className="text-sm font-semibold text-white truncate w-full" title={p.title || p.filename}>
                  {p.status === 'preparing' ? t('Preparing...', 'Preparando...') : cleanTitle(p.title || p.filename || t('Video', 'Vídeo'))}
                </p>
                <p className="text-[10px] text-white/30 truncate mt-0.5 font-medium">
                  {p.output_path || p.filename}
                </p>
              </div>
              <span className="text-xs font-bold text-yellow-400 tabular-nums shrink-0 pb-0.5">
                {p.percent > 0 || p.status !== 'preparing' ? `${Math.round(p.percent)}%` : '...'}
              </span>
            </div>
            <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-yellow-400 rounded-full transition-all duration-300 ease-out" style={{ width: `${p.percent}%` }} />
            </div>
          </div>
          <div className="flex items-center gap-4 ml-4 shrink-0">
            <button 
              onClick={() => handlePause(p.id)} 
              className="text-white/50 hover:text-white transition-colors"
            >
              {p.status === 'paused' ? (
                <Play size={14} className="text-white/60" fill="currentColor" />
              ) : (
                <Pause size={14} className="text-white/60" fill="currentColor" />
              )}
            </button>
            <button onClick={() => onCancel(p.id)} className="text-white/50 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
