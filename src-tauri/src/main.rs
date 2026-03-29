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
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Serialize, Deserialize, Debug)]
struct DownloadProgress {
    percent: f64,
    speed: String,
    eta: String,
    status: String,
    filename: String,
    output_path: String,
    total_size: String,
    thumbnail_path: String,
}

struct DownloadState {
    process: Option<Child>,
    is_paused: bool,
    output_filepath: Option<String>,
    thumbnail_filepath: Option<String>,
}

impl Default for DownloadState {
    fn default() -> Self {
        Self {
            process: None,
            is_paused: false,
            output_filepath: None,
            thumbnail_filepath: None,
        }
    }
}

type SharedDownloadState = Arc<Mutex<DownloadState>>;

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
    app: AppHandle,
    state: tauri::State<'_, SharedDownloadState>,
) -> Result<(), String> {
    if url.is_empty() {
        return Err("URL não fornecida".to_string());
    }

    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL inválida".to_string());
    }

    let final_path = if output_dir.is_empty() || output_dir == "default_path" {
        get_default_download_path()
    } else {
        output_dir.clone()
    };

    let format_val = format_type.unwrap_or_else(|| "video".to_string());

    let output_template = format!("{}/%(title)s.%(ext)s", final_path.trim_end_matches(['/', '\\']));

    use tauri::Manager;
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let ytdlp_path = resource_dir.join("yt-dlp.exe");

    if !ytdlp_path.exists() {
        return Err(format!("yt-dlp.exe não encontrado no caminho: {}", ytdlp_path.display()));
    }

    fn find_available_browser() -> Option<String> {
        let firefox_path = "C:\\Users\\Lux\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles";
        if std::path::Path::new(firefox_path).exists() {
            return Some("firefox".to_string());
        }

        let edge_path = "C:\\Users\\Lux\\AppData\\Local\\Microsoft\\Edge\\User Data";
        if std::path::Path::new(edge_path).exists() {
            return Some("edge".to_string());
        }

        None
    }

    let browser = find_available_browser();
    let browser_arg = browser.unwrap_or_else(|| "".to_string());
    
    let use_cookies = !browser_arg.is_empty() && (browser_arg == "firefox" || browser_arg == "edge");

    let mut path_var = std::env::var("PATH").unwrap_or_default();
    path_var = format!("C:\\Users\\Lux\\.deno\\bin;C:\\Program Files\\nodejs;{}", path_var);

    // Try to find ffmpeg and add it to PATH so yt-dlp can merge formats
    let ffmpeg_candidates = [
        "C:\\ffmpeg\\bin",
        "C:\\Program Files\\ffmpeg\\bin",
        "C:\\Program Files (x86)\\ffmpeg\\bin",
        "C:\\Users\\Lux\\scoop\\shims",
        "C:\\ProgramData\\chocolatey\\bin",
    ];
    for candidate in &ffmpeg_candidates {
        if std::path::Path::new(&format!("{}\\ffmpeg.exe", candidate)).exists()
            || std::path::Path::new(&format!("{}\\ffmpeg", candidate)).exists()
        {
            println!("[INFO] ffmpeg encontrado em: {}", candidate);
            path_var = format!("{};{}", candidate, path_var);
            break;
        }
    }

    let mut args: Vec<String> = vec![
        "--no-playlist".to_string(),
        "--write-thumbnail".to_string(),
        "--convert-thumbnails".to_string(), "jpg".to_string(),
        "--progress-template".to_string(), "[download] %(progress._percent_str)s of %(progress._total_bytes_str)s at %(progress._speed_str)s ETA %(progress._eta_str)s".to_string(),
        "--newline".to_string(),
        "--no-colors".to_string(),
    ];
    
    let mut is_audio_only = false;
    let q_str = quality.unwrap_or_else(|| "".to_string());
    
    match (format_val.as_str(), q_str.as_str()) {
        ("audio", _) | (_, "AUDIO ONLY") => {
            is_audio_only = true;
            args.push("-f".to_string());
            args.push("bestaudio/best".to_string());
            args.push("--extract-audio".to_string());
            args.push("--audio-format".to_string());
            args.push("mp3".to_string());
        },
        (_, q) if q.ends_with("P VIDEO") => {
            let height_str = q.replace("P VIDEO", "");
            let format_filter = format!("bestvideo[height<={height_str}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={height_str}]+bestaudio/best");
            args.push("-f".to_string());
            args.push(format_filter);
        },
        _ => {
            args.push("-f".to_string());
            args.push("bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best".to_string());
        }
    }
    
    if !is_audio_only {
        args.push("--merge-output-format".to_string());
        args.push("mp4".to_string());
    }
    
    if use_cookies {
        args.push("--cookies-from-browser".to_string());
        args.push(browser_arg);
    }
    
    args.push("-o".to_string());
    args.push(output_template);
    args.push(url.clone());

    

    let tmp_dir = std::env::temp_dir();
    let stdout_path = tmp_dir.join("ytdlp_stdout.log");
    let stderr_path = tmp_dir.join("ytdlp_stderr.log");

    // Truncate/create the log files fresh for this download
    let stdout_file = std::fs::File::create(&stdout_path)
        .map_err(|e| format!("Falha ao criar ficheiro de log stdout: {}", e))?;
    let stderr_file = std::fs::File::create(&stderr_path)
        .map_err(|e| format!("Falha ao criar ficheiro de log stderr: {}", e))?;

    let child = Command::new(&ytdlp_path)
        .args(&args)
        .env("PATH", path_var)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdout(stdout_file)
        .stderr(stderr_file)
        .stdin(Stdio::null())
        .creation_flags(0x08000000) // CREATE_NO_WINDOW on Windows
        .spawn()
        .map_err(|e| format!("Falha ao iniciar yt-dlp: {}", e))?;

    {
        let mut s = state.lock().unwrap();
        s.process = Some(child);
        s.is_paused = false;
        s.output_filepath = None;
        s.thumbnail_filepath = None;
    }

    let app_clone = app.clone();

    // Stderr reader thread — reads from temp file
    let stderr_path_clone = stderr_path.clone();
    std::thread::spawn(move || {
        // Wait briefly for the process to start writing
        std::thread::sleep(std::time::Duration::from_millis(500));
        let Ok(file) = std::fs::File::open(&stderr_path_clone) else { return; };
        let reader = BufReader::new(file);
        for line in reader.lines() {
            if let Ok(line) = line {
                println!("[YTDLP-ERR] {}", line);
            }
        }
    });

    let stdout_path_clone = stdout_path.clone();
    let state_clone = Arc::clone(&state);

    std::thread::spawn(move || {
        // Wait briefly for yt-dlp to create/start writing to the file
        std::thread::sleep(std::time::Duration::from_millis(300));

        let progress_re = Regex::new(
            r"\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*\w+)\s+at\s+([\d.]+\s*\w+/s)\s+ETA\s+([\d:]+)"
        ).unwrap();

        let dest_re     = Regex::new(r"\[download\] Destination: (.+)").unwrap();
        let thumb_write_re = Regex::new(r"\[info\] Writing video thumbnail .+ to: (.+)").unwrap();
        let thumb_conv_re  = Regex::new(r#"\[ThumbnailsConvertor\] Converting thumbnail "(.+)" to (\w+)"#).unwrap();
        let merger_re  = Regex::new(r#"\[Merger\] Merging formats into "(.+)""#).unwrap();

        let mut last_progress = DownloadProgress {
            percent: 0.0,
            speed: "—".to_string(),
            eta: "—".to_string(),
            status: "downloading".to_string(),
            filename: String::new(),
            output_path: String::new(),
            total_size: String::new(),
            thumbnail_path: String::new(),
        };
        let mut stream_index: u32 = 0;  // 0=video, 1=audio, 2+=other
        let mut max_total_size = String::new(); // keep largest size (video), not audio size
        let mut last_real_percent: f64 = 0.0;   // track raw percent to detect stream switches

        // Tail-read the stdout file line by line while process runs
        // Open the file inside the thread after a small delay
        let file = match std::fs::File::open(&stdout_path_clone) {
            Ok(f) => f,
            Err(e) => { println!("[YTDLP] Erro ao abrir stdout log: {}", e); return; }
        };
        let mut reader = BufReader::new(file);
        let mut last_logged_percent: f64 = -15.0; // log at 0% and every 15% after
        let mut last_emit_time = std::time::Instant::now();
        let mut last_emitted_percent = -1.0_f64;

        loop {
            loop {
                let mut raw_bytes: Vec<u8> = Vec::new();
                match reader.read_until(b'\n', &mut raw_bytes) {
                    Ok(0) => break, // No new data yet — wait and retry
                    Ok(_) => {
                        // Lossy UTF-8: safely handles non-UTF-8 bytes from ffmpeg/merge output
                        let full_line = String::from_utf8_lossy(&raw_bytes);
                        
                        for chunk in full_line.split('\r') {
                            let line = chunk.trim_end_matches('\n').to_string();
                            if line.is_empty() || line.trim().is_empty() { continue; }

                            // Log non-progress lines only; [download] lines are logged throttled below
                            if !line.starts_with("[download]") {
                                println!("[YTDLP] {}", line);
                            }

                        if let Some(caps) = dest_re.captures(&line) {
                            let path = caps[1].trim().to_string();
                            last_progress.output_path = path.clone();
                            last_progress.filename = std::path::Path::new(&path)
                                .file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                            let mut s = state_clone.lock().unwrap();
                            s.output_filepath = Some(path);
                        }

                        let lower_line = line.to_lowercase();
                        if lower_line.contains("[youtube]") || lower_line.contains("[twitter]")
                            || lower_line.contains("extracting") || lower_line.contains("downloading webpage")
                            || lower_line.contains("downloading m3u8") || lower_line.contains("downloading guest token")
                            || lower_line.contains("downloading graphql")
                        {
                            last_progress.percent = 0.0;
                            last_progress.speed = "-".to_string();
                            last_progress.eta = "-".to_string();
                            last_progress.status = "preparing".to_string();
                            let _ = app_clone.emit("download-progress", last_progress.clone());
                        }

                        // thumb_write: capture initial webp path
                        if let Some(caps) = thumb_write_re.captures(&line) {
                            let thumb_path = caps[1].trim().to_string();
                            if !thumb_path.is_empty() {
                                last_progress.thumbnail_path = thumb_path.clone();
                                let mut s = state_clone.lock().unwrap();
                                s.thumbnail_filepath = Some(thumb_path);
                            }
                        }

                        // thumb_convert: derive jpg path from webp path + target extension
                        if let Some(caps) = thumb_conv_re.captures(&line) {
                            let src_path = caps[1].trim().to_string();
                            let target_ext = caps[2].trim().to_string();
                            let jpg_path = std::path::Path::new(&src_path)
                                .with_extension(&target_ext)
                                .to_string_lossy().to_string();
                            if !jpg_path.is_empty() {
                                last_progress.thumbnail_path = jpg_path.clone();
                                let mut s = state_clone.lock().unwrap();
                                s.thumbnail_filepath = Some(jpg_path);
                            }
                        }

                        // merger: update output_path to final merged file
                        if let Some(caps) = merger_re.captures(&line) {
                            let merged = caps[1].trim().to_string();
                            println!("[YTDLP] Merge → '{}'", merged);
                            last_progress.output_path = merged.clone();
                            last_progress.filename = std::path::Path::new(&merged)
                                .file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                            last_progress.status = "preparing".to_string();
                            last_progress.percent = 98.0;
                            let _ = app_clone.emit("download-progress", last_progress.clone());
                            let mut s = state_clone.lock().unwrap();
                            s.output_filepath = Some(merged);
                        }

                        if let Some(caps) = progress_re.captures(&line) {
                            let real_percent: f64 = caps[1].parse().unwrap_or(0.0);
                            let total_size = caps[2].trim().to_string();
                            let speed = caps[3].trim().to_string();
                            let eta = caps[4].trim().to_string();

                            if real_percent < last_real_percent - 20.0 && last_real_percent > 50.0 {
                                stream_index += 1;
                                last_logged_percent = -15.0;
                                println!("[YTDLP-INFO] Stream {} iniciado (real {:.0}%→{:.0}%)",
                                    stream_index, last_real_percent, real_percent);
                            }
                            last_real_percent = real_percent;

                            // Scale progress for smooth multi-stream UX:
                            // stream 0 (video): 0–80%, stream 1 (audio): 80–98%, merge: 98–100%
                            let display_percent = match stream_index {
                                0 => real_percent * 0.80,
                                1 => 80.0 + real_percent * 0.18,
                                _ => 98.0 + real_percent * 0.02,
                            };

                            // Keep the largest size seen (video stream), not audio size
                            if stream_index == 0 || total_size.len() > max_total_size.len() {
                                max_total_size = total_size;
                            }

                            last_progress.percent = display_percent;
                            last_progress.speed = speed;
                            last_progress.eta = eta;
                            last_progress.total_size = max_total_size.clone();
                            last_progress.status = "downloading".to_string();

                            // Log only every 15% to keep terminal readable
                            if real_percent - last_logged_percent >= 15.0 || real_percent >= 99.9 {
                                println!("[YTDLP-PROGRESS] stream={} {:.1}% (display={:.0}%) of {} at {} ETA {}",
                                    stream_index, real_percent, display_percent,
                                    last_progress.total_size, last_progress.speed, last_progress.eta);
                                last_logged_percent = real_percent;
                            }
                            
                            // Throttle IPC emission to max 1 per 100ms or 1% change or completion
                            let now = std::time::Instant::now();
                            if (display_percent - last_emitted_percent).abs() >= 1.0 
                                || now.duration_since(last_emit_time).as_millis() >= 100 
                                || display_percent >= 99.9 
                            {
                                let _ = app_clone.emit("download-progress", last_progress.clone());
                                last_emit_time = now;
                                last_emitted_percent = display_percent;
                            }
                        }

                        if line.to_lowercase().contains("has already been downloaded") {
                            last_progress.percent = 100.0;
                            last_progress.status = "skipped".to_string();
                            let _ = app_clone.emit("download-progress", last_progress.clone());
                        }
                    }
                }
                    Err(_) => break, // Ignore encoding errors and continue
                }
            }

            // Check if the process has finished
            let process_done = {
                let mut s = state_clone.lock().unwrap();
                s.process.as_mut().map(|c| matches!(c.try_wait(), Ok(Some(_)))).unwrap_or(true)
            };

            if process_done {
                // One last read pass to catch any remaining lines
                let mut raw_bytes = Vec::new();
                while reader.read_until(b'\n', &mut raw_bytes).unwrap_or(0) > 0 {
                    let full_line = String::from_utf8_lossy(&raw_bytes);
                    for chunk in full_line.split('\r') {
                        let line = chunk.trim_end_matches('\n').to_string();
                        if !line.is_empty() && !line.trim().is_empty() { 
                            println!("[YTDLP] {}", line); 
                        }
                    }
                    raw_bytes.clear();
                }
                break;
            }

            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        // Wait for process to fully exit and get exit code
        let exit_status = {
            let mut s = state_clone.lock().unwrap();
            s.process.as_mut().and_then(|c| c.wait().ok())
        };

        if let Some(status) = exit_status {
            let exit_code = status.code().unwrap_or(-1);
            println!("[YTDLP] Processo encerrado. exit_code={} last_status='{}' last_percent={:.1}%",
                exit_code, last_progress.status, last_progress.percent);

            // Exit code 120 = Python interpreter flush error during shutdown.
            // Occasional code 1 means minor error on shutdown (e.g. reddit after merge). We consider it Ok if >= 98%.
            let is_success = status.success() || exit_code == 120 || last_progress.percent >= 98.0;

            if is_success && last_progress.status != "completed" && last_progress.status != "skipped" {
                last_progress.status = "completed".to_string();
                last_progress.percent = 100.0;
                let _ = app_clone.emit("download-progress", last_progress.clone());
            } else if !is_success && last_progress.status != "idle" {
                last_progress.status = "error".to_string();
                let _ = app_clone.emit("download-progress", last_progress);
            }
        }

        let mut s = state_clone.lock().unwrap();
        s.process = None;
    });

    Ok(())
}

#[tauri::command]
fn cancel_download(
    state: tauri::State<'_, SharedDownloadState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    if let Some(ref mut child) = s.process {
        child.kill().map_err(|e| format!("Erro ao matar processo: {}", e))?;
        println!("[Universal Downloader] Download cancelado — processo yt-dlp encerrado.");
    }
    s.process = None;
    s.is_paused = false;
    s.output_filepath = None;
    s.thumbnail_filepath = None;

    let _ = app.emit("download-progress", DownloadProgress {
        percent: 0.0,
        speed: String::new(),
        eta: String::new(),
        status: "idle".to_string(),
        filename: String::new(),
        output_path: String::new(),
        total_size: String::new(),
        thumbnail_path: String::new(),
    });

    Ok(())
}

#[tauri::command]
fn pause_download(
    state: tauri::State<'_, SharedDownloadState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    let Some(ref child) = s.process else {
        return Err("Nenhum download ativo".to_string());
    };
    let pid = child.id();

    if s.is_paused {
        resume_process(pid)?;
        s.is_paused = false;
        let _ = app.emit("download-paused", false);
        println!("[Universal Downloader] Download retomado (PID {}).", pid);
    } else {
        suspend_process(pid)?;
        s.is_paused = true;
        let _ = app.emit("download-paused", true);
        println!("[Universal Downloader] Download pausado (PID {}).", pid);
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
        let output = std::process::Command::new(&ytdlp_path)
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

fn main() {
    let download_state: SharedDownloadState = Arc::new(Mutex::new(DownloadState::default()));

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
            read_thumbnail_as_base64
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar o aplicativo Tauri");
}
