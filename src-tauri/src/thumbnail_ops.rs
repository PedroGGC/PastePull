use std::path::PathBuf;
use crate::utils::ascii_alphanum;

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