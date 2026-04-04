use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize, Deserialize)]
pub struct FileChangeEvent {
    pub filepath: String,
    pub action: String,
}

fn get_all_files_in_folder(folder: &PathBuf) -> Vec<String> {
    std::fs::read_dir(folder)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_file())
                .map(|e| e.path().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub fn start_file_watcher(app: AppHandle, path: String) -> Result<(), String> {
    let watch_path = PathBuf::from(&path);

    if !watch_path.exists() {
        return Err("Caminho não existe".to_string());
    }

    let current_files = get_all_files_in_folder(&watch_path);
    let known_files: HashSet<String> = current_files.iter().cloned().collect();
    
    let app_clone = app.clone();
    let watch_path_clone = watch_path.clone();
    
    std::thread::spawn(move || {
        let mut known = known_files;
        
loop {
            std::thread::sleep(Duration::from_secs(2));
            
            let current_files = get_all_files_in_folder(&watch_path_clone);
            let current_set: HashSet<String> = current_files.iter().cloned().collect();
            
            for file_path in &known {
                if !current_set.contains(file_path) {
                    let event_msg = FileChangeEvent {
                        filepath: file_path.clone(),
                        action: "deleted".to_string(),
                    };
                    let _ = app_clone.emit("file-changed", event_msg);
                }
            }
            
            for file_path in &current_set {
                if !known.contains(file_path) {
                    let event_msg = FileChangeEvent {
                        filepath: file_path.clone(),
                        action: "restored".to_string(),
                    };
                    let _ = app_clone.emit("file-changed", event_msg);
                }
            }
             
            known = current_set;
        }
    });

    Ok(())
}

#[tauri::command]
pub fn check_file_exists(filepath: String) -> bool {
    PathBuf::from(&filepath).exists()
}

#[tauri::command]
pub fn check_files_in_folder(folder_path: String) -> Vec<String> {
    let path = PathBuf::from(&folder_path);
    if !path.exists() {
        return vec![];
    }

    std::fs::read_dir(&path)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_file())
                .map(|e| e.path().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default()
}