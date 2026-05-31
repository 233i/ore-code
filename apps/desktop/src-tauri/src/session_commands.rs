use super::*;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionSummary {
    pub(crate) thread_id: String,
    pub(crate) title: String,
    pub(crate) event_count: usize,
    pub(crate) updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) workspace_path: Option<String>,
}

#[tauri::command]
pub(crate) fn session_save_events(
    app: tauri::AppHandle,
    thread_id: String,
    events: Vec<serde_json::Value>,
    workspace_path: Option<String>,
    transcript: Option<serde_json::Value>,
) -> Result<SessionSummary, String> {
    let file = session_file_path(&sessions_dir(&app)?, &thread_id)?;
    write_session_file(&file, &events)?;
    if let Some(transcript) = transcript {
        write_session_transcript_bundle(&session_transcripts_dir(&app)?, &thread_id, &transcript)?;
    }
    let titles = read_session_titles(&app)?;
    let mut workspaces = read_session_workspaces(&app)?;
    if let Some(path) = normalize_optional_workspace_path(workspace_path) {
        workspaces.insert(thread_id.clone(), path);
        write_session_workspaces(&app, &workspaces)?;
    }
    let summary = summarize_session_values_with_titles(&thread_id, &events, &titles, &workspaces);
    upsert_session_index(&app, summary.clone())?;
    Ok(summary)
}

#[tauri::command]
pub(crate) fn session_list_threads(app: tauri::AppHandle) -> Result<Vec<SessionSummary>, String> {
    read_session_index(&app)
}

#[tauri::command]
pub(crate) fn session_load_thread(
    app: tauri::AppHandle,
    thread_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let file = session_file_path(&sessions_dir(&app)?, &thread_id)?;
    read_session_file(&file)
}

#[tauri::command]
pub(crate) fn session_load_transcript_tail(
    app: tauri::AppHandle,
    thread_id: String,
) -> Result<Option<serde_json::Value>, String> {
    read_session_transcript_bundle(&session_transcripts_dir(&app)?, &thread_id)
}

#[tauri::command]
pub(crate) fn session_load_transcript_chunk(
    app: tauri::AppHandle,
    thread_id: String,
    chunk_index: u64,
) -> Result<Option<serde_json::Value>, String> {
    read_session_transcript_chunk(&session_transcripts_dir(&app)?, &thread_id, chunk_index)
}

#[tauri::command]
pub(crate) fn session_rename_thread(
    app: tauri::AppHandle,
    thread_id: String,
    title: String,
) -> Result<SessionSummary, String> {
    let dir = sessions_dir(&app)?;
    let file = session_file_path(&dir, &thread_id)?;
    if !file.exists() {
        return Err("session not found".to_string());
    }

    let normalized = normalize_session_title(&title)?;
    let mut titles = read_session_titles(&app)?;
    titles.insert(thread_id.clone(), normalized);
    write_session_titles(&app, &titles)?;
    let workspaces = read_session_workspaces(&app)?;
    let events = read_session_file(&file)?;
    let summary = summarize_session_values_with_titles(&thread_id, &events, &titles, &workspaces);
    upsert_session_index(&app, summary.clone())?;
    Ok(summary)
}

#[tauri::command]
pub(crate) fn session_delete_thread(
    app: tauri::AppHandle,
    thread_id: String,
) -> Result<(), String> {
    let dir = sessions_dir(&app)?;
    let file = session_file_path(&dir, &thread_id)?;
    if file.exists() {
        fs::remove_file(&file).map_err(|error| error.to_string())?;
    }

    let mut titles = read_session_titles(&app)?;
    if titles.remove(&thread_id).is_some() {
        write_session_titles(&app, &titles)?;
    }
    let mut workspaces = read_session_workspaces(&app)?;
    if workspaces.remove(&thread_id).is_some() {
        write_session_workspaces(&app, &workspaces)?;
    }
    let transcript_dir =
        session_transcript_thread_dir(&session_transcripts_dir(&app)?, &thread_id)?;
    if transcript_dir.exists() {
        fs::remove_dir_all(transcript_dir).map_err(|error| error.to_string())?;
    }
    remove_session_from_index(&app, &thread_id)?;

    Ok(())
}

pub(crate) fn sessions_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("sessions"))
}

pub(crate) fn session_titles_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("session-titles.json"))
}

pub(crate) fn session_workspaces_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("session-workspaces.json"))
}

pub(crate) fn session_index_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("session-index.json"))
}

pub(crate) fn session_transcripts_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("session-transcripts"))
}

pub(crate) fn read_session_index(app: &tauri::AppHandle) -> Result<Vec<SessionSummary>, String> {
    read_session_index_file(&session_index_file(app)?)
}

pub(crate) fn write_session_index(
    app: &tauri::AppHandle,
    summaries: &[SessionSummary],
) -> Result<(), String> {
    write_session_index_file(&session_index_file(app)?, summaries)
}

