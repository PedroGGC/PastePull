use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tracing::{debug, error, info};
use uuid::Uuid;

use crate::downloader::{build_ytdlp_args, spawn_download_thread};
use crate::process::{kill_process_tree, resume_process, suspend_process};
use crate::types::{DownloadProgress, DownloadHandle, HistoryEntry, SharedDownloadState};
use crate::utils::{ascii_alphanum, normalize_title};
use std::os::windows::process::CommandExt;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn start_download(
    url: String,
    output_dir: String,
    quality: Option<String>,
    format_type: Option<String>,
    title: Option<String>,
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
    let ytdlp_path = resource_dir.join("yt-dlp.exe");

    if !ytdlp_path.exists() {
        return Err(format!("yt-dlp.exe não encontrado: {}", ytdlp_path.display()));
    }

    let (_, args) = build_ytdlp_args(&ytdlp_path, &url, &output_dir, quality.clone(), format_type.clone(), title.clone())?;

    let tmp_dir = std::env::temp_dir();
    let stdout_path = tmp_dir.join(format!("ytdlp_stdout_{}.log", task_id));
    let stderr_path = tmp_dir.join(format!("ytdlp_stderr_{}.log", task_id));

    let stdout_file = std::fs::File::create(&stdout_path).map_err(|e| e.to_string())?;
    let stderr_file = std::fs::File::create(&stderr_path).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&ytdlp_path);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

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
        output_dir,
        title.unwrap_or_default(),
        state_clone,
        app.clone(),
        stderr_path,
        stdout_path,
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
            #[cfg(target_os = "windows")]
            kill_process_tree(pid);
            #[cfg(not(target_os = "windows"))]
            let _ = child.kill();
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
                let format_re = regex::Regex::new(r"\.f\d+").unwrap();
                let mut ps = format_re.replace(&filename_full, "").to_string();
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
                        || regex::Regex::new(r"\.f\d+\.\w+$")
                            .unwrap()
                            .is_match(&filename);

                    if is_related && is_temp {
                        for _attempt in 0..5 {
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
    let ytdlp_path = resource_dir.join("yt-dlp.exe");

    tokio::task::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&ytdlp_path);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);

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
pub fn open_folder_natively(path: String) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(&path).spawn();
    }
}

#[tauri::command]
pub fn find_file_by_title(dir: String, title: String) -> bool {
    let title_norm = ascii_alphanum(&title);
    if title_norm.len() < 8 {
        return false;
    }
    let threshold = (title_norm.len() * 4 / 5).max(10);

    let Ok(entries) = std::fs::read_dir(&dir) else {
        return false;
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let fname = entry.file_name();
        let fname_str = fname.to_string_lossy();
        let ext = PathBuf::from(fname_str.as_ref())
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif") {
            continue;
        }
        let file_stem = PathBuf::from(fname_str.as_ref())
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let file_norm = ascii_alphanum(&file_stem);

        let common = title_norm.chars().zip(file_norm.chars()).take_while(|(a, b)| a == b).count();

        if common >= threshold {
            return true;
        }
    }
    false
}

#[tauri::command]
pub fn read_thumbnail_as_base64(path: String) -> Result<String, String> {
    let file_path = PathBuf::from(&path);

    if file_path.exists() {
        let data = std::fs::read(&path).map_err(|e| e.to_string())?;
        let base64 = crate::utils::base64_encode(&data);
        let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
        let mime = match ext {
            "png" => "image/png",
            "gif" => "image/gif",
            "webp" => "image/webp",
            _ => "image/jpeg",
        };
        return Ok(format!("data:{};base64,{}", mime, base64));
    }

    if let Some(parent) = file_path.parent() {
        let stem = file_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let stem_norm = ascii_alphanum(stem);

        if let Ok(entries) = std::fs::read_dir(parent) {
            let mut best_match: Option<(usize, PathBuf)> = None;

            for entry in entries.filter_map(|e| e.ok()) {
                let fname = entry.file_name();
                let fname_str = fname.to_string_lossy();
                let low = fname_str.to_lowercase();
                if !low.ends_with(".jpg")
                    && !low.ends_with(".jpeg")
                    && !low.ends_with(".webp")
                    && !low.ends_with(".png")
                {
                    continue;
                }
                let file_stem = PathBuf::from(fname_str.as_ref())
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                let file_norm = ascii_alphanum(&file_stem);

                let common = stem_norm
                    .chars()
                    .zip(file_norm.chars())
                    .take_while(|(a, b)| a == b)
                    .count();

                if common > best_match.as_ref().map(|(n, _)| *n).unwrap_or(0) {
                    best_match = Some((common, entry.path()));
                }
            }

            if let Some((score, matched_path)) = best_match {
                if score >= 10 {
                    let data = std::fs::read(&matched_path).map_err(|e| e.to_string())?;
                    let base64 = crate::utils::base64_encode(&data);
                    return Ok(format!("data:image/jpeg;base64,{}", base64));
                }
            }
        }
    }

    Err(format!("Thumbnail não encontrada: {}", path))
}

#[tauri::command]
pub fn check_files_exist(paths: Vec<String>) -> Vec<bool> {
    paths.into_iter()
        .map(|p| PathBuf::from(&p).exists())
        .collect()
}

