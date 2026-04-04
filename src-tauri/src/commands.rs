use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use once_cell::sync::Lazy;
use regex::Regex;
use tauri::{AppHandle, Emitter, Manager, State};
use tracing::{debug, error, info};
use uuid::Uuid;

use crate::downloader::{build_ytdlp_args, spawn_download_thread};
use crate::process::{kill_process_tree, resume_process, suspend_process};
use crate::types::{DownloadProgress, DownloadHandle, HistoryEntry, SharedDownloadState};
use crate::utils::normalize_title;
use tauri_plugin_dialog::DialogExt;

static ORPHAN_REGEX: Lazy<Regex> = Lazy::new(|| Regex::new(r"\.f\d+\.\w+$").unwrap());
static FORMAT_REGEX: Lazy<Regex> = Lazy::new(|| Regex::new(r"\.f\d+").unwrap());

#[tauri::command]
pub async fn start_download(
    url: String,
    output_dir: String,
    quality: Option<String>,
    format_type: Option<String>,
    title: Option<String>,
    extension: Option<String>,
    app: AppHandle,
    state: State<'_, SharedDownloadState>,
) -> Result<String, String> {
    if url.is_empty() {
        return Err("URL não fornecida".to_string());
    }

    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL inválida".to_string());
    }

    let task_id = Uuid::new_v4().to_string();
    info!("Starting download: {} with ID {}", url, task_id);

    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let ytdlp_path = resource_dir.join("essentials").join("yt-dlp.exe");

    if !ytdlp_path.exists() {
        return Err(format!("yt-dlp.exe não encontrado: {}", ytdlp_path.display()));
    }

    let (_, args) = build_ytdlp_args(&ytdlp_path, &url, &output_dir, quality.clone(), format_type.clone(), title.clone(), extension.clone())?;

    let tmp_dir = std::env::temp_dir();
    let stdout_path = tmp_dir.join(format!("ytdlp_stdout_{}.log", task_id));
    let stderr_path = tmp_dir.join(format!("ytdlp_stderr_{}.log", task_id));

    let stdout_file = std::fs::File::create(&stdout_path).map_err(|e| e.to_string())?;
    let stderr_file = std::fs::File::create(&stderr_path).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&ytdlp_path);
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let child = cmd
        .args(&args)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdout(stdout_file)
        .stderr(stderr_file)
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| format!("Falha ao iniciar yt-dlp: {}", e))?;

    let quality_c = quality.clone().unwrap_or_default();
    let format_c = format_type.clone().unwrap_or_else(|| "video".to_string());
    let extension_c = extension.clone().unwrap_or_default();
    let is_audio = format_c == "audio" || ["MP3", "M4A", "OGG", "FLAC", "WAV"].iter().any(|&e| extension_c.to_uppercase() == e);

    {
        let mut s = state.lock().unwrap();
        s.insert(
            task_id.clone(),
            DownloadHandle {
                process: Some(child),
                is_paused: false,
                output_filepath: None,
                thumbnail_filepath: None,
                output_dir: output_dir.clone(),
                requested_title: title.clone().unwrap_or_default(),
                is_audio,
                last_progress: Some(DownloadProgress {
                    id: task_id.clone(),
                    percent: 0.0,
                    speed: "—".to_string(),
                    eta: "—".to_string(),
                    status: "preparing".to_string(),
                    filename: String::new(),
                    output_path: String::new(),
                    total_size: String::new(),
                    thumbnail_path: String::new(),
                    error_message: None,
                    url: url.clone(),
                    quality: quality_c,
                    format: format_c,
                    extension: Some(extension_c),
                }),
            },
        );
    }

    let state_clone = Arc::clone(&state);

    spawn_download_thread(
        ytdlp_path,
        args,
        task_id.clone(),
        url,
        quality.unwrap_or_default(),
        format_type.unwrap_or_else(|| "video".to_string()),
        extension.unwrap_or_default(),
        output_dir,
        title.unwrap_or_default(),
        state_clone,
        app.clone(),
        stderr_path,
        stdout_path,
        is_audio,
    );

    Ok(task_id)
}

