#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;
mod downloader;
mod process;
mod types;
mod utils;
mod watcher;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::info;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use commands::{
    cancel_download, check_files_exist, get_video_metadata, load_history,
    move_multiple_to_trash, open_folder_natively, pause_download, read_thumbnail_as_base64, resolve_paths, save_history,
    scan_download_folder, select_download_folder, start_download, find_file_by_title,
};
use watcher::{check_file_exists, check_files_in_folder, start_file_watcher};
use types::SharedDownloadState;

fn main() {
    tracing_subscriber::registry()
        .with(fmt::layer())
        .with(EnvFilter::from_default_env().add_directive(tracing::Level::INFO.into()))
        .init();

    info!("Starting PastePull application");

    let download_state: SharedDownloadState = Arc::new(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        .manage(download_state)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            start_download,
            cancel_download,
            pause_download,
            select_download_folder,
            get_video_metadata,
            open_folder_natively,
            find_file_by_title,
            read_thumbnail_as_base64,
            check_files_exist,
            resolve_paths,
            move_multiple_to_trash,
            scan_download_folder,
            save_history,
            load_history,
            check_file_exists,
            check_files_in_folder,
            start_file_watcher
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar o aplicativo Tauri");
}