pub(crate) fn upsert_session_index(
    app: &tauri::AppHandle,
    summary: SessionSummary,
) -> Result<(), String> {
    let mut summaries = read_session_index(app)?;
    summaries.retain(|item| item.thread_id != summary.thread_id);
    summaries.push(summary);
    write_session_index(app, &sorted_session_index(summaries))
}

pub(crate) fn remove_session_from_index(
    app: &tauri::AppHandle,
    thread_id: &str,
) -> Result<(), String> {
    let mut summaries = read_session_index(app)?;
    let before = summaries.len();
    summaries.retain(|item| item.thread_id != thread_id);
    if summaries.len() != before {
        write_session_index(app, &summaries)?;
    }
    Ok(())
}

pub(crate) fn read_session_index_file(path: &Path) -> Result<Vec<SessionSummary>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let summaries: Vec<SessionSummary> =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;
    Ok(sorted_session_index(
        summaries
            .into_iter()
            .filter(|summary| is_valid_thread_id(&summary.thread_id))
            .collect(),
    ))
}

pub(crate) fn write_session_index_file(
    path: &Path,
    summaries: &[SessionSummary],
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let content = serde_json::to_string_pretty(&sorted_session_index(summaries.to_vec()))
        .map_err(|error| error.to_string())?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temp_path, path).map_err(|error| error.to_string())
}

pub(crate) fn sorted_session_index(mut summaries: Vec<SessionSummary>) -> Vec<SessionSummary> {
    summaries.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.thread_id.cmp(&b.thread_id))
    });
    summaries
}

pub(crate) fn read_session_titles(
    app: &tauri::AppHandle,
) -> Result<HashMap<String, String>, String> {
    let path = session_titles_file(app)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

pub(crate) fn write_session_titles(
    app: &tauri::AppHandle,
    titles: &HashMap<String, String>,
) -> Result<(), String> {
    let path = session_titles_file(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let content = serde_json::to_string_pretty(titles).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

pub(crate) fn read_session_workspaces(
    app: &tauri::AppHandle,
) -> Result<HashMap<String, String>, String> {
    let path = session_workspaces_file(app)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

pub(crate) fn write_session_workspaces(
    app: &tauri::AppHandle,
    workspaces: &HashMap<String, String>,
) -> Result<(), String> {
    let path = session_workspaces_file(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let content = serde_json::to_string_pretty(workspaces).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

pub(crate) fn normalize_optional_workspace_path(workspace_path: Option<String>) -> Option<String> {
    let path = workspace_path?.trim().to_string();
    if path.is_empty() { None } else { Some(path) }
}

pub(crate) fn session_file_path(dir: &Path, thread_id: &str) -> Result<PathBuf, String> {
    if !is_valid_thread_id(thread_id) {
        return Err("invalid session thread id".to_string());
    }

    Ok(dir.join(format!("{thread_id}.jsonl")))
}

pub(crate) fn session_transcript_thread_dir(
    dir: &Path,
    thread_id: &str,
) -> Result<PathBuf, String> {
    if !is_valid_thread_id(thread_id) {
        return Err("invalid session thread id".to_string());
    }

    Ok(dir.join(thread_id))
}

pub(crate) fn write_session_transcript_bundle(
    dir: &Path,
    thread_id: &str,
    transcript: &serde_json::Value,
) -> Result<(), String> {
    let thread_dir = session_transcript_thread_dir(dir, thread_id)?;
    if thread_dir.exists() {
        fs::remove_dir_all(&thread_dir).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&thread_dir).map_err(|error| error.to_string())?;

    let chunks = transcript
        .get("chunks")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "transcript chunks must be an array".to_string())?;

    let mut index = transcript.clone();
    if let Some(object) = index.as_object_mut() {
        object.insert(
            "chunks".to_string(),
            serde_json::Value::Array(
                chunks
                    .iter()
                    .filter_map(|chunk| {
                        Some(serde_json::json!({
                            "id": chunk.get("id")?.as_str()?,
                            "index": chunk.get("index").and_then(|value| value.as_u64()).unwrap_or(0),
                            "itemCount": chunk.get("itemCount").and_then(|value| value.as_u64()).unwrap_or(0)
                        }))
                    })
                    .collect(),
            ),
        );
    }

    write_json_atomic(&thread_dir.join("index.json"), &index)?;
    for chunk in chunks {
        let id = chunk
            .get("id")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "transcript chunk is missing id".to_string())?;
        if !is_valid_chunk_id(id) {
            return Err("invalid transcript chunk id".to_string());
        }
        write_json_atomic(&thread_dir.join(format!("{id}.json")), chunk)?;
    }

    Ok(())
}

pub(crate) fn read_session_transcript_bundle(
    dir: &Path,
    thread_id: &str,
) -> Result<Option<serde_json::Value>, String> {
    let thread_dir = session_transcript_thread_dir(dir, thread_id)?;
    let index_file = thread_dir.join("index.json");
    if !index_file.exists() {
        return Ok(None);
    }

    let mut index: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&index_file).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let Some(chunk_id) = index
        .get("chunks")
        .and_then(|value| value.as_array())
        .and_then(|chunks| chunks.last())
        .and_then(|chunk| chunk.get("id"))
        .and_then(|value| value.as_str())
    else {
        return Ok(Some(index));
    };
    if !is_valid_chunk_id(chunk_id) {
        return Err("invalid transcript chunk id".to_string());
    }

    let chunk: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(thread_dir.join(format!("{chunk_id}.json")))
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if let Some(object) = index.as_object_mut() {
        object.insert("chunks".to_string(), serde_json::Value::Array(vec![chunk]));
    }
    Ok(Some(index))
}

pub(crate) fn read_session_transcript_chunk(
    dir: &Path,
    thread_id: &str,
    chunk_index: u64,
) -> Result<Option<serde_json::Value>, String> {
    let thread_dir = session_transcript_thread_dir(dir, thread_id)?;
    let index_file = thread_dir.join("index.json");
    if !index_file.exists() {
        return Ok(None);
    }

    let mut index: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&index_file).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let Some(chunk_id) = index
        .get("chunks")
        .and_then(|value| value.as_array())
        .and_then(|chunks| {
            chunks.iter().find(|chunk| {
                chunk
                    .get("index")
                    .and_then(|value| value.as_u64())
                    .is_some_and(|index| index == chunk_index)
            })
        })
        .and_then(|chunk| chunk.get("id"))
        .and_then(|value| value.as_str())
    else {
        return Ok(None);
    };
    if !is_valid_chunk_id(chunk_id) {
        return Err("invalid transcript chunk id".to_string());
    }

    let chunk: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(thread_dir.join(format!("{chunk_id}.json")))
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if let Some(object) = index.as_object_mut() {
        object.insert("chunks".to_string(), serde_json::Value::Array(vec![chunk]));
    }
    Ok(Some(index))
}

fn is_valid_chunk_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn write_json_atomic(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temp_path, path).map_err(|error| error.to_string())
}

pub(crate) fn is_valid_thread_id(thread_id: &str) -> bool {
    !thread_id.is_empty()
        && thread_id != "."
        && thread_id != ".."
        && thread_id
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_' | b'.'))
}

pub(crate) fn write_session_file(path: &Path, events: &[serde_json::Value]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "session file has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let mut content = String::new();
    for event in events {
        content.push_str(&serde_json::to_string(event).map_err(|error| error.to_string())?);
        content.push('\n');
    }

    let temp_path = path.with_extension("jsonl.tmp");
    fs::write(&temp_path, content).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temp_path, path).map_err(|error| error.to_string())
}