#[tauri::command]
pub async fn cancel_download(
    id: String,
    state: State<'_, SharedDownloadState>,
    app: AppHandle,
) -> Result<(), String> {
    info!("Cancelling download: {}", id);

    let (output_path, thumb_path, output_dir, requested_title) = {
        let mut s = state.lock().unwrap();
        let Some(mut handle) = s.remove(&id) else {
            return Ok(());
        };

        let op = handle.output_filepath.clone();
        let tp = handle.thumbnail_filepath.clone();
        let od = handle.output_dir.clone();
        let rt = handle.requested_title.clone();

        if let Some(ref mut child) = handle.process {
            let pid = child.id();
            kill_process_tree(pid);
            info!("Download {} cancelled - PID {} terminated", id, pid);
        }

        (op, tp, od, rt)
    };

    let id_c = id.clone();
    let app_c = app.clone();

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

        let search_dir = if let Some(ref p) = output_path {
            PathBuf::from(p).parent().map(|p| p.to_path_buf())
        } else {
            Some(PathBuf::from(&output_dir))
        };

        if let Some(parent) = search_dir {
            let stem_hint = if let Some(ref p) = output_path {
                let filename_full = PathBuf::from(p)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                let mut ps = FORMAT_REGEX.replace(&filename_full, "").to_string();
                if let Some(pos) = ps.rfind('.') {
                    ps.truncate(pos);
                }
                ps
            } else {
                requested_title.clone()
            };

            let normalized_stem = normalize_title(&stem_hint);

            if let Ok(entries) = std::fs::read_dir(&parent) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_file() {
                        continue;
                    }

                    let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    let normalized_filename = normalize_title(&filename);

                    let is_related = normalized_filename.starts_with(&normalized_stem);

                    let is_temp = filename.ends_with(".part")
                        || filename.ends_with(".ytdl")
                        || filename.ends_with(".jpg")
                        || filename.ends_with(".webp")
                        || ORPHAN_REGEX.is_match(&filename);

                    if is_related && is_temp {
                        for _attempt in 0..3 {
                            if std::fs::remove_file(&path).is_ok() {
                                debug!("Removed orphan file: {}", filename);
                                break;
                            }
                            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                        }
                    }
                }
            }
        }

        if let Some(tp) = thumb_path {
            let _ = std::fs::remove_file(tp);
        }

        let _ = app_c.emit(
            "download-progress",
            DownloadProgress {
                id: id_c,
                percent: 0.0,
                speed: String::new(),
                eta: String::new(),
                status: "idle".to_string(),
                filename: String::new(),
                output_path: String::new(),
                total_size: String::new(),
                thumbnail_path: String::new(),
                error_message: None,
                url: String::new(),
                quality: String::new(),
                format: String::new(),
                extension: None,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn pause_download(
    id: String,
    state: State<'_, SharedDownloadState>,
    app: AppHandle,
) -> Result<(), String> {
    info!("Pause/resume requested for: {}", id);

    let mut s = state.lock().unwrap();
    let Some(handle) = s.get_mut(&id) else {
        return Err("Download não encontrado".to_string());
    };
    let Some(ref child) = handle.process else {
        return Err("Nenhum processo ativo para este download".to_string());
    };
    let pid = child.id();

    if handle.is_paused {
        resume_process(pid)?;
        handle.is_paused = false;
        info!("Download {} resumed (PID {})", id, pid);
    } else {
        suspend_process(pid)?;
        handle.is_paused = true;
        info!("Download {} paused (PID {})", id, pid);
    }

    if let Some(mut progress) = handle.last_progress.clone() {
        progress.status = if handle.is_paused {
            "paused".to_string()
        } else {
            "downloading".to_string()
        };
        handle.last_progress = Some(progress.clone());
        let _ = app.emit("download-progress", progress);
    }

    Ok(())
}

#[tauri::command]
pub async fn select_download_folder(app: AppHandle) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel();

    let _ = app
        .dialog()
        .file()
        .set_title("Select Download Folder")
        .pick_folder(move |folder: Option<tauri_plugin_dialog::FilePath>| {
            let _ = tx.send(folder);
        });

    match rx.recv() {
        Ok(Some(path)) => Ok(path.to_string()),
        _ => Err("No folder selected".to_string()),
    }
}

#[tauri::command]
pub async fn get_video_metadata(app: AppHandle, url: String) -> Result<String, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let ytdlp_path = resource_dir.join("essentials").join("yt-dlp.exe");

    tokio::task::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&ytdlp_path);
        #[cfg(target_os = "windows")]
        use std::os::windows::process::CommandExt;
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        let output = cmd
            .arg("--dump-json")
            .arg("--no-playlist")
            .arg(&url)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            error!("get_video_metadata failed. STDERR: {}", stderr.trim());
            Err(if stderr.trim().is_empty() {
                "Falha ao obter metadados".to_string()
            } else {
                stderr
            })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn check_files_exist(paths: Vec<String>) -> Vec<bool> {
    crate::file_ops::check_files_exist(paths)
}

#[tauri::command]
pub fn open_folder_natively(path: String) {
    crate::file_ops::open_folder_natively(path)
}

#[tauri::command]
pub fn find_file_by_title(dir: String, title: String, extension: Option<String>) -> bool {
    crate::file_ops::find_file_by_title(dir, title, extension)
}

#[tauri::command]
pub fn resolve_paths(paths: Vec<String>) -> Vec<Option<String>> {
    crate::file_ops::resolve_paths(paths)
}

#[tauri::command]
pub fn read_thumbnail_as_base64(path: String) -> Result<String, String> {
    crate::thumbnail_ops::read_thumbnail_as_base64(path)
}

#[tauri::command]
pub fn get_file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scan_download_folder(folder_path: String) -> Result<Vec<HistoryEntry>, String> {
    crate::history_ops::scan_download_folder(folder_path)
}

#[tauri::command]
pub fn list_files_in_folder(folder_path: String) -> Result<Vec<String>, String> {
    let path = std::path::PathBuf::from(&folder_path);
    if !path.exists() {
        return Err("Folder does not exist".to_string());
    }
    
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name() {
                    files.push(name.to_string_lossy().to_string());
                }
            }
        }
    }
    
    Ok(files)
}

