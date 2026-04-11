import { useState, useEffect, useRef, useCallback } from 'react';
import type { DownloadHistoryItem, Settings } from '../types';

const defaultSettings: Settings = {
  theme: 'dark',
  soundEnabled: false,
  desktopNotification: false,
  maxDownloads: 3,
  useBrowserCookies: false,
};

export function createAppState() {
  const [downloadItems, setDownloadItems] = useState<DownloadHistoryItem[]>([]);
  const downloadItemsRef = useRef<DownloadHistoryItem[]>(downloadItems);
  const activeDownloadsRef = useRef<Set<string>>(new Set());
  const thumbnailCache = useRef<Record<string, string>>({});
  const saveHistoryRef = useRef<(items: DownloadHistoryItem[]) => void>(() => {});
  const settingsRef = useRef<Settings>(defaultSettings);
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = localStorage.getItem('ud_settings');
    return saved ? JSON.parse(saved) : defaultSettings;
  });

  useEffect(() => {
    downloadItemsRef.current = downloadItems;
  }, [downloadItems]);

  useEffect(() => {
    localStorage.setItem('ud_settings', JSON.stringify(settings));
    settingsRef.current = settings;
  }, [settings]);

  return {
    downloadItems,
    setDownloadItems,
    downloadItemsRef,
    activeDownloadsRef,
    thumbnailCache,
    saveHistoryRef,
    settingsRef,
    settings,
    setSettings,
  };
}