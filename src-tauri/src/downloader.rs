use once_cell::sync::Lazy;
use regex::Regex;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tracing::{debug, error, info};

use crate::types::{DownloadProgress, SharedDownloadState};

use tauri::AppHandle;
use tauri::Emitter;

static PROGRESS_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*\w+)\s+at\s+([\d.]+\s*\w+/s)\s+ETA\s+([\d:]+)").unwrap()
});

static DEST_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\[download\] Destination: (.+)").unwrap()
});

static ALREADY_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\[download\] (.+) has already been downloaded").unwrap()
});

static THUMB_WRITE_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\[info\] Writing video thumbnail .+ to: (.+)").unwrap()
});

static THUMB_CONV_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"\[ThumbnailsConvertor\] Converting thumbnail "(.+)" to (\w+)""#).unwrap()
});

static MERGER_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"\[Merger\] Merging formats into "(.+)""#).unwrap()
});

static MERGER_DEST_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\[Merger\] Destination: (.+)").unwrap()
});

static CONVERT_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\[(ExtractAudio|ConvertAudio|Post-processing|FFmpeg)\]").unwrap()
});



pub fn build_ytdlp_args(
    ytdlp_path: &PathBuf,
    url: &str,
    output_dir: &str,
    quality: Option<String>,
    format_type: Option<String>,
    _title: Option<String>,
    extension: Option<String>,
    is_playlist: bool,
) -> Result<(String, Vec<String>), String> {
    let resource_dir = ytdlp_path.parent().ok_or("Invalid yt-dlp path")?;
    let final_path = if output_dir.is_empty() || output_dir == "default_path" {
        crate::utils::get_default_download_path()
    } else {
        output_dir.to_string()
    };

    let format_val = format_type.unwrap_or_else(|| "video".to_string());
    let output_template = format!("{}/%(title)s.%(ext)s", final_path.trim_end_matches(['/', '\\']));

    // Opt 5: Usar a versão memoizada (cached) que verifica o disco apenas uma vez
    let browser_arg = crate::utils::get_cached_browser().unwrap_or_else(|| "".to_string());
    let use_cookies = !browser_arg.is_empty() && (browser_arg == "firefox" || browser_arg == "edge");

    let mut args: Vec<String> = vec![
        "--ffmpeg-location".to_string(),
        resource_dir.to_string_lossy().to_string(),
        "--write-thumbnail".to_string(),
        "--convert-thumbnails".to_string(),
        "jpg".to_string(),
        "--progress-template".to_string(),
        "[download] %(progress._percent_str)s of %(progress._total_bytes_str)s at %(progress._speed_str)s ETA %(progress._eta_str)s".to_string(),
        "--newline".to_string(),
        "--no-colors".to_string(),
    ];

    if !is_playlist {
        args.push("--no-playlist".to_string());
    }

    let q_str = quality.clone().unwrap_or_else(|| "".to_string());
    let is_audio_only = q_str.ends_with("AUDIO") || format_val == "audio";
    let ext = extension.unwrap_or_else(|| "mp3".to_string());
    let ext_lower = ext.to_lowercase();
    
    let audio_format = match ext_lower.as_str() {
        "mp3" => "mp3",
        "m4a" => "m4a",
        "ogg" => "vorbis",
        "flac" => "flac",
        "wav" => "wav",
        _ => "mp3",
    };

    match (format_val.as_str(), q_str.as_str()) {
        ("audio", _) | (_, "AUDIO ONLY") => {
            args.extend_from_slice(&[
                "-f".to_string(),
                "bestaudio/best".to_string(),
                "--extract-audio".to_string(),
                "--audio-format".to_string(),
                audio_format.to_string(),
            ]);
            info!("Audio format: {}", ext);
        }
        (_, q) if q.ends_with("P") && !q.contains("AUDIO") => {
            let height = q.replace("P", "");
            args.extend_from_slice(&[
                "-f".to_string(),
                format!("bestvideo[height<={height}][ext={}]+bestaudio[ext=m4a]/bestvideo[height<={height}]+bestaudio", ext_lower),
            ]);
            if !is_audio_only {
                args.extend_from_slice(&["--merge-output-format".to_string(), ext_lower.clone()]);
            }
            info!("Video format: {} (height={})", q_str, height);
        }
        _ => {
            args.extend_from_slice(&[
                "-f".to_string(),
                format!("bestvideo[ext={}]+bestaudio[ext=m4a]/bestvideo+bestaudio", ext_lower),
            ]);
            if !is_audio_only {
                args.extend_from_slice(&["--merge-output-format".to_string(), ext_lower.clone()]);
            }
            info!("Format: best quality");
        }
    }

    if use_cookies {
        args.extend_from_slice(&["--cookies-from-browser".to_string(), browser_arg]);
    }

    args.extend_from_slice(&["-o".to_string(), output_template, url.to_string()]);

    Ok((final_path, args))
}

