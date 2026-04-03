use once_cell::sync::Lazy;
use regex::Regex;

pub fn decode_bytes(raw: &[u8]) -> String {
    match std::str::from_utf8(raw) {
        Ok(s) => s.to_string(),
        Err(_) => {
            let (decoded, _, _) = encoding_rs::WINDOWS_1252.decode(raw);
            decoded.into_owned()
        }
    }
}

pub static NORMALIZE_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[^\w\s]").unwrap()
});

pub fn get_default_download_path() -> String {
    dirs::download_dir()
        .or_else(|| dirs::video_dir())
        .or_else(|| dirs::home_dir())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string())
}

pub fn normalize_title(s: &str) -> String {
    NORMALIZE_REGEX
        .replace_all(s, " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn ascii_alphanum(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

pub fn base64_encode(data: &[u8]) -> String {
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

pub fn find_available_browser() -> Option<String> {
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();

    if !appdata.is_empty() {
        let path = format!("{}\\Mozilla\\Firefox\\Profiles", appdata);
        if std::path::Path::new(&path).exists() {
            return Some("firefox".to_string());
        }
    }
    if !localappdata.is_empty() {
        let path = format!("{}\\Microsoft\\Edge\\User Data", localappdata);
        if std::path::Path::new(&path).exists() {
            return Some("edge".to_string());
        }
    }
    None
}
