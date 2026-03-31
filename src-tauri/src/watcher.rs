use notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, DebouncedEvent, Debouncer};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize, Deserialize)]
pub struct FileChangeEvent {
    pub filepath: String,
    pub action: String,
}

pub struct FileWatcherState {
    watcher: Option<Debouncer<RecommendedWatcher>>,
    watch_path: Option<PathBuf>,
    known_files: std::sync::Mutex<HashSet<String>>,
}

impl Default for FileWatcherState {
    fn default() -> Self {
        Self {
            watcher: None,
            watch_path: None,
            known_files: std::sync::Mutex::new(HashSet::new()),
        }
    }
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
    let (tx, rx) = channel();

    let mut debouncer = new_debouncer(Duration::from_secs(2), tx)
        .map_err(|e| format!("Erro ao criar debouncer: {}", e))?;

    debouncer
        .watcher()
        .watch(&watch_path, notify::RecursiveMode::NonRecursive)
        .map_err(|e| format!("Erro ao watch: {}", e))?;

    std::thread::spawn(move || {
        let mut known = known_files;
        
        loop {
            match rx.recv() {
                Ok(Ok(events)) => {
                    for event in events {
                        let file_path = event.path.to_string_lossy().to_string();
                        let exists = event.path.exists();
                        
                        let action = if exists {
                            if !known.contains(&file_path) {
                                known.insert(file_path.clone());
                                Some("restored".to_string())
                            } else {
                                None
                            }
                        } else {
                            if known.contains(&file_path) {
                                known.remove(&file_path);
                                Some("deleted".to_string())
                            } else {
                                None
                            }
                        };
                        
                        if let Some(act) = action {
                            let event_msg = FileChangeEvent {
                                filepath: file_path,
                                action: act,
                            };
                            let _ = app_clone.emit("file-changed", event_msg);
                        }
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("Watcher error: {:?}", e);
                }
                Err(_) => break,
            }
        }
    });

    app.manage(FileWatcherState {
        watcher: Some(debouncer),
        watch_path: Some(watch_path),
        known_files: std::sync::Mutex::new(HashSet::new()),
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