pub fn spawn_download_thread(
    _ytdlp_path: PathBuf,
    _args: Vec<String>,
    task_id: String,
    _url: String,
    _quality: String,
    _format_val: String,
    _extension: String,
    _output_dir: String,
    _requested_title: String,
    state: SharedDownloadState,
    app: AppHandle,
    stderr_path: PathBuf,
    stdout_path: PathBuf,
    _is_audio: bool,
) {
    use std::thread;
    use std::fs::File;

    // Fix 3: nomes explícitos para cada thread para evitar captura ambígua
    let id_clone = task_id.clone();       // usado pela thread de stdout (abaixo)
    let state_clone = Arc::clone(&state);
    let app_clone = app.clone();

    thread::spawn(move || {
        let progress_re = &*PROGRESS_REGEX;
        let dest_re = &*DEST_REGEX;
        let already_re = &*ALREADY_REGEX;
        let thumb_write_re = &*THUMB_WRITE_REGEX;
        let thumb_conv_re = &*THUMB_CONV_REGEX;
        let merger_re = &*MERGER_REGEX;
        let merger_dest_re = &*MERGER_DEST_REGEX;
        let convert_re = &*CONVERT_REGEX;

        let stderr_path_clone = stderr_path.clone();
        // Fix 3: variáveis com nomes distintos para a thread do stderr
        let stderr_task_id = id_clone.clone();
        let state_for_stderr = Arc::clone(&state);
        let app_for_stderr = app.clone();
        // id_clone_2 é o ID que a thread de stdout vai usar (declarado após o spawn do stderr)
        let id_clone_2 = id_clone.clone();

        thread::spawn(move || {
            thread::sleep(std::time::Duration::from_millis(500));
            if let Ok(file) = File::open(&stderr_path_clone) {
                let reader = BufReader::new(file);
                for line in reader.lines().flatten() {
                    // Detect conversion in stderr
                    if convert_re.is_match(&line) {
                        let mut s = state_for_stderr.lock().unwrap();
                        if let Some(h) = s.get_mut(&stderr_task_id) {
                            h.last_progress = Some(DownloadProgress {
                                status: "converting".to_string(),
                                percent: 99.0,
                                ..h.last_progress.clone().unwrap_or_default()
                            });
                        }
                        drop(s);
                        let _ = app_for_stderr.emit("download-progress", DownloadProgress {
                            id: stderr_task_id.clone(),
                            status: "converting".to_string(),
                            percent: 99.0,
                            ..Default::default()
                        });
                    }
                }
            }
        });

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

        let file = match File::open(&stdout_path) {
            Ok(f) => f,
            Err(e) => {
                error!("[YTDLP-{}] Error opening log: {}", id_clone_2, e);
                return;
            }
        };

        let mut reader = BufReader::new(file);
        let mut stream_index = 0;
        let mut max_total_size = String::new();
        let mut last_real_percent = 0.0;
        let mut last_emit_time = Instant::now();
        let mut last_emitted_percent = -1.0;

        loop {
            loop {
                let mut raw = Vec::new();
                match reader.read_until(b'\n', &mut raw) {
                    Ok(0) => break,
                    Ok(_) => {
                        let full = crate::utils::decode_bytes(&raw);
                        for line in full
                            .split('\r')
                            .map(|l| l.trim_end_matches('\n').to_string())
                            .filter(|l| !l.is_empty())
                        {
                            if !line.starts_with("[download]") {
                                debug!("[YTDLP-{}] {}", id_clone_2, line);
                            }

                            // Fix 5: acumular mudanças de estado em variáveis locais
                            // e aplicar em um único lock no final da iteração.
                            let mut new_output_filepath: Option<String> = None;
                            let mut new_thumbnail_filepath: Option<String> = None;
                            let mut should_emit_merger = false;
                            let mut should_emit_progress = false;
                            let mut should_emit_converting = false;

                            if let Some(caps) = dest_re.captures(&line).or(already_re.captures(&line)) {
                                let path = caps[1].trim().to_string();
                                let abs_path = PathBuf::from(&path).to_string_lossy().to_string();
                                last_progress.output_path = abs_path.clone();
                                last_progress.filename = PathBuf::from(&abs_path)
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or("")
                                    .to_string();
                                new_output_filepath = Some(abs_path);
                            }

                            if let Some(caps) = thumb_write_re.captures(&line) {
                                let path = caps[1].trim().to_string();
                                last_progress.thumbnail_path = path.clone();
                                new_thumbnail_filepath = Some(path);
                            }

                            if let Some(caps) = thumb_conv_re.captures(&line) {
                                let path = PathBuf::from(caps[1].trim())
                                    .with_extension(caps[2].trim())
                                    .to_string_lossy()
                                    .to_string();
                                last_progress.thumbnail_path = path.clone();
                                new_thumbnail_filepath = Some(path);
                            }

                            if let Some(caps) = merger_re.captures(&line) {
                                let merged = caps[1].trim().to_string();
                                last_progress.output_path = merged.clone();
                                last_progress.filename = PathBuf::from(&merged)
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or("")
                                    .to_string();
                                last_progress.status = "preparing".to_string();
                                last_progress.percent = 98.0;
                                new_output_filepath = Some(PathBuf::from(&merged).to_string_lossy().to_string());
                                if last_emit_time.elapsed().as_millis() > 500 {
                                    should_emit_merger = true;
                                }
                            }

                            if let Some(caps) = merger_dest_re.captures(&line) {
                                let merged = caps[1].trim().to_string();
                                last_progress.output_path = merged.clone();
                                last_progress.filename = PathBuf::from(&merged)
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or("")
                                    .to_string();
                                last_progress.status = "preparing".to_string();
                                last_progress.percent = 98.0;
                                new_output_filepath = Some(PathBuf::from(&merged).to_string_lossy().to_string());
                                if last_emit_time.elapsed().as_millis() > 500 {
                                    should_emit_merger = true;
                                }
                            }

                            if let Some(caps) = progress_re.captures(&line) {
                                let real: f64 = caps[1].parse().unwrap_or(0.0);
                                if real < last_real_percent - 20.0 && last_real_percent > 50.0 {
                                    stream_index += 1;
                                }
                                last_real_percent = real;

                                let disp = match stream_index {
                                    0 => real * 0.8,
                                    1 => 80.0 + (real * 0.18),
                                    _ => 98.0 + (real * 0.02),
                                };
                                last_progress.percent = disp;

                                let total = caps[2].trim().to_string();
                                if stream_index == 0 || total.len() > max_total_size.len() {
                                    max_total_size = total;
                                }
                                last_progress.speed = caps[3].trim().to_string();
                                last_progress.eta = caps[4].trim().to_string();
                                last_progress.total_size = max_total_size.clone();

                                let now = Instant::now();
                                if (disp - last_emitted_percent).abs() >= 1.0
                                    || now.duration_since(last_emit_time).as_millis() >= 100
                                    || disp >= 99.9
                                {
                                    should_emit_progress = true;
                                    last_emit_time = now;
                                    last_emitted_percent = disp;
                                }
                            }
                            
                            if convert_re.is_match(&line) && last_progress.status != "converting" {
                                info!("Audio conversion detected: {}", line);
                                last_progress.status = "converting".to_string();
                                last_progress.percent = 99.0;
                                should_emit_converting = true;
                                last_emit_time = Instant::now();
                            }

                            // Fix 5: único lock do Mutex por iteração
                            let need_state_update = new_output_filepath.is_some()
                                || new_thumbnail_filepath.is_some()
                                || should_emit_merger
                                || should_emit_progress
                                || should_emit_converting;

                            if need_state_update {
                                // Ler is_paused para atualizar status do progresso
                                let mut s = state_clone.lock().unwrap();
                                if let Some(h) = s.get_mut(&id_clone_2) {
                                    if should_emit_progress {
                                        last_progress.status = if h.is_paused {
                                            "paused".to_string()
                                        } else {
                                            "downloading".to_string()
                                        };
                                    }
                                    if let Some(ref fp) = new_output_filepath {
                                        h.output_filepath = Some(fp.clone());
                                    }
                                    if let Some(ref tp) = new_thumbnail_filepath {
                                        h.thumbnail_filepath = Some(tp.clone());
                                    }
                                    if should_emit_merger || should_emit_progress || should_emit_converting {
                                        h.last_progress = Some(last_progress.clone());
                                    }
                                }
                                drop(s);

                                if should_emit_merger || should_emit_progress || should_emit_converting {
                                    let _ = app_clone.emit("download-progress", last_progress.clone());
                                }
                            }
                        }
                    }
                    Err(_) => break,
                }
            }

            let is_done = {
                let mut s = state_clone.lock().unwrap();
                s.get_mut(&id_clone_2)
                    .and_then(|h| h.process.as_mut())
                    .map(|c| matches!(c.try_wait(), Ok(Some(_))))
                    .unwrap_or(true)
            };
            if is_done {
                break;
            }
            thread::sleep(std::time::Duration::from_millis(100));
        }

        let exit_status = {
            let mut s = state_clone.lock().unwrap();
            s.get_mut(&id_clone_2)
                .and_then(|h| h.process.as_mut()?.wait().ok())
        };

        if let Some(status) = exit_status {
            let code = status.code().unwrap_or(-1);
            let ok = status.success() || code == 120 || last_progress.percent >= 98.0;
            
            // Check if this is an audio download that might need extra time for conversion
            let is_audio_download = {
                let s = state_clone.lock().unwrap();
                s.get(&id_clone_2).map(|h| h.is_audio).unwrap_or(false)
            };
            
            // Add delay for audio files to allow FFmpeg to finish conversion
            if is_audio_download && ok {
                info!("Audio download completed, waiting for FFmpeg conversion...");
                thread::sleep(std::time::Duration::from_secs(4));
                
                // Check if still converting
                {
                    let s = state_clone.lock().unwrap();
                    if let Some(h) = s.get(&id_clone_2) {
                        if let Some(ref progress) = h.last_progress {
                            if progress.status == "converting" {
                                drop(s);
                                thread::sleep(std::time::Duration::from_secs(2));
                            }
                        }
                    }
                }
            }
            
            // Check for specific format errors (TikTok case)
            let has_format_error = if let Ok(err_bytes) = std::fs::read(&stderr_path) {
                let err_content = crate::utils::decode_bytes(&err_bytes);
                err_content.contains("Requested format is not available") 
                    || err_content.contains("format is not available")
            } else { false };

            let final_ok = ok && !has_format_error;
            
            if final_ok {
                // Also wait for video merger to complete
                let is_video_download = {
                    let s = state_clone.lock().unwrap();
                    s.get(&id_clone_2).map(|h| !h.is_audio).unwrap_or(false)
                };
                
                if is_video_download {
                    let was_merging = last_progress.status == "preparing" || last_progress.status == "converting";
                    if was_merging {
                        thread::sleep(std::time::Duration::from_secs(2));
                    }
                }
                
                last_progress.status = "completed".to_string();
                last_progress.percent = 100.0;
            } else {
                last_progress.status = "error".to_string();
                if let Ok(err_bytes) = std::fs::read(&stderr_path) {
                    let err_content = crate::utils::decode_bytes(&err_bytes);
                    let last_line = err_content
                        .lines()
                        .last()
                        .unwrap_or("Erro desconhecido no yt-dlp")
                        .to_string();
                    last_progress.error_message = Some(last_line);
                }
            }

            {
                let mut s = state_clone.lock().unwrap();
                if let Some(h) = s.get_mut(&id_clone_2) {
                    h.last_progress = Some(last_progress.clone());
                }
            }

            if last_progress.output_path.is_empty() {
                let s = state_clone.lock().unwrap();
                if let Some(h) = s.get(&id_clone_2) {
                    if let Some(ref path) = h.output_filepath {
                        last_progress.output_path = path.clone();
                        last_progress.filename = PathBuf::from(path)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string();
                    }
                }
            }

            // ALWAYS correct the output_path extension to match the requested format
            // This is necessary because yt-dlp may create temporary files (e.g., .webm for audio)
            // and the final converted file may have a different extension
            if !last_progress.output_path.is_empty() {
                if let Some(ref ext) = last_progress.extension {
                    let output_dir = PathBuf::from(&last_progress.output_path)
                        .parent()
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_default();
                    
                    if !output_dir.is_empty() {
                        let path_buf = PathBuf::from(&last_progress.output_path);
                        let filename_stem = path_buf
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("");
                        let filename_stem_owned = filename_stem.to_string();
                        
                        let ext_lower = ext.to_lowercase();
                        let correct_path = format!("{}/{}.{}", output_dir, filename_stem_owned, ext_lower);
                        
                        last_progress.output_path = correct_path.clone();
                        last_progress.filename = format!("{}.{}", filename_stem_owned, ext_lower);
                    }
                }
            }

// Verificar SE o yt-dlp completou ANTES de usar o valor
            let is_completed = last_progress.status == "completed";
            
            let _ = app_clone.emit("download-progress", last_progress);
            
            // LOG: Se o yt-dlp completou, aceitar como sucesso
if is_completed {
                info!("[DEBUG] Accepted - yt-dlp completed successfully");
            }
        }

        {
            let mut s = state_clone.lock().unwrap();
            s.remove(&id_clone_2);
        }
        let _ = std::fs::remove_file(stdout_path);
        let _ = std::fs::remove_file(stderr_path);
    });
}
