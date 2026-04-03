use std::path::PathBuf;
use crate::utils::ascii_alphanum;

pub fn check_files_exist(paths: Vec<String>) -> Vec<bool> {
    paths.into_iter()
        .map(|p| PathBuf::from(&p).exists())
        .collect()
}

pub fn open_folder_natively(path: String) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(&path).spawn();
    }
}

pub fn find_file_by_title(dir: String, title: String, extension: Option<String>) -> bool {
    let title_norm = ascii_alphanum(&title);
    if title_norm.len() < 8 {
        return false;
    }
    let threshold = (title_norm.len() * 4 / 5).max(10);

    let ext_requested = extension
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

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
            if !ext_requested.is_empty() && ext != ext_requested {
                continue;
            }
            return true;
        }
    }
    false
}

pub fn resolve_paths(paths: Vec<String>) -> Vec<Option<String>> {
    use crate::utils::ascii_alphanum;
    
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

                            let ext_match = target_ext == entry_ext;
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
                            
                            let entry_ext = entry_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                            let target_ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                            
                            let ext_compatible = target_ext == entry_ext;
                            
                            if !ext_compatible {
                                continue;
                            }

                            let normalized_search = search_key.to_lowercase();
                            let normalized_entry = entry_name.to_lowercase();

                            if normalized_entry.contains(&normalized_search)
                                || normalized_search.contains(&normalized_entry.split('.').next().unwrap_or(&normalized_entry))
                            {
                                return Some(entry_path.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
            None
        })
        .collect()
}