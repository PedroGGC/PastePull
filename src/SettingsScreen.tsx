import React from 'react';
import { motion } from 'motion/react';
import { Sliders, FolderOpen, Bell, Bolt, Cookie, Moon, Sun } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { Settings } from './types';

interface SettingsScreenProps {
  downloadPath: string;
  onDownloadPathChange: (path: string) => void;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
}

const isEnglish = navigator.language.toLowerCase().startsWith('en');
function t(en: string, pt: string) { return isEnglish ? en : pt; }

export default function SettingsScreen({ downloadPath, onDownloadPathChange, settings, setSettings }: SettingsScreenProps) {
  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('Select Download Folder', 'Selecionar Pasta de Download')
      });
      if (selected && typeof selected === 'string') {
        onDownloadPathChange(selected);
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-white/50 mb-6">
        <Sliders className="w-4 h-4" />
        <span className="text-[10px] font-bold tracking-widest">SETTINGS</span>
      </div>

      <div className="space-y-6 max-w-2xl">
        {/* General */}
        <div className="bg-[#171717] border border-white/5 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-[#222] rounded-lg flex items-center justify-center shrink-0">
              <Sliders className="w-5 h-5 text-white/70" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-lg mb-1">{t('General', 'Gerais')}</h3>
              <p className="text-white/50 text-sm mb-4">{t('Visual themes and general application settings', 'Temas visuais e configurações gerais da aplicação.')}</p>
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{t('Dark Mode', 'Modo Escuro')}</div>
                  <div className="text-white/40 text-sm">{t('Switch between light and dark visual themes.', 'Alternar entre temas visuais claros e escuros.')}</div>
                </div>
                <button 
                  onClick={() => setSettings(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))}
                  className={`w-12 h-6 rounded-full relative ${settings.theme === 'dark' ? 'bg-white' : 'bg-[#2a2a2a]'}`}
                >
                  <motion.div
                    className="absolute top-1 w-4 h-4 flex items-center justify-center"
                    animate={{ x: settings.theme === 'dark' ? 25 : 5, rotate: settings.theme === 'dark' ? 0 : 180 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  >
                    {settings.theme === 'dark' ? (
                      <Moon className="w-4 h-4 text-black" strokeWidth={4.0} />
                    ) : (
                      <Sun className="w-4 h-4 text-black" strokeWidth={4.0} />
                    )}
                  </motion.div>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Download Path */}
        <div className="bg-[#171717] border border-white/5 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-[#222] rounded-lg flex items-center justify-center shrink-0">
              <FolderOpen className="w-5 h-5 text-white/70" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-lg mb-1">{t('Download Path', 'Caminho de Download')}</h3>
              <p className="text-white/50 text-sm mb-4">{t('Choose where downloaded MP3s or MP4s are saved.', 'Escolha onde os downloads em MP3 ou MP4 serão salvos.')}</p>
              
              <div className="flex items-center gap-4">
                <div className="flex-1 bg-[#1a1a1a] border border-white/5 rounded-lg px-4 py-3 text-white/70 text-sm font-mono truncate">
                  {downloadPath || t('No folder selected', 'Nenhuma pasta selecionada')}
                </div>
                <button onClick={handleBrowse} className="bg-[#2a2a2a] hover:bg-[#333] px-4 py-3 rounded-lg text-sm font-semibold transition-colors">
                  {t('Browse', 'Procurar')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-[#171717] border border-white/5 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-[#222] rounded-lg flex items-center justify-center shrink-0">
              <Bell className="w-5 h-5 text-white/70" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-lg mb-1">{t('Notifications', 'Notificações')}</h3>
              <p className="text-white/50 text-sm mb-4">{t('Alerts and sound settings for completions or errors.', 'Alertas e configurações de som para conclusões e erros.')}</p>
              
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input 
                    type="checkbox" 
                    checked={settings.soundEnabled}
                    onChange={(e) => setSettings(s => ({ ...s, soundEnabled: e.target.checked }))}
                    className="w-5 h-5 rounded border-white/20 bg-[#1a1a1a] accent-white cursor-pointer" 
                  />
                  <span className="text-white/70 group-hover:text-white transition-colors">{t('Sound when finished', 'Som ao finalizar')}</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input 
                    type="checkbox" 
                    checked={settings.desktopNotification}
                    onChange={async (e) => {
                      const checked = e.target.checked;
                      if (checked) {
                        try {
                          const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
                          let permissionGranted = await isPermissionGranted();
                          if (!permissionGranted) {
                            const permission = await requestPermission();
                            permissionGranted = permission === 'granted';
                          }
                          if (!permissionGranted) {
                            console.warn("Permissão para notificação foi negada.");
                            return; // Don't check the box if denied
                          }
                        } catch (err) {
                           console.error('Notification plugin not available or error:', err);
                        }
                      }
                      setSettings(s => ({ ...s, desktopNotification: checked }));
                    }}
                    className="w-5 h-5 rounded border-white/20 bg-[#1a1a1a] accent-white cursor-pointer" 
                  />
                  <span className="text-white/70 group-hover:text-white transition-colors">{t('Desktop notification on error', 'Notificação via desktop para erros')}</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Advanced */}
        <div className="bg-[#171717] border border-white/5 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-[#222] rounded-lg flex items-center justify-center shrink-0">
              <Bolt className="w-5 h-5 text-white/70" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-lg mb-1">{t('Advanced', 'Avançado')}</h3>
              <p className="text-white/50 text-sm mb-4">{t('Deep-level application behavior and process settings.', 'Comportamento avançado e tarefas em segundo plano.')}</p>
              
              <div className="flex items-center gap-4 mb-4">
                <span className="text-white/70">{t('Max simultaneous downloads', 'Máximo de downloads simultâneos')}</span>
                <input 
                  type="number" 
                  min={1}
                  max={10}
                  value={settings.maxDownloads}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 1;
                    const cappedVal = Math.max(1, Math.min(10, val));
                    setSettings(s => ({ ...s, maxDownloads: cappedVal }));
                  }}
                  className="w-20 bg-[#1a1a1a] border border-white/5 rounded-lg px-4 py-2 text-white text-center focus:outline-none focus:ring-1 focus:ring-white/20"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Cookie className="w-4 h-4 text-white/50" />
                  <span className="text-white/70">{t('Use browser cookies', 'Usar cookies do navegador')}</span>
                </div>
                <button 
                  onClick={() => setSettings(s => ({ ...s, useBrowserCookies: !s.useBrowserCookies }))}
                  className={`w-12 h-6 rounded-full relative ${settings.useBrowserCookies ? 'bg-green-500' : 'bg-[#2a2a2a]'}`}
                >
                  <motion.div
                    className="absolute top-1 w-4 h-4 bg-white rounded-full"
                    animate={{ x: settings.useBrowserCookies ? 24 : 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}