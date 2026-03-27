import React from 'react';
import { useState, useMemo } from 'react';
import {
  Folder,
  Download,
  Settings,
  Gauge,
  ChevronDown,
  Pause,
  X,
  Film,
  Music,
  MoreVertical,
  Play,
  Search
} from 'lucide-react';
import SettingsScreen from './SettingsScreen';
import { DownloadManager } from './DownloadManager';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('search');
  const [isDownloading, setIsDownloading] = useState(false);
  const [url, setUrl] = useState('');
  const [progressText, setProgressText] = useState('');
  const [downloadPath, setDownloadPath] = useState('');

  const downloadManager = useMemo(() => new DownloadManager(), []);

  const handleDownloadClick = async () => {
    if (!url) return;
    setIsDownloading(true);
    try {
      await downloadManager.startDownload(url, '1080p', downloadPath, (progress) => {
        console.log(progress);
        setProgressText(progress);
      });
    } catch (error) {
      console.error(error);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-white font-sans selection:bg-white/20">
      {/* Sidebar */}
      <aside className="w-64 bg-[#111111] border-r border-white/5 flex flex-col justify-between shrink-0">
        <div>
          {/* Logo */}
          <div className="p-8 flex items-center gap-3">
            <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
               <Download className="w-4 h-4 text-[#111111]" strokeWidth={3} />
            </div>
            <span className="font-bold tracking-widest text-lg">PASTEPULL</span>
          </div>

          {/* Navigation */}
          <nav className="px-4 space-y-1">
            <button 
              onClick={() => setCurrentScreen('search')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${currentScreen === 'search' ? 'bg-[#1e1e1e] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
            >
              <Search className="w-4 h-4" />
              SEARCH
            </button>
            <button 
              onClick={() => setCurrentScreen('downloads')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${currentScreen === 'downloads' ? 'bg-[#1e1e1e] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
            >
              <Download className="w-4 h-4" />
              DOWNLOADS
            </button>
            <button 
              onClick={() => setCurrentScreen('settings')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${currentScreen === 'settings' ? 'bg-[#1e1e1e] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
            >
              <Settings className="w-4 h-4" />
              SETTINGS
            </button>
          </nav>
        </div>

        {/* Global Speed */}
        <div className="p-4">
          <div className="bg-[#171717] rounded-xl p-4 border border-white/5">
            <div className="flex items-center gap-2 text-white/50 mb-2">
              <Gauge className="w-4 h-4" />
              <span className="text-[10px] font-bold tracking-widest">GLOBAL SPEED</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold">0.0</span>
              <span className="text-xs text-white/50 font-medium">MB/s</span>
            </div>
          </div>
        </div>
        </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between p-8">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold capitalize">{currentScreen}</h1>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-8 pt-12">
          <div className="max-w-3xl mx-auto space-y-12">
            
            {currentScreen === 'search' && (
            <>
            {/* Hero Section */}
            <div className="text-center space-y-4">
              <h2 className="text-4xl font-bold tracking-tight">PastePull</h2>
              <p className="text-white/50 text-lg">Enter a URL and download it :).</p>
            </div>

            {/* Input Section */}
            <div className="space-y-4">
              <input 
                type="text" 
                placeholder="Paste your link here (YouTube, TikTok, Reddit...)" 
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-white/5 rounded-xl px-6 py-5 text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-all"
              />
              <div className="flex gap-4">
                <button className="flex-1 flex items-center justify-between bg-[#1a1a1a] border border-white/5 rounded-xl px-6 py-4 hover:bg-[#222] transition-colors">
                  <span className="text-xs font-bold tracking-wider">1080P HIGH DEFINITION</span>
                  <ChevronDown className="w-4 h-4 text-white/50" />
                </button>
                <button onClick={handleDownloadClick} className="flex-1 bg-[#2a2a2a] hover:bg-[#333] text-white rounded-xl px-6 py-4 font-bold tracking-wider text-sm transition-colors">
                  DOWNLOAD
                </button>
              </div>
            </div>

            {/* Active Download */}
            {isDownloading && (
            <div className="bg-[#171717] border border-white/5 rounded-2xl p-6 flex items-center gap-6">
              <div className="w-16 h-16 bg-[#222] rounded-xl flex items-center justify-center relative overflow-hidden group shrink-0">
                {/* Abstract pattern placeholder */}
                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white to-transparent"></div>
                <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, #fff 2px, #fff 4px)' }}></div>
                <Play className="w-6 h-6 text-white relative z-10" fill="currentColor" />
              </div>
              
              <div className="flex-1 space-y-3">
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-[10px] font-bold tracking-widest text-white/50 mb-1">ACTIVE DOWNLOAD</div>
                    <div className="font-semibold text-lg">video_name.mp4</div>
                  </div>
                  <div className="text-xl font-bold">45%</div>
                </div>
                
                {/* Progress Bar */}
                <div className="h-1.5 w-full bg-[#2a2a2a] rounded-full overflow-hidden">
                  {/* Using #ffcb05 as requested in the text prompt for the progress bar, though the image shows white. 
                      I will use a gradient to blend the requested color with the visual style. */}
                  <div className="h-full bg-gradient-to-r from-white to-[#ffcb05] rounded-full" style={{ width: '45%' }}></div>
                </div>
              </div>

              <div className="flex items-center gap-4 ml-4 shrink-0">
                <button className="text-white/50 hover:text-white transition-colors">
                  <Pause className="w-5 h-5" fill="currentColor" />
                </button>
                <button className="text-white/50 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            )}

            {/* Recent Activity */}
            <div className="pt-8">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-semibold">Recent Activity</h3>
                <button className="text-[10px] font-bold tracking-widest text-white/50 hover:text-white transition-colors">
                  VIEW HISTORY
                </button>
              </div>

              <div className="space-y-2">
                {/* Item 1 */}
                <div className="flex items-center gap-4 group hover:bg-[#141414] p-3 -mx-3 rounded-xl transition-colors cursor-pointer">
                  <div className="w-12 h-12 bg-[#1a1a1a] border border-white/5 rounded-lg flex items-center justify-center text-white/50 group-hover:text-white transition-colors shrink-0">
                    <Film className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-sm">Cinephile_Review_04.mkv</div>
                    <div className="text-xs text-white/40 mt-0.5">Completed 2 hours ago • 2.4 GB</div>
                  </div>
                  <button className="text-white/30 hover:text-white p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <MoreVertical className="w-5 h-5" />
                  </button>
                </div>

                {/* Item 2 */}
                <div className="flex items-center gap-4 group hover:bg-[#141414] p-3 -mx-3 rounded-xl transition-colors cursor-pointer">
                  <div className="w-12 h-12 bg-[#1a1a1a] border border-white/5 rounded-lg flex items-center justify-center text-white/50 group-hover:text-white transition-colors shrink-0">
                    <Music className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-sm">Night_Drive_Playlist.mp3</div>
                    <div className="text-xs text-white/40 mt-0.5">Completed 5 hours ago • 142 MB</div>
                  </div>
                  <button className="text-white/30 hover:text-white p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <MoreVertical className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            </>
            )}

            {currentScreen === 'downloads' && (
              <div className="text-center text-white/50 py-12">
                Downloads screen coming soon
              </div>
            )}

            {currentScreen === 'settings' && (
              <SettingsScreen downloadPath={downloadPath} onDownloadPathChange={setDownloadPath} />
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
