use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// Fix 1: registry de stop flags por caminho monitorado.
// Garante que apenas uma thread por path exista em qualquer momento.
use once_cell::sync::Lazy;
use std::collections::HashMap;

static WATCHER_STOP_FLAGS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

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

    // Fix 1: sinalizar a thread anterior (se houver) para parar antes de criar uma nova.
    let stop_flag = {
        let mut flags = WATCHER_STOP_FLAGS.lock().unwrap();
        if let Some(old_flag) = flags.get(&path) {
            old_flag.store(true, Ordering::Relaxed);
        }
        let new_flag = Arc::new(AtomicBool::new(false));
        flags.insert(path.clone(), Arc::clone(&new_flag));
        new_flag
    };

    let current_files = get_all_files_in_folder(&watch_path);
    let known_files: HashSet<String> = current_files.iter().cloned().collect();
    
    let app_clone = app.clone();
    let watch_path_clone = watch_path.clone();
    
    std::thread::spawn(move || {
        let mut known = known_files;
        
        loop {
            // Fix 1: verificar stop flag a cada iteração
            if stop_flag.load(Ordering::Relaxed) {
                break;
            }

            // Opt 6: Reduzimos a frequência de disco do watcher para 4 segundos.
            std::thread::sleep(Duration::from_secs(4));

            // Checar novamente após o sleep (pode ter sido sinalizado durante a espera)
            if stop_flag.load(Ordering::Relaxed) {
                break;
            }
            
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
