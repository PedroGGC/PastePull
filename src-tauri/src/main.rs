#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::sync::{Arc, Mutex};
use std::process::{Child, Command, Stdio};
use std::io::{BufRead, BufReader};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use std::collections::HashMap;
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize, Debug)]
struct DownloadProgress {
    id: String,
    percent: f64,
    speed: String,
    eta: String,
    status: String,
    filename: String,
    output_path: String,
    total_size: String,
    thumbnail_path: String,
    error_message: Option<String>,
    url: String,
    quality: String,
    format: String,
}

struct DownloadHandle {
    process: Option<Child>,
    is_paused: bool,
    output_filepath: Option<String>,
    thumbnail_filepath: Option<String>,
    last_progress: Option<DownloadProgress>,
    output_dir: String,
    requested_title: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct HistoryEntry {
    id: String,
    title: String,
    filename: String,
    filepath: String,
    url: String,
    #[serde(rename = "type")]
    file_type: String,
    ext: String,
    #[serde(rename = "completedAt")]
    completed_at: u64,
    #[serde(rename = "sizeLabel")]
    size_label: String,
    #[serde(rename = "thumbnailDataUrl")]
    thumbnail_data_url: Option<String>,
    format: String,
    quality: String,
}

type SharedDownloadState = Arc<Mutex<HashMap<String, DownloadHandle>>>;

fn get_default_download_path() -> String {
    dirs::download_dir()
        .or_else(|| dirs::video_dir())
        .or_else(|| dirs::home_dir())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string())
}