#[tauri::command]
pub fn save_history(app: AppHandle, items: Vec<HistoryEntry>) -> Result<(), String> {
    crate::history_ops::save_history(app, items)
}

#[tauri::command]
pub fn load_history(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    crate::history_ops::load_history(app)
}

#[tauri::command]
pub fn move_multiple_to_trash(paths: Vec<String>) -> Result<(), String> {
    info!("Moving {} file(s) to trash", paths.len());
    
    #[cfg(target_os = "windows")]
    {
        // First, collect all stems from paths being deleted
        let mut stems_to_delete: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        let mut escaped_paths: Vec<String> = Vec::new();
        
        for filepath in &paths {
            let path = PathBuf::from(filepath);
            if let Some(stem) = path.file_stem() {
                let stem_str = stem.to_string_lossy().to_lowercase();
                *stems_to_delete.entry(stem_str).or_insert(0) += 1;
            }
            escaped_paths.push(filepath.replace("'", "''"));
        }
        
        // Delete all main files in a SINGLE PowerShell command
        if !escaped_paths.is_empty() {
            let files_array = escaped_paths.join("','");
            let ps_command = format!(
                "Add-Type -AssemblyName Microsoft.VisualBasic; @('{}') | ForEach-Object {{ [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($_, 'OnlyErrorDialogs', 'SendToRecycleBin') }}",
                files_array
            );
            
            let mut cmd = std::process::Command::new("powershell.exe");
            cmd.args(["-WindowStyle", "Hidden", "-Command", &ps_command]);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(0x08000000);
            let _ = cmd.spawn();
            
            info!("Moved {} file(s) to trash", paths.len());
        }
        
        // Wait longer for all files to be fully deleted
        std::thread::sleep(std::time::Duration::from_millis(3500));
        info!("Finished waiting for file deletions");
        
        // Now check and delete orphaned thumbnails
        let mut thumbnails_to_check: Vec<(PathBuf, String)> = Vec::new();
        
        for filepath in &paths {
            let path = PathBuf::from(filepath);
            if let Some(parent) = path.parent() {
                if let Some(stem) = path.file_stem() {
                    thumbnails_to_check.push((parent.to_path_buf(), stem.to_string_lossy().to_string()));
                }
            }
        }
        
        for (parent, stem) in thumbnails_to_check {
            let stem_lower = stem.to_lowercase();
            let count_being_deleted = stems_to_delete.get(&stem_lower).copied().unwrap_or(0);
            
            info!("Checking thumbnail for stem: {} (deleting {} files with this stem)", stem, count_being_deleted);
            
            // Check for common image extensions
            let image_exts = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
            
            for ext in &image_exts {
                let thumb_filename = format!("{}.{}", stem, ext);
                let thumb_path = parent.join(&thumb_filename);
                
                if thumb_path.exists() {
                    info!("Thumbnail exists: {:?}", thumb_path);
                    
                    // Count total media files with same stem in folder (excluding images)
                    let mut total_in_folder = 0usize;
                    let image_exts = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
                    if let Ok(entries) = std::fs::read_dir(&parent) {
                        for entry in entries.flatten() {
                            let entry_path = entry.path();
                            // Skip image files (thumbnails)
                            if let Some(ext) = entry_path.extension() {
                                let ext_str = ext.to_string_lossy().to_lowercase();
                                if image_exts.contains(&ext_str.as_str()) {
                                    continue;
                                }
                            }
                            if let Some(entry_stem) = entry_path.file_stem() {
                                let entry_stem_str = entry_stem.to_string_lossy().to_lowercase();
                                if entry_stem_str == stem_lower {
                                    total_in_folder += 1;
                                }
                            }
                        }
                    }
                    
                    info!("Total media files with stem '{}' in folder: {}", stem_lower, total_in_folder);
                    
                    // Only delete thumbnail if all media files with this stem are being deleted
                    if total_in_folder <= count_being_deleted {
                        let thumb_str = thumb_path.to_string_lossy().to_string();
                        let thumb_ps_command = format!(
                            "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('{}', 'OnlyErrorDialogs', 'SendToRecycleBin')",
                            thumb_str.replace("'", "''")
                        );
                        
                        let mut thumb_cmd = std::process::Command::new("powershell.exe");
                        thumb_cmd.args(["-WindowStyle", "Hidden", "-Command", &thumb_ps_command]);
                        #[cfg(target_os = "windows")]
                        thumb_cmd.creation_flags(0x08000000);
                        let _ = thumb_cmd.spawn();
                        
                        std::thread::sleep(std::time::Duration::from_millis(300));
                        info!("Thumbnail moved to trash: {}", thumb_str);
                        break;
                    } else {
                        info!("Not deleting thumbnail - {} files with same stem exist but only {} being deleted", total_in_folder, count_being_deleted);
                    }
                    break;
                }
            }
        }
    }

    info!("Move to trash completed");
    Ok(())
}
