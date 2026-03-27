#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{AppHandle, Emitter, command};
use tauri_plugin_dialog::DialogExt;
use tokio::io::{AsyncBufReadExt, BufReader};
use std::process::Stdio;

fn get_default_download_path() -> String {
    dirs::download_dir()
        .or_else(|| dirs::video_dir())
        .or_else(|| dirs::home_dir())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string())
}

#[command]
async fn download_video(app: AppHandle, url: String, quality: String, download_path: String) -> Result<String, String> {
    if url.is_empty() {
        return Err("URL não fornecida".to_string());
    }

    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL inválida".to_string());
    }

    println!("Iniciando download: {}", url);
    
    let height = quality.replace("p", "").parse::<i32>().unwrap_or(1080);
    
    let final_path = if download_path.is_empty() || download_path == "default_path" {
        get_default_download_path()
    } else {
        download_path
    };
    
    println!("Caminho final: {}", final_path);

    let mut args = vec![
        "--newline".to_string(),
        "--format".to_string(),
        format!("bestvideo[height<=?{}]+bestaudio/best", height),
        "--audio-format".to_string(),
        "m4a".to_string(),
        "--merge-output-format".to_string(),
        "mp4".to_string(),
        "--output".to_string(),
        format!("{}/%(title)s [%(id)s].%(ext)s", final_path),
    ];
    
    args.push(url.clone());

    let current_dir = std::env::current_dir().unwrap_or_default();
    let ytdlp_path = if current_dir.ends_with("src-tauri") {
        current_dir.join("yt-dlp.exe")
    } else {
        current_dir.join("src-tauri").join("yt-dlp.exe")
    };

    if !ytdlp_path.exists() {
        return Err(format!("yt-dlp.exe não encontrado no caminho: {}", ytdlp_path.display()));
    }

    let mut child = tokio::process::Command::new(&ytdlp_path)
        .arg("--js-runtimes")
        .arg("node")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Falha ao iniciar o yt-dlp: {}", e))?;

    let stdout = child.stdout.take().expect("Falha ao capturar stdout");
    let stderr = child.stderr.take().expect("Falha ao capturar stderr");
    let mut reader = BufReader::new(stdout).lines();
    let mut err_reader = BufReader::new(stderr).lines();

    loop {
        tokio::select! {
            line = reader.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        if line.contains("[download]") && line.contains("%") {
                            let _ = app.emit("download-progress", line);
                        }
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
            err_line = err_reader.next_line() => {
                if let Ok(Some(line)) = err_line {
                    println!("STDERR: {}", line);
                }
            }
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;

    if status.success() {
        Ok("Download concluído com sucesso!".to_string())
    } else {
        Err(format!("Erro no processo: {}", status))
    }
}

#[command]
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![download_video, select_download_folder])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar a aplicação");
}
