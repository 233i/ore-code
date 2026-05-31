use super::*;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArtifactMetadata {
    pub(crate) id: String,
    #[serde(rename = "type")]
    pub(crate) artifact_type: String,
    pub(crate) size: u64,
    pub(crate) created_at: String,
    pub(crate) summary: String,
    pub(crate) source_call_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArtifactRecord {
    pub(crate) id: String,
    #[serde(rename = "type")]
    pub(crate) artifact_type: String,
    pub(crate) size: u64,
    pub(crate) created_at: String,
    pub(crate) summary: String,
    pub(crate) source_call_id: Option<String>,
    pub(crate) content: String,
}

#[tauri::command]
pub(crate) fn artifact_write(
    app: tauri::AppHandle,
    artifact_type: String,
    content: String,
    summary: String,
    source_call_id: Option<String>,
) -> Result<ArtifactMetadata, String> {
    let dir = artifacts_dir(&app)?;
    write_artifact(&dir, &artifact_type, &content, &summary, source_call_id)
}

#[tauri::command]
pub(crate) fn artifact_list(app: tauri::AppHandle) -> Result<Vec<ArtifactMetadata>, String> {
    let dir = artifacts_dir(&app)?;
    list_artifacts(&dir)
}

#[tauri::command]
pub(crate) fn artifact_read(
    app: tauri::AppHandle,
    artifact_id: String,
) -> Result<ArtifactRecord, String> {
    let dir = artifacts_dir(&app)?;
    read_artifact(&dir, &artifact_id)
}

pub(crate) fn artifacts_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("artifacts"))
}

pub(crate) fn write_artifact(
    dir: &Path,
    artifact_type: &str,
    content: &str,
    summary: &str,
    source_call_id: Option<String>,
) -> Result<ArtifactMetadata, String> {
    let artifact_type = normalize_artifact_type(artifact_type)?;
    let summary = summary.trim();
    if summary.is_empty() {
        return Err("artifact summary must not be empty".to_string());
    }

    fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let id = next_artifact_id();
    let metadata = ArtifactMetadata {
        id: id.clone(),
        artifact_type,
        size: content.as_bytes().len() as u64,
        created_at: timestamp_now(),
        summary: summary.to_string(),
        source_call_id,
    };

    fs::write(artifact_content_path(dir, &id)?, content).map_err(|error| error.to_string())?;
    write_artifact_metadata(&artifact_metadata_path(dir, &id)?, &metadata)?;
    Ok(metadata)
}

pub(crate) fn list_artifacts(dir: &Path) -> Result<Vec<ArtifactMetadata>, String> {
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut artifacts = Vec::new();
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }

        let metadata = read_artifact_metadata(&path)?;
        if is_valid_artifact_id(&metadata.id) {
            artifacts.push(metadata);
        }
    }

    artifacts.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(artifacts)
}

pub(crate) fn read_artifact(dir: &Path, artifact_id: &str) -> Result<ArtifactRecord, String> {
    if !is_valid_artifact_id(artifact_id) {
        return Err("invalid artifact id".to_string());
    }

    let metadata = read_artifact_metadata(&artifact_metadata_path(dir, artifact_id)?)?;
    let content = fs::read_to_string(artifact_content_path(dir, artifact_id)?)
        .map_err(|error| error.to_string())?;

    Ok(ArtifactRecord {
        id: metadata.id,
        artifact_type: metadata.artifact_type,
        size: metadata.size,
        created_at: metadata.created_at,
        summary: metadata.summary,
        source_call_id: metadata.source_call_id,
        content,
    })
}

pub(crate) fn write_artifact_metadata(
    path: &Path,
    metadata: &ArtifactMetadata,
) -> Result<(), String> {
    let content = serde_json::to_string(metadata).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

pub(crate) fn read_artifact_metadata(path: &Path) -> Result<ArtifactMetadata, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

pub(crate) fn artifact_metadata_path(dir: &Path, artifact_id: &str) -> Result<PathBuf, String> {
    if !is_valid_artifact_id(artifact_id) {
        return Err("invalid artifact id".to_string());
    }

    Ok(dir.join(format!("{artifact_id}.json")))
}

pub(crate) fn artifact_content_path(dir: &Path, artifact_id: &str) -> Result<PathBuf, String> {
    if !is_valid_artifact_id(artifact_id) {
        return Err("invalid artifact id".to_string());
    }

    Ok(dir.join(format!("{artifact_id}.txt")))
}

pub(crate) fn normalize_artifact_type(value: &str) -> Result<String, String> {
    let value = value.trim();
    if matches!(value, "shell-log" | "text" | "diff" | "test-report") {
        Ok(value.to_string())
    } else {
        Err(format!("unsupported artifact type: {value}"))
    }
}

pub(crate) fn is_valid_artifact_id(value: &str) -> bool {
    value.starts_with("artifact-")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub(crate) fn next_artifact_id() -> String {
    static ARTIFACT_COUNTER: AtomicU64 = AtomicU64::new(0);
    let count = ARTIFACT_COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("artifact-{millis}-{count}")
}
