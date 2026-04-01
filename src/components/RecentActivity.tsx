import { Film, Music, FileDown, FolderOpen, Clock } from 'lucide-react';
import { DownloadHistoryItem } from '../types';
import { formatRelativeTime } from '../utils/formatters';
import { t, isEnglish } from '../utils/i18n';

interface RecentActivityProps {
  items: DownloadHistoryItem[];
  onItemClick: (item: DownloadHistoryItem) => void;
  onRedownload: (item: DownloadHistoryItem) => void;
  onOpenFolder: (filepath: string) => void;
  downloadPath: string;
  onViewAll: () => void;
}

export function RecentActivity({
  items,
  onRedownload,
  onOpenFolder,
  downloadPath,
  onViewAll,
}: RecentActivityProps) {
  const recentItems = items.filter(item => item.thumbnailDataUrl).slice(0, 5);

  const renderThumbnail = (item: DownloadHistoryItem) => {
    if (item.thumbnailDataUrl?.startsWith('data:') || item.thumbnailDataUrl?.startsWith('http')) {
      return (
        <img 
          src={item.thumbnailDataUrl} 
          alt={item.title} 
          className="w-full h-full object-cover"
          onError={(e) => { 
            (e.target as HTMLImageElement).style.display = 'none'; 
          }} 
        />
      );
    }
    
    const typeIcon = { video: <Film size={20} className="text-yellow-400/70" />, audio: <Music size={20} className="text-blue-400/70" /> };
    return typeIcon[item.type as string] || <FileDown size={20} className="text-white/30" />;
  };

  return (
    <div className="pt-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-white/40">
          {t('Recent Activity', 'Atividade Recente')}
        </h2>
        <button 
          onClick={onViewAll} 
          className="text-xs font-semibold uppercase tracking-widest text-yellow-400/70 hover:text-yellow-400 transition-colors duration-200"
        >
          {t('View History', 'Ver Histórico')}
        </button>
      </div>
      {recentItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
            <Clock size={18} className="text-white/20" />
          </div>
          <p className="text-sm text-white/25">{t('No recent activity', 'Nenhum arquivo baixado recentemente')}</p>
        </div>
      ) : (
        <ul className="space-y-1">
          {recentItems.map((item) => (
            <li 
              key={item.id} 
              className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors duration-150"
            >
              <div 
                className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center cursor-pointer"
                onClick={() => onOpenFolder(item.filepath?.substring(0, item.filepath.lastIndexOf('\\')) || '')}
              >
                {renderThumbnail(item)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/90 truncate">{item.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {item.isMissing ? (
                    <span className="text-[10px] font-bold text-red-400/80 uppercase tracking-wider">
                      {t('Missing', 'Removido')}
                    </span>
                  ) : (
                    <p className="text-xs text-white/35 truncate">
                      {isEnglish ? 'Completed' : 'Concluído'} {formatRelativeTime(item.completedAt)}
                      {item.sizeLabel ? ` • ${item.sizeLabel}` : ''}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {item.isMissing && (
                  <button 
                    onClick={() => onRedownload(item)}
                    className="px-3 py-1.5 rounded-lg bg-yellow-400/10 hover:bg-yellow-400/20 text-yellow-500 text-[10px] font-bold transition-all uppercase tracking-wider"
                  >
                    {t('Redownload', 'Baixar de Novo')}
                  </button>
                )}
                <button 
                  onClick={async (e) => { 
                    e.stopPropagation(); 
                    try { 
                      const folder = (item.filepath && item.filepath.length > 3) 
                        ? item.filepath.substring(0, item.filepath.lastIndexOf('\\')) 
                        : downloadPath; 
                      if (folder) await onOpenFolder(folder); 
                    } catch (error) { 
                      console.error('Erro ao abrir pasta:', error); 
                    } 
                  }} 
                  className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all duration-150 cursor-pointer"
                >
                  <FolderOpen size={15} className="text-white/50 hover:text-white/80 transition-colors" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
