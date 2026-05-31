use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceStatus {
    pub(crate) cwd: String,
    pub(crate) app_data_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceValidation {
    pub(crate) path: String,
}

#[tauri::command]
pub(crate) fn workspace_status(app: tauri::AppHandle) -> Result<WorkspaceStatus, String> {
    let cwd = std::env::current_dir()
        .map_err(|error| error.to_string())?
        .display()
        .to_string();
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .display()
        .to_string();

    Ok(WorkspaceStatus { cwd, app_data_dir })
}

#[tauri::command]
pub(crate) fn user_home_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .home_dir()
        .map_err(|error| error.to_string())
        .map(|path| path.display().to_string())
}

#[tauri::command]
pub(crate) fn workspace_validate(path: String) -> Result<WorkspaceValidation, String> {
    let resolved = canonicalize_workspace(&path)?;
    if !resolved.is_dir() {
        return Err("workspace path must be a directory".to_string());
    }

    Ok(WorkspaceValidation {
        path: resolved.display().to_string(),
    })
}

pub(crate) fn resolve_existing_workspace_path(
    workspace_path: &str,
    requested: &str,
) -> Result<PathBuf, String> {
    let workspace = canonicalize_workspace(workspace_path)?;
    let candidate = workspace_candidate(&workspace, requested);
    let resolved = candidate
        .canonicalize()
        .map_err(|error| error.to_string())?;

    ensure_inside_workspace(&workspace, &resolved)?;
    Ok(resolved)
}

pub(crate) fn resolve_workspace_write_path(
    workspace_path: &str,
    requested: &str,
) -> Result<PathBuf, String> {
    let workspace = canonicalize_workspace(workspace_path)?;
    let candidate = workspace_candidate(&workspace, requested);
    let parent = candidate
        .parent()
        .ok_or_else(|| "target path has no parent directory".to_string())?
        .canonicalize()
        .map_err(|error| error.to_string())?;

    ensure_inside_workspace(&workspace, &parent)?;
    Ok(parent.join(
        candidate
            .file_name()
            .ok_or_else(|| "target path must include a file name".to_string())?,
    ))
}

pub(crate) fn canonicalize_workspace(workspace_path: &str) -> Result<PathBuf, String> {
    Path::new(workspace_path)
        .canonicalize()
        .map_err(|error| format!("invalid workspace path: {error}"))
}

pub(crate) fn workspace_candidate(workspace: &Path, requested: &str) -> PathBuf {
    let requested_path = Path::new(requested);
    if requested_path.is_absolute() {
        requested_path.to_path_buf()
    } else {
        workspace.join(requested_path)
    }
}

pub(crate) fn ensure_inside_workspace(workspace: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(workspace) {
        Ok(())
    } else {
        Err("path is outside the selected workspace".to_string())
    }
}