pub(crate) fn read_session_file(path: &Path) -> Result<Vec<serde_json::Value>, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut events = Vec::new();
    for (index, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }

        events.push(
            serde_json::from_str(line)
                .map_err(|error| format!("invalid JSONL at line {}: {error}", index + 1))?,
        );
    }

    Ok(events)
}

#[cfg(test)]
pub(crate) fn summarize_session_values(
    thread_id: &str,
    events: &[serde_json::Value],
) -> SessionSummary {
    summarize_session_values_with_titles(thread_id, events, &HashMap::new(), &HashMap::new())
}

pub(crate) fn summarize_session_values_with_titles(
    thread_id: &str,
    events: &[serde_json::Value],
    titles: &HashMap<String, String>,
    workspaces: &HashMap<String, String>,
) -> SessionSummary {
    SessionSummary {
        thread_id: thread_id.to_string(),
        title: titles
            .get(thread_id)
            .cloned()
            .unwrap_or_else(|| session_title(events)),
        event_count: events.len(),
        updated_at: events
            .last()
            .and_then(|event| event.get("createdAt"))
            .and_then(|value| value.as_str())
            .unwrap_or("1970-01-01T00:00:00.000Z")
            .to_string(),
        workspace_path: workspaces.get(thread_id).cloned(),
    }
}

pub(crate) fn normalize_session_title(value: &str) -> Result<String, String> {
    let title = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return Err("session title cannot be empty".to_string());
    }

    Ok(truncate_title(&title))
}

pub(crate) fn session_title(events: &[serde_json::Value]) -> String {
    let title = events
        .iter()
        .find(|event| event.get("type").and_then(|value| value.as_str()) == Some("user_message"))
        .and_then(|event| event.get("text"))
        .and_then(|value| value.as_str())
        .map(|value| value.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Untitled session".to_string());

    truncate_title(&title)
}

pub(crate) fn truncate_title(value: &str) -> String {
    let char_count = value.chars().count();
    if char_count <= SESSION_TITLE_LIMIT {
        return value.to_string();
    }

    format!(
        "{}...",
        value
            .chars()
            .take(SESSION_TITLE_LIMIT.saturating_sub(3))
            .collect::<String>()
    )
}
