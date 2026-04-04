import { motion, AnimatePresence } from 'motion/react';
import { X, Trash2 } from 'lucide-react';
import { t } from '../utils/i18n';
import { DownloadHistoryItem } from '../types';

interface NotificationToastProps {
  notification: {
    type: 'success' | 'error' | 'warning';
    message: string;
    onClick?: () => void;
  } | null;
  onClose: () => void;
}

export function NotificationToast({ notification, onClose }: NotificationToastProps) {
  return (
    <AnimatePresence>
      {notification && (
        <motion.div 
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className={`fixed top-6 right-6 px-6 py-4 rounded-xl shadow-2xl z-50 border backdrop-blur-md flex items-center gap-4 min-w-[320px] max-w-md ${notification.onClick ? 'cursor-pointer hover:brightness-110' : ''} ${notification.type === 'warning' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' : notification.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}
          onClick={notification.onClick}
        >
          <div className="flex-1 font-medium text-sm">{notification.message}</div>
          <button onClick={onClose} className="opacity-60 hover:opacity-100 transition-opacity p-1.5 hover:bg-white/10 rounded-md shrink-0"><X size={16} /></button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface CancelModalProps {
  cancelingId: string | null;
  onClose: () => void;
  onConfirm: (id: string) => void;
}

export function CancelModal({ cancelingId, onClose, onConfirm }: CancelModalProps) {
  return (
    <AnimatePresence>
      {cancelingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} className="bg-[#1a1a1a] border border-white/10 p-6 rounded-2xl shadow-2xl max-w-sm w-full">
            <div className="flex items-center gap-3 text-red-400 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-400/10 flex items-center justify-center"><X size={20} /></div>
              <h3 className="text-lg font-bold text-white">{t('Cancel Download?', 'Cancelar Download?')}</h3>
            </div>
            <p className="text-white/60 text-sm mb-6">{t('Are you sure you want to cancel the download? Current progress will be lost.', 'Tem certeza que deseja cancelar o download? O progresso atual será perdido.')}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-white/70 hover:text-white hover:bg-white/5 transition-colors">{t('Go Back', 'Voltar')}</button>
              <button 
                onClick={() => {
                  const tid = cancelingId;
                  onClose();
                  onConfirm(tid);
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-500 hover:bg-red-600 text-white transition-colors"
              >{t('Yes, Cancel', 'Sim, Cancelar')}</button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

interface DeleteModalProps {
  modal: {
    show: boolean;
    items: DownloadHistoryItem[];
    mode: 'trash' | 'history';
  } | null;
  isDeleting: boolean;
  onClose: () => void;
  onConfirmMoveToTrash: (items: DownloadHistoryItem[]) => Promise<void>;
  onConfirmRemoveFromHistory: (items: DownloadHistoryItem[]) => void;
}

export function DeleteModal({ modal, isDeleting, onClose, onConfirmMoveToTrash, onConfirmRemoveFromHistory }: DeleteModalProps) {
  if (!modal?.show) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} className="bg-[#1a1a1a] border border-white/10 p-6 rounded-2xl shadow-2xl max-w-sm w-full">
          <div className="flex items-center gap-3 text-red-400 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-400/10 flex items-center justify-center"><Trash2 size={20} /></div>
            <h3 className="text-lg font-bold text-white">
              {modal.mode === 'trash' 
                ? t('Move to trash?', 'Mover para lixeira?') 
                : t('Remove from history?', 'Remover do histórico?')}
            </h3>
          </div>
          <p className="text-white/60 text-sm mb-6">
            {modal.mode === 'trash'
              ? t(`Are you sure you want to move ${modal.items.length} item(s) to trash?`, `Tem certeza que deseja mover ${modal.items.length} item(s) para a lixeira?`)
              : t(`Are you sure you want to remove ${modal.items.length} item(s) from history?`, `Tem certeza que deseja remover ${modal.items.length} item(s) do histórico?`)}
          </p>
          <div className="flex gap-3 justify-end">
            <button 
              onClick={onClose} 
              disabled={isDeleting}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white/70 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              {t('Cancel', 'Cancelar')}
            </button>
            <button 
              onClick={async () => {
                if (modal.mode === 'trash') {
                  await onConfirmMoveToTrash(modal.items);
                } else {
                  onConfirmRemoveFromHistory(modal.items);
                }
              }}
              disabled={isDeleting}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-500 hover:bg-red-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isDeleting ? (
                <>
                  <span className="animate-spin">⟳</span>
                  {t('DELETANDO...', 'DELETANDO...')}
                </>
              ) : (
                modal.mode === 'trash' ? t('Move to trash', 'Mover para lixeira') : t('Remove', 'Remover')
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
