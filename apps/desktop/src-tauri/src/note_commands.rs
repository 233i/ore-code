use super::*;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteRecord {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) text: String,
    pub(crate) scope: String,
    pub(crate) tags: Vec<String>,
    pub(crate) workspace_path: String,
    pub(crate) created_at: String,
}

#[tauri::command]
pub(crate) fn note_list(
    app: tauri::AppHandle,
    workspace_path: String,
) -> Result<Vec<NoteRecord>, String> {
    let notes = read_notes(&app)?;
    Ok(notes
        .into_iter()
        .filter(|note| note.workspace_path == "*" || note.workspace_path == workspace_path)
        .collect())
}

#[tauri::command]
pub(crate) fn note_add(app: tauri::AppHandle, note: NoteRecord) -> Result<(), String> {
    validate_note(&note)?;
    let mut notes = read_notes(&app)?;
    notes.retain(|existing| existing.id != note.id);
    notes.push(note);
    write_notes(&app, &notes)
}

#[tauri::command]
pub(crate) fn note_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut notes = read_notes(&app)?;
    let before = notes.len();
    notes.retain(|note| note.id != id);
    if notes.len() == before {
        return Err("note not found".to_string());
    }
    write_notes(&app, &notes)
}

fn validate_note(note: &NoteRecord) -> Result<(), String> {
    if note.id.trim().is_empty() || note.text.trim().len() < 8 {
        return Err("invalid note".to_string());
    }
    match note.kind.as_str() {
        "preference" | "decision" | "blocker" | "architecture" => Ok(()),
        _ => Err("invalid note kind".to_string()),
    }
}

fn notes_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("memory");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("notes.json"))
}

fn read_notes(app: &tauri::AppHandle) -> Result<Vec<NoteRecord>, String> {
    let path = notes_file(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn write_notes(app: &tauri::AppHandle, notes: &[NoteRecord]) -> Result<(), String> {
    let path = notes_file(app)?;
    let content = serde_json::to_string_pretty(notes).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}
