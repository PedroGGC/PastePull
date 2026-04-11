# <img src="./Logo-Bg_Big.png" width="32" align="center"> PastePull

A high-performance, universal video and audio downloader built with **Tauri**, **Rust**, and **React**. It abstracts the complexity of `yt-dlp` into a beautiful, buttery-smooth user interface with real-time progress tracking, thumbnail extraction, and download history management.

> 🚀 **V1.2.0 Release:** Production-ready with performance optimizations and bug fixes.

## Features

- **Universal Support:** Download media from YouTube, Twitter/X, Reddit, TikTok, LinkedIn, and hundreds of other platforms natively supported by `yt-dlp`.
- **Multi-Download:** Run up to 3 simultaneous downloads with individual progress tracking.
- **Media Type & Smart Extraction:** Automatically selects and displays the best streams for Video or Audio specifically.
- **Dynamic Quality Filtering:** Drop-down menu populated in real-time with available resolutions for the selected media type.
- **I18n Natively:** UI senses your system language and automatically adjusts timestamps and interface copy between English and Portuguese.
- **Real-Time Global Speed:** Display of real-time network speeds, optimized through Tauri IPC debouncing for zero CPU-lag.
- **Download History:** Visual history tracking with 16:9 thumbnail previews, standardized file size tags, and one-click "Open Folder" integration. Retains the latest 100 downloads.
- **Missing File Detection:** Automatically detects when downloaded files are deleted from disk and shows a "Deleted" status with one-click "Redownload" option.
- **Persistent History:** Download history securely backed up to AppData, surviving app reinstalls.
- **Real-Time Sync:** File watcher monitors the download folder and automatically syncs file status changes.

## Technology Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Lucide React.
- **Backend:** Rust (Tauri 2.0.0), Tokio.
- **Core Engine:** `yt-dlp` + `ffmpeg`.
- **Bundler:** Vite.

## Requirements

- **OS:** Windows 10 or 11 (64-bit)
- **Runtime:** WebView2 (bundled with Windows 10/11)

## Usage

Download the latest release from the [Releases page](https://github.com/PedroGGC/PastePull/releases). The executable bundles `yt-dlp` and `ffmpeg` internally - no additional setup required.

## Architecture Notes

- **Event Loop & Progress (Debounced):** Rust backend spawns `yt-dlp` in a child process, piping stdout to parse log fragments. IPC events are throttled (delta >= `1%` OR `> 100ms`) to prevent React GUI lockups.
- **File Watcher:** Polls download folder every 2 seconds to detect file additions/deletions in real-time.
- **Fuzzy Matching:** Uses ASCII-alphanumeric normalization for robust file matching across history.

---

_Built for personal use but I decided to share it._
