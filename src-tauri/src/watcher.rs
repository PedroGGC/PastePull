use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use once_cell::sync::Lazy;
use std::collections::HashMap;

static WATCHER_SENDERS: Lazy<Mutex<HashMap<String, Sender<()>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Serialize, Deserialize)]
pub struct FileChangeEvent {
    pub filepath: String,
    pub action: String,
}

#[tauri::command]
pub fn start_file_watcher(app: AppHandle, path: String) -> Result<(), String> {
    let watch_path = PathBuf::from(&path);

    if !watch_path.exists() {
        return Err("Path does not exist".to_string());
    }

    let (stop_tx, stop_rx) = channel::<()>();
    {
        let mut senders = WATCHER_SENDERS.lock().unwrap();
        if let Some(old_tx) = senders.get(&path) {
            let _ = old_tx.send(());
        }
        senders.insert(path.clone(), stop_tx);
    }

    let app_clone = app.clone();

    thread::spawn(move || {
        let (event_tx, event_rx) = channel::<Result<Event, notify::Error>>();

        let mut watcher = match RecommendedWatcher::new(
            move |res| {
                let _ = event_tx.send(res);
            },
            Config::default().with_poll_interval(Duration::from_secs(1)),
        ) {
            Ok(w) => w,
            Err(_) => return,
        };

        if let Err(_) = watcher.watch(&watch_path, RecursiveMode::NonRecursive) {
            return;
        }

        let mut known_files: HashSet<String> = std::fs::read_dir(&watch_path)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().is_file())
                    .map(|e| e.path().to_string_lossy().to_string())
                    .collect()
            })
            .unwrap_or_default();

        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }

            match event_rx.recv_timeout(Duration::from_millis(500)) {
                Ok(Ok(event)) => {
                    match event.kind {
                        EventKind::Create(_) => {
                            for path in event.paths {
                                let path_str = path.to_string_lossy().to_string();
                                if path.is_file() {
                                    if known_files.insert(path_str.clone()) {
                                        let event_msg = FileChangeEvent {
                                            filepath: path_str,
                                            action: "restored".to_string(),
                                        };
                                        let _ = app_clone.emit("file-changed", event_msg);
                                    }
                                }
                            }
                        }
                        EventKind::Remove(_) => {
                            for path in event.paths {
                                let path_str = path.to_string_lossy().to_string();
                                // tracing::info!("[DEBUG] File event: {} - action: deleted", path_str);
                                if known_files.remove(&path_str) {
                                    let event_msg = FileChangeEvent {
                                        filepath: path_str,
                                        action: "deleted".to_string(),
                                    };
                                    let _ = app_clone.emit("file-changed", event_msg);
                                }
                            }
                        }
                        EventKind::Modify(_) => {}
                        EventKind::Access(_) => {}
                        _ => {}
                    }
                }
                Ok(Err(_)) => continue,
                Err(_) => continue,
            }
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