#[tauri::command]
pub fn resolve_paths(paths: Vec<String>) -> Vec<Option<String>> {
    paths.into_iter()
        .map(|p| {
            let path = PathBuf::from(&p);
            if path.exists() {
                return Some(p);
            }

            if let (Some(parent), Some(filename)) = (path.parent(), path.file_name()) {
                let filename_str = filename.to_string_lossy();
                let file_stem = filename_str
                    .rsplit('.')
                    .last()
                    .unwrap_or(&filename_str)
                    .to_string();
                let target_norm = ascii_alphanum(&file_stem);
                let target_ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

                if target_norm.len() >= 5 {
                    if let Ok(entries) = std::fs::read_dir(parent) {
                        let mut best_match: Option<(usize, String)> = None;
                        for entry in entries.flatten() {
                            let entry_path = entry.path();
                            if !entry_path.is_file() {
                                continue;
                            }

                            let entry_name = entry.file_name();
                            let entry_name_str = entry_name.to_string_lossy();
                            let entry_stem = entry_name_str
                                .rsplit('.')
                                .last()
                                .unwrap_or(&entry_name_str)
                                .to_string();
                            let entry_norm = ascii_alphanum(&entry_stem);
                            let entry_ext = entry_path
                                .extension()
                                .and_then(|e| e.to_str())
                                .unwrap_or("")
                                .to_lowercase();

                            let ext_match = target_ext.is_empty()
                                || entry_ext.is_empty()
                                || target_ext == entry_ext
                                || (target_ext == "mp4" && entry_ext == "m4v")
                                || (target_ext == "m4v" && entry_ext == "mp4");

                            if !ext_match {
                                continue;
                            }

                            let common = target_norm
                                .chars()
                                .zip(entry_norm.chars())
                                .take_while(|(a, b)| a == b)
                                .count();

                            let is_substring = entry_norm.contains(&target_norm) || target_norm.contains(&entry_norm);
                            let prefix_match = common >= target_norm.len().min(entry_norm.len()).min(8) && common >= 5;

                            if (prefix_match || is_substring) && common >= 5 {
                                if common > best_match.as_ref().map(|(n, _)| *n).unwrap_or(0) {
                                    best_match = Some((common, entry_path.to_string_lossy().to_string()));
                                }
                            }
                        }
                        if let Some((_, found_path)) = best_match {
                            debug!("Fuzzy matched: {} -> {}", p, found_path);
                            return Some(found_path);
                        }
                    }
                }

                let search_key = file_stem.chars().take_while(|c| !c.is_ascii_digit()).collect::<String>();

                if search_key.len() >= 5 {
                    if let Ok(entries) = std::fs::read_dir(parent) {
                        for entry in entries.flatten() {
                            let entry_path = entry.path();
                            if !entry_path.is_file() {
                                continue;
                            }

                            let entry_name = entry_path.file_name().and_then(|n| n.to_str()).unwrap_or("");

                            let normalized_search = search_key.to_lowercase();
                            let normalized_entry = entry_name.to_lowercase();

                            if normalized_entry.contains(&normalized_search)
                                || normalized_search.contains(&normalized_entry.split('.').next().unwrap_or(&normalized_entry))
                            {
                                let ext = entry_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                                let valid_exts = [
                                    "mp4", "mkv", "avi", "mov", "webm", "m4v", "mp3", "flac", "aac", "wav", "ogg", "m4a", "opus",
                                ];
                                if valid_exts.contains(&ext.as_str()) {
                                    debug!("Prefix fallback: {} -> {}", p, entry_path.display());
                                    return Some(entry_path.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                }
            }
            None
        })
        .collect()
}

#[tauri::command]
pub fn scan_download_folder(folder_path: String) -> Result<Vec<HistoryEntry>, String> {
    let path = PathBuf::from(&folder_path);
    if !path.exists() || !path.is_dir() {
        return Err("Diretório não existe".to_string());
    }

    let mut items = Vec::new();
    let video_exts = vec!["mp4", "mkv", "avi", "mov", "webm", "flv", "m4v", "ts"];
    let audio_exts = vec!["mp3", "flac", "aac", "wav", "ogg", "m4a", "opus"];

    if let Ok(entries) = std::fs::read_dir(&path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if !entry_path.is_file() {
                continue;
            }

            let filename = entry_path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let ext = entry_path.extension().unwrap_or_default().to_string_lossy().to_string().to_lowercase();

            if filename.ends_with(".part") || filename.ends_with(".ytdl") || filename.ends_with(".jpg") || filename.ends_with(".webp") {
                continue;
            }

            let file_type = if video_exts.contains(&ext.as_str()) {
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
            });
        }
    }

    items.sort_by(|a, b| b.completed_at.cmp(&a.completed_at));
    Ok(items)
}

#[tauri::command]
pub fn save_history(app: AppHandle, mut items: Vec<HistoryEntry>) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let history_dir = app_data.join("persistence");
    if !history_dir.exists() {
        std::fs::create_dir_all(&history_dir).map_err(|e| e.to_string())?;
    }
    let history_file = history_dir.join("history.json");

    items.sort_by(|a, b| b.completed_at.cmp(&a.completed_at));
    if items.len() > 100 {
        items.truncate(100);
    }

    let json = serde_json::to_string_pretty(&items).map_err(|e| e.to_string())?;
    std::fs::write(history_file, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
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
