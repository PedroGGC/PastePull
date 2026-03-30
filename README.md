# PastePull (Universal Downloader)

PastePull is a high-performance, universal video and audio downloader built with **Tauri**, **Rust**, and **React**. It abstracts the complexity of `yt-dlp` into a beautiful, buttery-smooth user interface with real-time progress tracking, thumbnail extraction, and download history management.

> 🚀 **V1.0.2 Release:** The application is now ready for production bundling with fully embedded dependencies.
    
## Features

- **Universal Support:** Download media from YouTube, Twitter/X, Reddit, TikTok, LinkedIn, and hundreds of other platforms natively supported by `yt-dlp`.
- **Media Type & Smart Extraction:** Automatically selects and displays the best streams for Video or Audio specifically.
- **Dynamic Quality Filtering:** A drop-down menu that populates in real-time with available resolutions exclusively for the selected media type after metadata is scouted.
- **I18n Natively:** The UI senses your system language and automatically adjusts timestamps and interface copy seamlessly between English and Portuguese.
- **Real-Time Global Speed & Strict Throttling:** Breathtaking display of real-time network speeds, optimized safely under the hood through Tauri IPC debouncing to maintain zero CPU-lag.
- **Download History:** Visual history tracking with 16:9 thumbnail previews, standardized file size tags (MB/GB), exact download extension identifiers, and one-click "Open Folder" OS-integration. The system retains exactly the latest 100 historical downloads logic.
- **Missing File Detection:** Automatically detects when downloaded files are deleted from disk and shows a "Missing" status with one-click "Redownload" option.
- **Persistent History:** Download history is securely backed up to AppData, surviving app reinstalls.
- **Real-Time Sync:** File status syncs automatically across Search and Downloads screens.

## Technology Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Lucide React (Icons).
- **Backend:** Rust (Tauri 2.0.0), Tokio.
- **Core Engine:** `yt-dlp` (Video extraction) + `ffmpeg` (Stream merging).
- **Bundler:** Vite.

## Usage

PastePull is now distributed as a standalone executable (`.exe`). It bundles the core `yt-dlp` engine safely inside its secure resource scope using Tauri's `AppHandle.path().resource_dir()`, maintaining strict portability. Setup paths have been removed completely for production!

Dev Note: For the engine to work correctly and multiplex 1080p+ Video/Audio natively during development, make sure ffmpeg.exe is available on your Windows PATH.

## Architecture Notes

- **Event Loop & Progress (Debounced):** The Rust backend spawns `yt-dlp` in a child process using `Command`, piping `stdout` to parse log fragments. To protect the React GUI from Main-Thread lockups, the structural events (`download-progress`) sent over IPC are rigorously throttled (delta >= `1%` OR `> 100ms`).
- **State Management & Pattern Matching:** The backend replaces `if/else` checks with hard-fought Rust `match` clauses. The frontend operates with an explicit logic lock prior to full metadata resolution, preserving visual integrity and safely managing local arrays up to a `100` element queue.

---

_Built for personal use but I decided to share it._
