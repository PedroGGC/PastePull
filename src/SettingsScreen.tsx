import React, { useState, useEffect } from 'react';
import { Sliders, FolderOpen, Bell, Bolt } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';

interface SettingsScreenProps {
  downloadPath: string;
  onDownloadPathChange: (path: string) => void;
}

export default function SettingsScreen({ downloadPath, onDownloadPathChange }: SettingsScreenProps) {
  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Download Folder'
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
              <h3 className="font-semibold text-lg mb-1">General</h3>
              <p className="text-white/50 text-sm mb-4">Visual themes and general application settings</p>
              
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Dark Mode</div>
                  <div className="text-white/40 text-sm">Switch between light and dark visual themes.</div>
                </div>
                <button className="w-12 h-6 bg-[#2a2a2a] rounded-full relative transition-colors">
                  <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full transition-transform"></div>
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
              <h3 className="font-semibold text-lg mb-1">Download Path</h3>
              <p className="text-white/50 text-sm mb-4">Choose where downloaded MP3s or MP4s are saved.</p>
              
              <div className="flex items-center gap-4">
                <div className="flex-1 bg-[#1a1a1a] border border-white/5 rounded-lg px-4 py-3 text-white/70 text-sm font-mono truncate">
                  {downloadPath || 'No folder selected'}
                </div>
                <button onClick={handleBrowse} className="bg-[#2a2a2a] hover:bg-[#333] px-4 py-3 rounded-lg text-sm font-semibold transition-colors">
                  Browse
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
              <h3 className="font-semibold text-lg mb-1">Notifications</h3>
              <p className="text-white/50 text-sm mb-4">Alerts and sound settings for completions or errors.</p>
              
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" className="w-5 h-5 rounded border-white/20 bg-[#1a1a1a]" />
                  <span className="text-white/70">Sound when finished</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" className="w-5 h-5 rounded border-white/20 bg-[#1a1a1a]" />
                  <span className="text-white/70">Desktop notification on error</span>
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
              <h3 className="font-semibold text-lg mb-1">Advanced</h3>
              <p className="text-white/50 text-sm mb-4">Deep-level application behavior and process settings.</p>
              
              <div className="flex items-center gap-4">
                <span className="text-white/70">Max simultaneous downloads</span>
                <input 
                  type="number" 
                  defaultValue={3}
                  className="w-20 bg-[#1a1a1a] border border-white/5 rounded-lg px-4 py-2 text-white text-center focus:outline-none focus:ring-1 focus:ring-white/20"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}