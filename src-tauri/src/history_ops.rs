use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use crate::types::HistoryEntry;

const MAX_HISTORY_ITEMS: usize = 1000;

pub fn save_history(app: AppHandle, mut items: Vec<HistoryEntry>) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let history_dir = app_data.join("persistence");
    if !history_dir.exists() {
        std::fs::create_dir_all(&history_dir).map_err(|e| e.to_string())?;
    }
    let history_file = history_dir.join("history.json");

    items.sort_by(|a, b| b.completed_at.cmp(&a.completed_at));
    if items.len() > MAX_HISTORY_ITEMS {
        items.truncate(MAX_HISTORY_ITEMS);
    }

    let json = serde_json::to_string_pretty(&items).map_err(|e| e.to_string())?;
    std::fs::write(history_file, json).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_history(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let history_file = app_data.join("persistence").join("history.json");

    if !history_file.exists() {
        return Ok(Vec::new());
    }

    let json = std::fs::read_to_string(history_file).map_err(|e| e.to_string())?;
    let items: Vec<HistoryEntry> = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn scan_download_folder(folder_path: String) -> Result<Vec<HistoryEntry>, String> {
    let path = PathBuf::from(folder_path);
    if !path.exists() || !path.is_dir() {
        return Err("Directory does not exist".to_string());
    }

    let mut items = Vec::new();
    let audio_exts = ["mp3", "flac", "aac", "wav", "ogg", "m4a", "opus"];
    let valid_media_exts = ["mp4", "mkv", "avi", "mov", "webm", "flv", "m4v", "ts", "mp3", "flac", "aac", "wav", "ogg", "m4a", "opus"];

    if let Ok(entries) = std::fs::read_dir(&path) {
        let parent = path.clone();
        
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if !entry_path.is_file() {
                continue;
            }

            let filename = entry_path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let ext = entry_path.extension().unwrap_or_default().to_string_lossy().to_string().to_lowercase();

            if !valid_media_exts.contains(&ext.as_str()) {
                continue;
            }

            let lower_filename = filename.to_lowercase();
            let file_stem = entry_path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            
            // Skip .webm that has corresponding converted file with same stem
            if ext == "webm" {
                let has_converted = ["mp3", "m4a", "ogg", "flac", "wav"];
                let converted_exists = has_converted.iter().any(|&e| {
                    parent.join(format!("{}.{}", file_stem, e)).exists()
                });
                if converted_exists {
                    continue;
                }
            }
            
            if lower_filename.contains(".fhls-") || 
               lower_filename.contains(".fdash-") ||
               lower_filename.contains(".fmp4") ||
               lower_filename.contains(".part") {
                continue;
            }

            let file_type = if ["mp4", "mkv", "avi", "mov", "webm", "flv", "m4v", "ts"].contains(&ext.as_str()) {
                "video"
            } else if audio_exts.contains(&ext.as_str()) {
                "audio"
            } else {
                continue;
            };

            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            let completed_at = metadata
                .modified()
                .unwrap_or(std::time::SystemTime::now())
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;

            let size = metadata.len();
            let size_label = if size >= 1024 * 1024 * 1024 {
                format!("{:.2} GB", size as f64 / (1024.0 * 1024.0 * 1024.0))
            } else if size >= 1024 * 1024 {
                format!("{:.2} MB", size as f64 / (1024.0 * 1024.0))
            } else {
                format!("{} KB", size / 1024)
            };

            items.push(HistoryEntry {
                id: Uuid::new_v4().to_string(),
                title: filename.clone(),
                filename,
                filepath: entry_path.to_string_lossy().to_string(),
                url: "".to_string(),
                file_type: file_type.to_string(),
                ext: ext.to_uppercase(),
                completed_at,
                size_label,
                thumbnail_data_url: None,
                format: "".to_string(),
                quality: "".to_string(),
                status: "active".to_string(),
            });
        }
    }

    items.sort_by(|a, b| b.completed_at.cmp(&a.completed_at));

    Ok(items)
}