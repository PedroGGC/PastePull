# PastePull (Universal Downloader) 🚀

PastePull is a high-performance, universal video and audio downloader built with **Tauri**, **Rust**, and **React**. It abstracts the complexity of `yt-dlp` into a beautiful, buttery-smooth user interface with real-time progress tracking, thumbnail extraction, and download history management.

> ⚠️ **Development Notice:** This application is currently a Work In Progress (WIP). There are no pre-compiled `.exe` binaries available for download yet. You must run the project in a development environment to use it.

## Features

- **Universal Support:** Download videos from YouTube, Twitter/X, Reddit, TikTok, and hundreds of other platforms supported by `yt-dlp`.
- **Intelligent Formatting:** Automatically selects the best video and audio streams and merges them seamlessly without requiring you to use the command line.
- **Real-Time Global Speed:** Dynamic extraction of real-time download speeds displayed directly on the sidebar.
- **Beautiful UX:** Fluid progress bars, native OS notifications, dark-mode focused UI built with Tailwind CSS, and automatic metadata extraction.
- **Rich Download History:** Visual history tracking with 16:9 thumbnail previews, file size formatting, and one-click "Open Folder" native integration.
- **Resilient Engine:** Rust backend with memory-safe `stdout` parsing, bypassing common Windows pipe encoding issues.

## Technology Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Lucide React (Icons).
- **Backend:** Rust (Tauri 2.0.0), Tokio.
- **Core Engine:** `yt-dlp` (Video extraction) + `ffmpeg` (Stream merging).
- **Bundler:** Vite.

## Usage

PastePull is distributed as a standalone executable. Simply open the app, paste your desired video or audio link into the search bar, select your quality preference, and hit Download!

_Note: For the engine to work correctly, make sure `yt-dlp.exe` and `ffmpeg.exe` are present in your system or running folder._

## Architecture Notes

- **Event Loop & Progress:** The Rust backend spawns `yt-dlp` in a child process, writing its output to temporary files to sidestep Windows CP1252/Unicode pipe crashes. The backend then polls these files, parses the progress via Regex, and emits structured events (`download-progress`) to the React frontend.
- **State Management:** The React frontend maintains a localized history (`localStorage`) and strictly synchronizes the active download card with the 100% completion state before discarding it to the "Downloads" screen to guarantee a pleasant UX.

---

_Built tightly and safely for speed and reliability._
