import { useState, useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { DownloadHistoryItem } from '../types';
import { safeBtoa, normalizeFilepath } from '../utils/helpers';

export function useDownloadHistory() {
  const [downloadItems, setDownloadItems] = useState<DownloadHistoryItem[]>([]);
  const processingDeleteRef = useRef(new Set<string>());
  const activeDownloadsRef = useRef<Set<string>>(new Set());

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveHistoryToBackend = useCallback((items: DownloadHistoryItem[]) => {
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = setTimeout(async () => {
      try { 
        await invoke('save_history', { items: items.slice(0, 1000) }); 
      } catch (err) {
        console.error('[History] Save failed:', err);
      }
    }, 800);
  }, []);

  const saveHistoryRef = useRef(saveHistoryToBackend);

  const loadHistory = useCallback(async () => {
    try {
      const items = await invoke<DownloadHistoryItem[]>('load_history');
      setDownloadItems(items);
      
      const savedPath = localStorage.getItem('ud_download_path');
      if (savedPath) {
        await invoke('start_file_watcher', { path: savedPath });
      }
      
      return items;
    } catch (err) {
      console.error('[History] Load failed:', err);
      return [];
    }
  }, []);

  const addHistoryItem = useCallback((item: DownloadHistoryItem) => {
    setDownloadItems(prev => {
      const newList = [item, ...prev];
      const seen = new Set<string>();
      const deduped = newList.filter(i => {
        const key = i.filepath?.toLowerCase() || i.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      saveHistoryRef.current(deduped);
      return deduped;
    });
  }, []);

  const updateHistoryItem = useCallback((id: string, updates: Partial<DownloadHistoryItem>) => {
    setDownloadItems(prev => {
      const updated = prev.map(item => 
        item.id === id ? { ...item, ...updates } : item
      );
      saveHistoryRef.current(updated);
      return updated;
    });
  }, []);

  const removeHistoryItem = useCallback((ids: string[]) => {
    setDownloadItems(prev => {
      const updated = prev.filter(item => !ids.includes(item.id));
      saveHistoryRef.current(updated);
      return updated;
    });
  }, []);

  const moveToTrash = useCallback(async (items: DownloadHistoryItem[]) => {
    try {
      const paths = items.map(item => item.filepath);
      await invoke('move_multiple_to_trash', { paths });
    } catch (err) {
      console.error('Error moving to trash:', err);
    }
    
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
  }, []);

  const restoreFromTrash = useCallback((items: DownloadHistoryItem[]) => {
    setDownloadItems(prev => {
      const newItems = prev.map(item => {
        if (items.some(i => i.id === item.id)) {
          return { ...item, status: 'active' as const };
        }
        return item;
      });
      saveHistoryRef.current(newItems);
      return newItems;
    });
  }, []);

  const markAsDeleted = useCallback((filepath: string) => {
    if (processingDeleteRef.current.has(filepath)) {
      return;
    }
    processingDeleteRef.current.add(filepath);
    
    setTimeout(() => {
      processingDeleteRef.current.delete(filepath);
      
      const normalizedPath = filepath.replace(/\//g, '\\');
      
      setDownloadItems(prev => {
        const existingItem = prev.find(item => item.filepath === normalizedPath);
        
        const urlFromMemory = existingItem?.url || '';
        const thumbnailFromMemory = existingItem?.thumbnailDataUrl;
        const sizeFromMemory = existingItem?.sizeLabel || '';
        const eventFilename = normalizedPath.split(/[\\/]/).pop() || '';
        const eventFilenameBase = eventFilename.replace(/\.[^.]+$/, ''); 
        const eventExt = eventFilename.split('.').pop()?.toUpperCase() || '';
        const extFromMemory = existingItem?.ext || eventExt;
        const qualityFromMemory = existingItem?.quality || '';

        if (existingItem) {
          const updatedItems = prev.map(item => 
            item.filepath === normalizedPath ? { ...item, status: 'deleted' as const } : item
          );
          saveHistoryRef.current(updatedItems);
          return updatedItems;
        }
        
        return prev;
      });
    });
  }, []);

  const markAsActive = useCallback((filepath: string) => {
    const normalizedPath = normalizeFilepath(filepath);
    
    setDownloadItems(prev => {
      const existingItem = prev.find(item => 
        normalizeFilepath(item.filepath || '') === normalizedPath
      );
      
      if (existingItem) {
        const updated = prev.map(item => {
          if (normalizeFilepath(item.filepath || '') === normalizedPath) {
            return { ...item, status: 'active' as const };
          }
          return item;
        });
        saveHistoryRef.current(updated);
        return updated;
      }
      
      return prev;
    });
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

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
      
      if (action === 'deleted') {
        markAsDeleted(filepath);
      } else if (action === 'restored') {
        markAsActive(filepath);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [markAsDeleted, markAsActive]);

  return {
    downloadItems,
    setDownloadItems,
    loadHistory,
    addHistoryItem,
    updateHistoryItem,
    removeHistoryItem,
    moveToTrash,
    restoreFromTrash,
    markAsDeleted,
    markAsActive,
    activeDownloadsRef,
    saveHistoryToBackend,
  };
}
