import { useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Film, Music, FileDown, FolderOpen, Clock, HardDrive, Video, Search, Trash2, CheckSquare, Square } from 'lucide-react';
import { DownloadHistoryItem } from '../types';
import { formatRelativeTime, inferFileType } from '../utils/formatters';
import { isEnglish, t } from '../utils/i18n';

interface HistoryListProps {
  items: DownloadHistoryItem[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  showArchive: boolean;
  sortOrder: 'newest' | 'oldest';
  onItemClick: (item: DownloadHistoryItem) => void;
  onRedownload: (item: DownloadHistoryItem) => void;
  onOpenFolder: (filepath: string) => void;
  downloadPath: string;
  selectedItems: string[];
  setSelectedItems: (ids: string[]) => void;
  onDelete: (item: DownloadHistoryItem) => void;
}

export function HistoryList({
  items,
  searchQuery,
  setSearchQuery,
  showArchive,
  sortOrder,
  onItemClick,
  onRedownload,
  onOpenFolder,
  downloadPath,
  selectedItems,
  setSelectedItems,
  onDelete,
}: HistoryListProps) {
  const selectionMode = selectedItems.length > 0;
  
  const filteredItems = useMemo(() => {
    return items
      .filter((item) => 
        item.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .sort((a, b) => sortOrder === 'oldest' ? a.completedAt - b.completedAt : b.completedAt - a.completedAt);
  }, [items, searchQuery, sortOrder]);

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
    <div className="space-y-6">
      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
            <Search size={24} className="text-white/20" />
          </div>
          <p className="text-white/40">
            {t('No downloads completed yet. Let\'s go!', 'Nenhum download concluído ainda. Vamos a isso!')}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredItems.map((item) => (
            <div 
              key={item.filepath || item.id} 
              className={`group flex flex-col sm:flex-row items-center gap-4 p-4 bg-[#1a1a1a] border border-white/5 rounded-2xl hover:bg-[#1e1e1e] transition-colors ${selectionMode ? 'cursor-default' : ''}`}
              onClick={() => !selectionMode && onItemClick(item)}
            >
              <div className="shrink-0 flex items-center gap-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (selectedItems.includes(item.id)) {
                      setSelectedItems(selectedItems.filter(id => id !== item.id));
                    } else {
                      setSelectedItems([...selectedItems, item.id]);
                    }
                  }}
                  className="text-white/40 hover:text-white transition-colors"
                >
                  {selectedItems.includes(item.id) ? <CheckSquare size={20} /> : <Square size={20} />}
                </button>
                <div className="w-full sm:w-32 h-20 rounded-lg overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center">
                  {renderThumbnail(item)}
                </div>
              </div>
              <div className="flex-1 min-w-0 w-full space-y-1">
                <h3 className="text-sm font-semibold text-white/90 line-clamp-2" title={item.title}>
                  {item.title}
                </h3>
                <p className="text-[10px] text-white/30 truncate font-medium" title={item.filepath}>
                  {item.filepath ? (
                    item.filepath.includes('\\') 
                      ? item.filepath.substring(0, item.filepath.lastIndexOf('\\')) 
                      : item.filepath.substring(0, item.filepath.lastIndexOf('/'))
                  ) : ''}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-white/40">
                  <span className="flex items-center gap-1.5 text-white/60 font-bold tracking-widest uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/60"></span>
                    <Clock size={10} />
                    {formatRelativeTime(item.completedAt)}
                  </span>
                  {item.sizeLabel && (
                    <span className="flex items-center gap-1.5 text-white/60 font-bold tracking-widest uppercase">
                      <span className="w-1.5 h-1.5 rounded-full bg-white/60"></span>
                      <HardDrive size={10} />
                      {item.sizeLabel}
                    </span>
                  )}
                  {item.quality && (
                    <span className="flex items-center gap-1.5 text-white/60 font-bold tracking-widest uppercase">
                      <span className="w-1.5 h-1.5 rounded-full bg-white/60"></span>
                      <Video size={10} />
                      {item.quality.replace('P VIDEO', 'P').replace('P video', 'P')}
                    </span>
                  )}
                  {item.ext && (
                    <span className="flex items-center gap-1.5 text-white/60 font-bold tracking-widest uppercase">
                      <span className="w-1.5 h-1.5 rounded-full bg-white/60"></span>
                      <FileDown size={10} />
                      {item.ext}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 w-full sm:w-auto flex justify-end gap-2">
                {item.status === 'deleted' ? (
                  <button 
                    onClick={(e) => { e.stopPropagation(); onRedownload(item); }}
                    className="px-4 py-2.5 rounded-lg bg-yellow-400/10 hover:bg-yellow-400/20 text-yellow-500 text-xs font-bold transition-all uppercase tracking-wider"
                  >
                    {t('Redownload', 'Baixar de Novo')}
                  </button>
                ) : (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      const folder = item.filepath.substring(0, Math.max(item.filepath.lastIndexOf('\\'), item.filepath.lastIndexOf('/'))) || downloadPath || '';
                      onOpenFolder(folder);
                    }} 
                    className="flex items-center gap-2 bg-white/5 hover:bg-white/10 px-4 py-2.5 rounded-lg transition-colors text-xs font-semibold text-white/70 hover:text-white"
                  >
                    <FolderOpen size={14} />
                    <span>{t('Open Folder', 'Abrir Pasta')}</span>
                  </button>
                )}
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item);
                  }}
                  className="p-2.5 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  title={item.status === 'deleted' ? t('Remove from history', 'Remover do histórico') : t('Move to trash', 'Mover para lixeira')}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
