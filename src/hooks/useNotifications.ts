import { useState, useCallback, useRef } from 'react';

export type NotificationType = 'success' | 'error' | 'warning';

export interface Notification {
  type: NotificationType;
  message: string;
  onClick?: () => void;
}

export function useNotifications() {
  const [notification, setNotification] = useState<Notification | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const showNotification = useCallback((
    type: NotificationType, 
    message: string, 
    duration: number = 5000,
    onClick?: () => void
  ) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setNotification({ type, message, onClick });
    timeoutRef.current = window.setTimeout(() => {
      setNotification(null);
    }, duration);
  }, []);

  const clearNotification = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setNotification(null);
  }, []);

  const success = useCallback((message: string, duration: number = 5000) => {
    showNotification('success', message, duration);
  }, [showNotification]);

  const error = useCallback((message: string, duration: number = 5000) => {
    showNotification('error', message, duration);
  }, [showNotification]);

  const warning = useCallback((message: string, duration: number = 5000, onClick?: () => void) => {
    showNotification('warning', message, duration, onClick);
  }, [showNotification]);

  return {
    notification,
    setNotification,
    clearNotification,
    showNotification,
    success,
    error,
    warning,
  };
}
