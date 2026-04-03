use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Child;
use std::sync::{Arc, Mutex};

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
pub struct DownloadProgress {
    pub id: String,
    pub percent: f64,
    pub speed: String,
    pub eta: String,
    pub status: String,
    pub filename: String,
    pub output_path: String,
    pub total_size: String,
    pub thumbnail_path: String,
    pub error_message: Option<String>,
    pub url: String,
    pub quality: String,
    pub format: String,
    pub extension: Option<String>,
}

pub struct DownloadHandle {
    pub process: Option<Child>,
    pub is_paused: bool,
    pub output_filepath: Option<String>,
    pub thumbnail_filepath: Option<String>,
    pub last_progress: Option<DownloadProgress>,
    pub output_dir: String,
    pub requested_title: String,
    pub is_audio: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HistoryEntry {
    pub id: String,
    pub title: String,
    pub filename: String,
    pub filepath: String,
    pub url: String,
    #[serde(rename = "type")]
    pub file_type: String,
    pub ext: String,
    #[serde(rename = "completedAt")]
    pub completed_at: u64,
    #[serde(rename = "sizeLabel")]
    pub size_label: String,
    #[serde(rename = "thumbnailDataUrl")]
    pub thumbnail_data_url: Option<String>,
    pub format: String,
    pub quality: String,
    pub status: String,
}

pub type SharedDownloadState = Arc<Mutex<HashMap<String, DownloadHandle>>>;
