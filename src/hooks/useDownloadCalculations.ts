import { useMemo } from 'react';
import type { DownloadHistoryItem, DownloadProgress } from '../types';
import { t } from '../utils/i18n';

export function useDownloadCalculations(
  downloadItems: DownloadHistoryItem[],
  currentProgress: Record<string, DownloadProgress> | null,
  searchQuery: string,
  sortOrder: 'newest' | 'oldest'
) {
  const activeDownloads = useMemo(() => {
    return downloadItems.filter((item) => item.status === 'active');
  }, [downloadItems]);

  const deletedDownloads = useMemo(() => {
    return downloadItems.filter((item) => item.status === 'deleted');
  }, [downloadItems]);

  const filteredItems = useMemo(() => {
    let items = sortOrder === 'newest'
      ? [...downloadItems].sort((a, b) => b.completedAt - a.completedAt)
      : [...downloadItems].sort((a, b) => a.completedAt - b.completedAt);

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      items = items.filter((item) => {
        const titleMatch = item.title?.toLowerCase().includes(query);
        const filenameMatch = item.filename?.toLowerCase().includes(query);
        const urlMatch = item.url?.toLowerCase().includes(query);
        return titleMatch || filenameMatch || urlMatch;
      });
    }

    return items;
  }, [downloadItems, searchQuery, sortOrder]);

  const activeCount = useMemo(() => {
    if (!currentProgress) return 0;
    return Object.values(currentProgress).filter(
      (p) => !['completed', 'error', 'skipped', 'converting'].includes(p.status)
    ).length;
  }, [currentProgress]);

  const currentProgressList = useMemo(() => {
    if (!currentProgress) return [];
    return Object.values(currentProgress) as DownloadProgress[];
  }, [currentProgress]);

  return {
    activeDownloads,
    deletedDownloads,
    filteredItems,
    activeCount,
    currentProgressList,
  };
}