#[tauri::command]
async fn start_download(
    url: String,
    output_dir: String,
    quality: Option<String>,
    format_type: Option<String>,
    title: Option<String>, // <── Adicionado
    app: AppHandle,
    state: tauri::State<'_, SharedDownloadState>,
) -> Result<String, String> {
    if url.is_empty() {
        return Err("URL não fornecida".to_string());
    }

    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL inválida".to_string());
    }

    let task_id = Uuid::new_v4().to_string();

    let final_path = if output_dir.is_empty() || output_dir == "default_path" {
        get_default_download_path()
    } else {
        output_dir.clone()
    };

    let format_val = format_type.unwrap_or_else(|| "video".to_string());
    let output_template = format!("{}/%(title)s.%(ext)s", final_path.trim_end_matches(['/', '\\']));

    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let ytdlp_path = resource_dir.join("yt-dlp.exe");

    if !ytdlp_path.exists() {
        return Err(format!("yt-dlp.exe não encontrado: {}", ytdlp_path.display()));
    }

    fn find_available_browser() -> Option<String> {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
        if !appdata.is_empty() {
            let path = format!("{}\\Mozilla\\Firefox\\Profiles", appdata);
            if std::path::Path::new(&path).exists() { return Some("firefox".to_string()); }
        }
        if !localappdata.is_empty() {
            let path = format!("{}\\Microsoft\\Edge\\User Data", localappdata);
            if std::path::Path::new(&path).exists() { return Some("edge".to_string()); }
        }
        None
    }

    let browser_arg = find_available_browser().unwrap_or_else(|| "".to_string());
    let use_cookies = !browser_arg.is_empty() && (browser_arg == "firefox" || browser_arg == "edge");

    let mut args: Vec<String> = vec![
        "--ffmpeg-location".to_string(), resource_dir.to_string_lossy().to_string(),
        "--no-playlist".to_string(),
        "--write-thumbnail".to_string(),
        "--convert-thumbnails".to_string(), "jpg".to_string(),
        "--progress-template".to_string(), "[download] %(progress._percent_str)s of %(progress._total_bytes_str)s at %(progress._speed_str)s ETA %(progress._eta_str)s".to_string(),
        "--newline".to_string(), "--no-colors".to_string(),
    ];
    
    let mut is_audio_only = false;
    let q_str = quality.clone().unwrap_or_else(|| "".to_string());
    match (format_val.as_str(), q_str.as_str()) {
        ("audio", _) | (_, "AUDIO ONLY") => {
            is_audio_only = true;
            args.extend_from_slice(&["-f".to_string(), "bestaudio/best".to_string(), "--extract-audio".to_string(), "--audio-format".to_string(), "mp3".to_string()]);
        },
        (_, q) if q.ends_with("P VIDEO") => {
            let height = q.replace("P VIDEO", "");
            args.extend_from_slice(&["-f".to_string(), format!("bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={height}]+bestaudio/best")]);
        },
        _ => args.extend_from_slice(&["-f".to_string(), "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best".to_string()]),
    }
    
    if !is_audio_only { args.extend_from_slice(&["--merge-output-format".to_string(), "mp4".to_string()]); }
    if use_cookies { args.extend_from_slice(&["--cookies-from-browser".to_string(), browser_arg]); }
    args.extend_from_slice(&["-o".to_string(), output_template, url.clone()]);

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

    {
        let mut s = state.lock().unwrap();
        let url_c = url.clone();
        let quality_c = quality.clone().unwrap_or_default();
        let format_c = format_val.clone();

        s.insert(task_id.clone(), DownloadHandle {
            process: Some(child),
            is_paused: false,
            output_filepath: None,
            thumbnail_filepath: None,
            output_dir: output_dir.clone(),
            requested_title: title.unwrap_or_default(),
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
                url: url_c,
                quality: quality_c,
                format: format_c,
            }),
        });
    }

    let app_clone = app.clone();
    let state_clone = Arc::clone(&state);
    let id_clone = task_id.clone();

    // Stderr reader
    let stderr_path_clone = stderr_path.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if let Ok(file) = std::fs::File::open(&stderr_path_clone) {
            let reader = BufReader::new(file);
            for line in reader.lines().flatten() { println!("[YTDLP-ERR-{}] {}", id_clone, line); }
        }
    });

    let stdout_path_clone = stdout_path.clone();
    let id_clone_2 = task_id.clone();

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        let progress_re = Regex::new(r"\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*\w+)\s+at\s+([\d.]+\s*\w+/s)\s+ETA\s+([\d:]+)").unwrap();
        let dest_re = Regex::new(r"\[download\] Destination: (.+)").unwrap();
        let already_re = Regex::new(r"\[download\] (.+) has already been downloaded").unwrap();
        let thumb_write_re = Regex::new(r"\[info\] Writing video thumbnail .+ to: (.+)").unwrap();
        let thumb_conv_re = Regex::new(r#"\[ThumbnailsConvertor\] Converting thumbnail "(.+)" to (\w+)"#).unwrap();
        let merger_re = Regex::new(r#"\[Merger\] Merging formats into "(.+)""#).unwrap();

        let mut last_progress = {
            let s = state_clone.lock().unwrap();
            match s.get(&id_clone_2) {
                Some(h) => match &h.last_progress {
                    Some(p) => p.clone(),
                    None => return,
                },
                None => return,
            }
        };

        let file = match std::fs::File::open(&stdout_path_clone) {
            Ok(f) => f,
            Err(e) => { println!("[YTDLP-{}] Erro log: {}", id_clone_2, e); return; }
        };
        
        let mut reader = BufReader::new(file);
        let mut stream_index = 0;
        let mut max_total_size = String::new();
        let mut last_real_percent = 0.0;
        let mut last_emit_time = std::time::Instant::now();
        let mut last_emitted_percent = -1.0;

        loop {
            loop {
                let mut raw = Vec::new();
                match reader.read_until(b'\n', &mut raw) {
                    Ok(0) => break,
                    Ok(_) => {
                        let full = String::from_utf8_lossy(&raw);
                        for line in full.split('\r').map(|l| l.trim_end_matches('\n').to_string()).filter(|l| !l.is_empty()) {
                            if !line.starts_with("[download]") { println!("[YTDLP-{}] {}", id_clone_2, line); }

                            if let Some(caps) = dest_re.captures(&line) {
                                let path = caps[1].trim().to_string();
                                let abs_path = std::path::Path::new(&path).to_string_lossy().to_string();
                                last_progress.output_path = abs_path.clone();
                                last_progress.filename = std::path::Path::new(&abs_path).file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                                let mut s = state_clone.lock().unwrap();
                                if let Some(h) = s.get_mut(&id_clone_2) { h.output_filepath = Some(abs_path); }
                            }

                            if let Some(caps) = already_re.captures(&line) {
                                let path = caps[1].trim().to_string();
                                let abs_path = std::path::Path::new(&path).to_string_lossy().to_string();
                                last_progress.output_path = abs_path.clone();
                                last_progress.filename = std::path::Path::new(&abs_path).file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                                let mut s = state_clone.lock().unwrap();
                                if let Some(h) = s.get_mut(&id_clone_2) { h.output_filepath = Some(abs_path); }
                            }

                            if let Some(caps) = thumb_write_re.captures(&line) {
                                let path = caps[1].trim().to_string();
                                last_progress.thumbnail_path = path.clone();
                                let mut s = state_clone.lock().unwrap();
                                if let Some(h) = s.get_mut(&id_clone_2) { h.thumbnail_filepath = Some(path); }
                            }

                            if let Some(caps) = thumb_conv_re.captures(&line) {
                                let path = std::path::Path::new(caps[1].trim()).with_extension(caps[2].trim()).to_string_lossy().to_string();
                                last_progress.thumbnail_path = path.clone();
                                let mut s = state_clone.lock().unwrap();
                                if let Some(h) = s.get_mut(&id_clone_2) { h.thumbnail_filepath = Some(path); }
                            }

                            if let Some(caps) = merger_re.captures(&line) {
                                let merged = caps[1].trim().to_string();
                                last_progress.output_path = merged.clone();
                                last_progress.filename = std::path::Path::new(&merged).file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                                last_progress.status = "preparing".to_string();
                                last_progress.percent = 98.0;
                                
                                if last_emit_time.elapsed().as_millis() > 500 {
                                    let mut s = state_clone.lock().unwrap();
                                    if let Some(h) = s.get_mut(&id_clone_2) {
                                        let normalized = std::path::Path::new(&merged).to_string_lossy().to_string();
                                        h.last_progress = Some(last_progress.clone());
                                        h.output_filepath = Some(normalized);
                                    }
                                    drop(s);
                                    let _ = app_clone.emit("download-progress", last_progress.clone());
                                    last_emit_time = std::time::Instant::now();
                                }
                            }

                            if let Some(caps) = progress_re.captures(&line) {
                                let real: f64 = caps[1].parse().unwrap_or(0.0);
                                if real < last_real_percent - 20.0 && last_real_percent > 50.0 { stream_index += 1; }
                                last_real_percent = real;
                                
                                let disp = match stream_index {
                                    0 => real * 0.8,
                                    1 => 80.0 + (real * 0.18),
                                    _ => 98.0 + (real * 0.02)
                                };
                                last_progress.percent = disp;
                                
                                // Respeita o estado oficial do registry
                                let current_status = {
                                    let s = state_clone.lock().unwrap();
                                    s.get(&id_clone_2)
                                     .map(|h| if h.is_paused { "paused" } else { "downloading" })
                                     .unwrap_or("downloading")
                                     .to_string()
                                };
                                last_progress.status = current_status;

                                let total = caps[2].trim().to_string();
                                if stream_index == 0 || total.len() > max_total_size.len() { max_total_size = total; }

                                last_progress.speed = caps[3].trim().to_string();
                                last_progress.eta = caps[4].trim().to_string();
                                last_progress.total_size = max_total_size.clone();

                                let now = std::time::Instant::now();
                                if (disp - last_emitted_percent).abs() >= 1.0 || now.duration_since(last_emit_time).as_millis() >= 100 || disp >= 99.9 {
                                    // Update state snapshot
                                    {
                                        let mut s = state_clone.lock().unwrap();
                                        if let Some(h) = s.get_mut(&id_clone_2) {
                                            h.last_progress = Some(last_progress.clone());
                                        }
                                    }
                                    let _ = app_clone.emit("download-progress", last_progress.clone());
                                    last_emit_time = now; 
                                    last_emitted_percent = disp;
                                }
                            }
                        }
                    }
                    Err(_) => break,
                }
            }

            let done = {
                let mut s = state_clone.lock().unwrap();
                s.get_mut(&id_clone_2).and_then(|h| h.process.as_mut()).map(|c| matches!(c.try_wait(), Ok(Some(_)))).unwrap_or(true)
            };
            if done { break; }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        let exit_status = {
            let mut s = state_clone.lock().unwrap();
            s.get_mut(&id_clone_2).and_then(|h| h.process.as_mut()?.wait().ok())
        };

        if let Some(status) = exit_status {
            let code = status.code().unwrap_or(-1);
            let ok = status.success() || code == 120 || last_progress.percent >= 98.0;
            if ok {
                last_progress.status = "completed".to_string(); 
                last_progress.percent = 100.0;
            } else {
                last_progress.status = "error".to_string();
                // Tenta ler o erro do log de stderr
                if let Ok(err_content) = std::fs::read_to_string(&stderr_path) {
                    let last_line = err_content.lines().last().unwrap_or("Erro desconhecido no yt-dlp").to_string();
                    last_progress.error_message = Some(last_line);
                }
            }
            
            // Final update to state
            {
                let mut s = state_clone.lock().unwrap();
                if let Some(h) = s.get_mut(&id_clone_2) {
                    h.last_progress = Some(last_progress.clone());
                }
            }

            // Ensure output_path is set before completion emit
            if last_progress.output_path.is_empty() {
                let s = state_clone.lock().unwrap();
                if let Some(h) = s.get(&id_clone_2) {
                    if let Some(ref path) = h.output_filepath {
                        last_progress.output_path = path.clone();
                        last_progress.filename = std::path::Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                    }
                }
            }

            let _ = app_clone.emit("download-progress", last_progress);
        }

        // Clean registry and logs
        {
            let mut s = state_clone.lock().unwrap();
            s.remove(&id_clone_2);
        }
        let _ = std::fs::remove_file(stdout_path_clone);
        let _ = std::fs::remove_file(stderr_path);
    });

    Ok(task_id)
}

#[tauri::command]
async fn cancel_download(
    id: String,
    state: tauri::State<'_, SharedDownloadState>,
    app: AppHandle,
) -> Result<(), String> {
    
    // ── 1. Coleta info e mata o processo com o lock ──
    let (output_path, thumb_path, output_dir, requested_title) = {
        let mut s = state.lock().unwrap();
        let Some(mut handle) = s.remove(&id) else {
            return Ok(()); // Já removido ou finalizado
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
            println!("[Universal Downloader] Download {} cancelado — PID {} encerrado.", id, pid);
        }

        (op, tp, od, rt)
    }; // <── lock liberado aqui

    // ── 2. Cleanup ASYNC em background ──
    let _id_c = id.clone();
    let app_c = app.clone();
    
    tauri::async_runtime::spawn(async move {
        // Wait inicial para garantir que yt-dlp soltou os arquivos (flush de disco)
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

        let search_dir = if let Some(ref p) = output_path {
            std::path::PathBuf::from(p).parent().map(|p| p.to_path_buf())
        } else {
            Some(std::path::PathBuf::from(&output_dir))
        };

        if let Some(parent) = search_dir {
            let stem_hint = if let Some(ref p) = output_path {
                let filename_full = std::path::Path::new(p).file_name()
                    .unwrap_or_default().to_string_lossy().to_string();
                let format_re = Regex::new(r"\.f\d+").unwrap();
                let mut ps = format_re.replace(&filename_full, "").to_string();
                if let Some(pos) = ps.rfind('.') { ps.truncate(pos); }
                ps
            } else {
                requested_title.clone()
            };

            let normalized_stem = normalize_title(&stem_hint);

            if let Ok(entries) = std::fs::read_dir(&parent) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_file() { continue; }

                    let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    let normalized_filename = normalize_title(&filename);

                    // Com normalize_title Agressivo (ASCII), starts_with é altamente confiável
                    let is_related = normalized_filename.starts_with(&normalized_stem);
                    
                    let is_temp = filename.ends_with(".part")
                        || filename.ends_with(".ytdl")
                        || filename.ends_with(".jpg")
                        || filename.ends_with(".webp")
                        || Regex::new(r"\.f\d+\.\w+$").unwrap().is_match(&filename);

                    if is_related && is_temp {
                        for _attempt in 0..5 {
                            if std::fs::remove_file(&path).is_ok() {
                                println!("[Cleanup] Removido arquivo órfão: {}", filename);
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

        let _ = app_c.emit("download-progress", DownloadProgress {
            id: _id_c,
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
        });
    });

    Ok(())
}

#[tauri::command]
fn pause_download(
    id: String,
    state: tauri::State<'_, SharedDownloadState>,
    app: AppHandle,
) -> Result<(), String> {
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
        println!("[Universal Downloader] Download {} retomado (PID {}).", id, pid);
    } else {
        suspend_process(pid)?;
        handle.is_paused = true;
        println!("[Universal Downloader] Download {} pausado (PID {}).", id, pid);
    }

    if let Some(mut progress) = handle.last_progress.clone() {
        progress.status = if handle.is_paused { "paused".to_string() } else { "downloading".to_string() };
        handle.last_progress = Some(progress.clone());
        println!("[Universal Downloader] Emitindo status '{}' para {}", progress.status, id);
        let _ = app.emit("download-progress", progress);
    } else {
        println!("[Universal Downloader] WARN: last_progress é None para {}, não emitindo status.", id);
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn get_process_tree(root_pid: u32) -> Vec<u32> {
    use winapi::um::tlhelp32::{CreateToolhelp32Snapshot, Process32First, Process32Next, TH32CS_SNAPPROCESS, PROCESSENTRY32};
    use winapi::um::handleapi::CloseHandle;
    use winapi::shared::minwindef::FALSE;

    let mut procs = Vec::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if !snapshot.is_null() {
            let mut entry: PROCESSENTRY32 = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32>() as u32;
            if Process32First(snapshot, &mut entry) != FALSE {
                loop {
                    procs.push((entry.th32ProcessID, entry.th32ParentProcessID));
                    if Process32Next(snapshot, &mut entry) == FALSE { break; }
                }
            }
            CloseHandle(snapshot);
        }
    }

    let mut tree = vec![root_pid];
    let mut added = true;
    while added {
        added = false;
        let mut new_children = Vec::new();
        for &parent in &tree {
            for &(pid, ppid) in &procs {
                if ppid == parent && !tree.contains(&pid) && !new_children.contains(&pid) {
                    new_children.push(pid);
                    added = true;
                }
            }
        }
        if !new_children.is_empty() {
            tree.extend(new_children);
        }
    }
    tree
}


// Função auxiliar: normaliza título para comparação
fn normalize_title(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(target_os = "windows")]
fn kill_process_tree(root_pid: u32) {
    use winapi::um::processthreadsapi::{OpenProcess, TerminateProcess};
    use winapi::um::winnt::PROCESS_TERMINATE;
    use winapi::shared::minwindef::FALSE;
    use winapi::um::handleapi::CloseHandle;

    let pids = get_process_tree(root_pid);
    // Kill from children to parents (reverse tree) is safer but TerminateProcess is ruthless anyway
    for pid in pids.into_iter().rev() {
        unsafe {
            let h = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
            if !h.is_null() {
                let _ = TerminateProcess(h, 1);
                CloseHandle(h);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn mod_threads_in_tree(root_pid: u32, suspend: bool) -> Result<(), String> {
    use winapi::um::processthreadsapi::{OpenThread, SuspendThread, ResumeThread};
    use winapi::um::tlhelp32::{CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32};
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::winnt::THREAD_SUSPEND_RESUME;
    use winapi::shared::minwindef::FALSE;

    let pids = get_process_tree(root_pid);
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snapshot.is_null() { return Err("Falha ao criar snapshot".to_string()); }
        let mut entry: THREADENTRY32 = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        if Thread32First(snapshot, &mut entry) != FALSE {
            loop {
                if pids.contains(&entry.th32OwnerProcessID) {
                    let thread = OpenThread(THREAD_SUSPEND_RESUME, FALSE, entry.th32ThreadID);
                    if !thread.is_null() {
                        if suspend {
                            SuspendThread(thread);
                        } else {
                            ResumeThread(thread);
                        }
                        CloseHandle(thread);
                    }
                }
                if Thread32Next(snapshot, &mut entry) == FALSE { break; }
            }
        }
        CloseHandle(snapshot);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn suspend_process(pid: u32) -> Result<(), String> {
    mod_threads_in_tree(pid, true)
}

#[cfg(target_os = "windows")]
fn resume_process(pid: u32) -> Result<(), String> {
    mod_threads_in_tree(pid, false)
}

#[cfg(target_os = "macos")]
fn suspend_process(pid: u32) -> Result<(), String> {
    use std::process::Command;
    Command::new("kill")
        .args(["-STOP", &pid.to_string()])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn resume_process(pid: u32) -> Result<(), String> {
    use std::process::Command;
    Command::new("kill")
        .args(["-CONT", &pid.to_string()])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn suspend_process(pid: u32) -> Result<(), String> {
    use std::process::Command;
    Command::new("kill")
        .args(["-STOP", &pid.to_string()])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn resume_process(pid: u32) -> Result<(), String> {
    use std::process::Command;
    Command::new("kill")
        .args(["-CONT", &pid.to_string()])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}


#[tauri::command]
async fn select_download_folder(app: AppHandle) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    
    let _ = app.dialog()
        .file()
        .set_title("Select Download Folder")
        .pick_folder(move |folder| {
            let _ = tx.send(folder);
        });
    
    match rx.recv() {
        Ok(Some(path)) => Ok(path.to_string()),
        _ => Err("No folder selected".to_string())
    }
}

#[tauri::command]
async fn get_video_metadata(app: AppHandle, url: String) -> Result<String, String> {
    use tauri::Manager;
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let ytdlp_path = resource_dir.join("yt-dlp.exe");

    // Run in a blocking thread so Tauri's async runtime isn't starved
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
            println!("[YTDLP-ERROR] Falha no get_video_metadata. STDERR: {}", stderr.trim());
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
fn open_folder_natively(path: String) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(&path)
            .spawn();
    }
}

/// Check if a file with the given title already exists in a directory.
/// Uses ASCII-normalized fuzzy matching (same method as thumbnail search)
/// to handle yt-dlp's Unicode sanitization.
#[tauri::command]
fn find_file_by_title(dir: String, title: String) -> bool {
    let title_norm = ascii_alphanum(&title);
    // Need at least 8 chars to have a meaningful match
    if title_norm.len() < 8 {
        return false;
    }
    let threshold = (title_norm.len() * 4 / 5).max(10);

    let Ok(entries) = std::fs::read_dir(&dir) else { return false; };

    for entry in entries.filter_map(|e| e.ok()) {
        let fname = entry.file_name();
        let fname_str = fname.to_string_lossy();
        let ext = std::path::Path::new(fname_str.as_ref())
            .extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        // Skip image files; only check media files
        if matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif") {
            continue;
        }
        let file_stem = std::path::Path::new(fname_str.as_ref())
            .file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let file_norm = ascii_alphanum(&file_stem);

        let common = title_norm.chars()
            .zip(file_norm.chars())
            .take_while(|(a, b)| a == b)
            .count();

        if common >= threshold {
            return true;
        }
    }
    false
}

/// Reduce a filename to ASCII alphanumeric chars only (lowercase) for fuzzy matching.
/// This handles the yt-dlp stdout→filesystem Unicode mismatch:
/// stdout outputs "httpst.conAElyqLBcY" but disk has "https：⧸⧸t.co⧸nAElyqLBcY"
fn ascii_alphanum(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

#[tauri::command]
fn read_thumbnail_as_base64(path: String) -> Result<String, String> {
    let file_path = std::path::Path::new(&path);

    // Happy path: exact match
    if file_path.exists() {
        let data = std::fs::read(&path).map_err(|e| e.to_string())?;
        let base64 = base64_encode(&data);
        let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
        let mime = match ext { "png" => "image/png", "gif" => "image/gif", "webp" => "image/webp", _ => "image/jpeg" };
        return Ok(format!("data:{};base64,{}", mime, base64));
    }

    // File not found — yt-dlp logged an ASCII-sanitized name but saved with Unicode chars.
    // Scan the parent directory and match by ASCII-normalized stem.
    if let Some(parent) = file_path.parent() {
        let stem = file_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let stem_norm = ascii_alphanum(stem);

        if let Ok(entries) = std::fs::read_dir(parent) {
            let mut best_match: Option<(usize, std::path::PathBuf)> = None;

            for entry in entries.filter_map(|e| e.ok()) {
                let fname = entry.file_name();
                let fname_str = fname.to_string_lossy();
                let low = fname_str.to_lowercase();
                // Only consider image files
                if !low.ends_with(".jpg") && !low.ends_with(".jpeg") && !low.ends_with(".webp") && !low.ends_with(".png") {
                    continue;
                }
                let file_stem = std::path::Path::new(fname_str.as_ref())
                    .file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
                let file_norm = ascii_alphanum(&file_stem);

                // Count how many leading chars match after normalization
                let common = stem_norm.chars()
                    .zip(file_norm.chars())
                    .take_while(|(a, b)| a == b)
                    .count();

                if common > best_match.as_ref().map(|(n, _)| *n).unwrap_or(0) {
                    best_match = Some((common, entry.path()));
                }
            }

            // Accept the match if at least 10 chars in common (enough to be confident)
            if let Some((score, matched_path)) = best_match {
                if score >= 10 {
                    let data = std::fs::read(&matched_path).map_err(|e| e.to_string())?;
                    let base64 = base64_encode(&data);
                    return Ok(format!("data:image/jpeg;base64,{}", base64));
                }
            }
        }
    }

    Err(format!("Thumbnail não encontrada: {}", path))
}


fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;
        result.push(CHARS[b0 >> 2] as char);
        result.push(CHARS[((b0 & 0x03) << 4) | (b1 >> 4)] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[b2 & 0x3f] as char);
        } else {
            result.push('=');
        }
    }
    result
}

#[tauri::command]
fn check_files_exist(paths: Vec<String>) -> Vec<bool> {
    paths.into_iter().map(|p| std::path::Path::new(&p).exists()).collect()
}

#[tauri::command]
fn resolve_paths(paths: Vec<String>) -> Vec<Option<String>> {
    paths.into_iter().map(|p| {
        let path = std::path::Path::new(&p);
        if path.exists() {
            return Some(p);
        }

        // Se não existe, tenta encontrar por fuzzy match no diretório pai
        if let (Some(parent), Some(filename)) = (path.parent(), path.file_name()) {
            let filename_str = filename.to_string_lossy();
            let file_stem = std::path::Path::new(filename_str.as_ref())
                .file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let target_norm = ascii_alphanum(file_stem);
            let target_ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

            if target_norm.len() >= 5 {
                if let Ok(entries) = std::fs::read_dir(parent) {
                    let mut best_match: Option<(usize, String)> = None;
                    for entry in entries.flatten() {
                        let entry_path = entry.path();
                        if !entry_path.is_file() { continue; }

                        let entry_name = entry.file_name();
                        let entry_name_str = entry_name.to_string_lossy();
                        let entry_stem = std::path::Path::new(entry_name_str.as_ref())
                            .file_stem().and_then(|s| s.to_str()).unwrap_or("");
                        let entry_norm = ascii_alphanum(entry_stem);
                        let entry_ext = entry_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

                        // Permite correspondência mesmo se extensões diferem levemente (mp4 vs mkv)
                        let ext_match = target_ext.is_empty() || entry_ext.is_empty() 
                            || target_ext == entry_ext 
                            || (target_ext == "mp4" && entry_ext == "m4v")
                            || (target_ext == "m4v" && entry_ext == "mp4");

                        if !ext_match { continue; }

                        // Fuzzy match: verifica se um é substring do outro após normalização
                        // ou se há correspondência de prefixo suficiente
                        let common = target_norm.chars()
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
                        println!("[Resolve] Fuzzy matched: {} -> {}", p, found_path);
                        return Some(found_path);
                    }
                }
            }

            // Fallback adicional: tenta encontrar apenas pelo prefixo do título
            let search_key = file_stem
                .chars()
                .take_while(|c| !c.is_ascii_digit())
                .collect::<String>();
            
            if search_key.len() >= 5 {
                if let Ok(entries) = std::fs::read_dir(parent) {
                    for entry in entries.flatten() {
                        let entry_path = entry.path();
                        if !entry_path.is_file() { continue; }
                        
                        let entry_name = entry_path.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("");
                        
                        let normalized_search = search_key.to_lowercase();
                        let normalized_entry = entry_name.to_lowercase();
                        
                        if normalized_entry.contains(&normalized_search) || 
                           normalized_search.contains(&normalized_entry.split('.').next().unwrap_or(&normalized_entry)) {
                            let ext = entry_path.extension()
                                .and_then(|e| e.to_str())
                                .unwrap_or("")
                                .to_lowercase();
                            let valid_exts = ["mp4", "mkv", "avi", "mov", "webm", "m4v", "mp3", "flac", "aac", "wav", "ogg", "m4a", "opus"];
                            if valid_exts.contains(&ext.as_str()) {
                                println!("[Resolve] Prefix fallback: {} -> {}", p, entry_path.display());
                                return Some(entry_path.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
        }
        None
    }).collect()
}

#[tauri::command]
fn scan_download_folder(folder_path: String) -> Result<Vec<HistoryEntry>, String> {
    let path = std::path::Path::new(&folder_path);
    if !path.exists() || !path.is_dir() {
        return Err("Diretório não existe".to_string());
    }

    let mut items = Vec::new();
    let video_exts = vec!["mp4", "mkv", "avi", "mov", "webm", "flv", "m4v", "ts"];
    let audio_exts = vec!["mp3", "flac", "aac", "wav", "ogg", "m4a", "opus"];

    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if !entry_path.is_file() { continue; }

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
            let completed_at = metadata.modified().unwrap_or(std::time::SystemTime::now())
                .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
            
            let size = metadata.len();
            let size_label = if size >= 1024 * 1024 * 1024 {
                format!("{:.2} GB", size as f64 / (1024.0 * 1024.0 * 1024.0))
            } else if size >= 1024 * 1024 {
                format!("{:.2} MB", size as f64 / (1024.0 * 1024.0))
            } else {
                format!("{} KB", size / 1024)
            };

            items.push(HistoryEntry {
                id: Uuid::new_v4().to_string(), // Temporary ID for scanned items
                title: filename.clone(),
                filename,
                filepath: entry_path.to_string_lossy().to_string(),
                url: "".to_string(), // Unknown from disk scan
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
fn save_history(app: AppHandle, mut items: Vec<HistoryEntry>) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let history_dir = app_data.join("persistence");
    if !history_dir.exists() {
        std::fs::create_dir_all(&history_dir).map_err(|e| e.to_string())?;
    }
    let history_file = history_dir.join("history.json");

    // Order by newest and limit to 100
    items.sort_by(|a, b| b.completed_at.cmp(&a.completed_at));
    if items.len() > 100 {
        items.truncate(100);
    }

    let json = serde_json::to_string_pretty(&items).map_err(|e| e.to_string())?;
    std::fs::write(history_file, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_history(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let history_file = app_data.join("persistence").join("history.json");

    if !history_file.exists() {
        return Ok(Vec::new());
    }

    let json = std::fs::read_to_string(history_file).map_err(|e| e.to_string())?;
    let items: Vec<HistoryEntry> = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(items)
}

fn main() {
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
            scan_download_folder,
            save_history,
            load_history
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar o aplicativo Tauri");
}
