use super::side_git::{
    copy_workspace_tree, create_side_git_snapshot, restore_side_git_commit,
    should_skip_side_snapshot_name,
};
use super::*;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SideSnapshotRecord {
    pub(crate) id: String,
    pub(crate) thread_id: String,
    pub(crate) turn_id: String,
    pub(crate) workspace_path: String,
    pub(crate) label: String,
    pub(crate) created_at: String,
    pub(crate) file_count: usize,
    pub(crate) side_git_commit: Option<String>,
    pub(crate) side_git_branch: Option<String>,
    pub(crate) side_git_repo_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SideSnapshotRestoreResult {
    pub(crate) ok: bool,
    pub(crate) restored_files: Vec<String>,
    pub(crate) failures: Vec<String>,
    pub(crate) side_snapshot_id: String,
    pub(crate) side_git_commit: Option<String>,
}

#[tauri::command]
pub(crate) fn snapshot_save(
    app: tauri::AppHandle,
    snapshot: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let snapshot_id = snapshot
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "snapshot id is required".to_string())?;
    let file = snapshot_file_path(&snapshots_dir(&app)?, snapshot_id)?;
    write_snapshot_file(&file, &snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn snapshot_load(
    app: tauri::AppHandle,
    snapshot_id: String,
) -> Result<serde_json::Value, String> {
    let file = snapshot_file_path(&snapshots_dir(&app)?, &snapshot_id)?;
    read_snapshot_file(&file)
}

#[tauri::command]
pub(crate) fn side_snapshot_create(
    app: tauri::AppHandle,
    snapshot_id: String,
    thread_id: String,
    turn_id: String,
    workspace_path: String,
    label: String,
) -> Result<SideSnapshotRecord, String> {
    let workspace = canonicalize_workspace(&workspace_path)?;
    let snapshot_dir = side_snapshot_dir(&app, &snapshot_id)?;
    if snapshot_dir.exists() {
        fs::remove_dir_all(&snapshot_dir).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&snapshot_dir).map_err(|error| error.to_string())?;

    let tree_dir = snapshot_dir.join("tree");
    fs::create_dir_all(&tree_dir).map_err(|error| error.to_string())?;
    let file_count = copy_workspace_tree(&workspace, &tree_dir)?;
    let side_git =
        create_side_git_snapshot(&app, &workspace, &snapshot_id, &thread_id, &turn_id, &label).ok();
    let record = SideSnapshotRecord {
        id: snapshot_id.clone(),
        thread_id,
        turn_id,
        workspace_path: workspace.display().to_string(),
        label,
        created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        file_count,
        side_git_commit: side_git.as_ref().map(|snapshot| snapshot.commit.clone()),
        side_git_branch: side_git.as_ref().map(|snapshot| snapshot.branch.clone()),
        side_git_repo_path: side_git.as_ref().map(|snapshot| snapshot.repo_path.clone()),
    };
    write_side_snapshot_record(&snapshot_dir, &record)?;
    Ok(record)
}

#[tauri::command]
pub(crate) fn side_snapshot_restore(
    app: tauri::AppHandle,
    snapshot_id: String,
    workspace_path: String,
) -> Result<SideSnapshotRestoreResult, String> {
    let workspace = canonicalize_workspace(&workspace_path)?;
    let snapshot_dir = side_snapshot_dir(&app, &snapshot_id)?;
    let record = read_side_snapshot_record(&snapshot_dir)?;
    let recorded_workspace = Path::new(&record.workspace_path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if recorded_workspace != workspace {
        return Err("side snapshot belongs to a different workspace".to_string());
    }

    let mut restored_files = Vec::new();
    let mut failures = Vec::new();
    if let (Some(commit), Some(repo_path)) = (&record.side_git_commit, &record.side_git_repo_path) {
        match restore_side_git_commit(Path::new(repo_path), commit, &workspace) {
            Ok(files) => {
                return Ok(SideSnapshotRestoreResult {
                    ok: true,
                    restored_files: files,
                    failures,
                    side_snapshot_id: snapshot_id,
                    side_git_commit: Some(commit.clone()),
                });
            }
            Err(error) => failures.push(format!(
                "side-git restore failed, falling back to tree snapshot: {error}"
            )),
        }
    }

    let tree_dir = snapshot_dir.join("tree");
    if !tree_dir.is_dir() {
        return Err("side snapshot tree is missing".to_string());
    }

    restore_workspace_from_tree(&workspace, &tree_dir, &mut restored_files, &mut failures);

    Ok(SideSnapshotRestoreResult {
        ok: failures.is_empty(),
        restored_files,
        failures,
        side_snapshot_id: snapshot_id,
        side_git_commit: record.side_git_commit,
    })
}

pub(crate) fn snapshots_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("snapshots"))
}

pub(crate) fn side_snapshots_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("side-snapshots"))
}

pub(crate) fn snapshot_file_path(dir: &Path, snapshot_id: &str) -> Result<PathBuf, String> {
    if !is_valid_snapshot_id(snapshot_id) {
        return Err("invalid snapshot id".to_string());
    }

    Ok(dir.join(format!("{snapshot_id}.json")))
}

pub(crate) fn side_snapshot_dir(
    app: &tauri::AppHandle,
    snapshot_id: &str,
) -> Result<PathBuf, String> {
    if !is_valid_side_snapshot_id(snapshot_id) {
        return Err("invalid side snapshot id".to_string());
    }

    Ok(side_snapshots_dir(app)?.join(snapshot_id))
}

pub(crate) fn is_valid_snapshot_id(value: &str) -> bool {
    value.starts_with("snapshot-")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub(crate) fn is_valid_side_snapshot_id(value: &str) -> bool {
    value.starts_with("side-snapshot-")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub(crate) fn write_snapshot_file(path: &Path, snapshot: &serde_json::Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "snapshot file has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let content = serde_json::to_string_pretty(snapshot).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

pub(crate) fn read_snapshot_file(path: &Path) -> Result<serde_json::Value, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

pub(crate) fn write_side_snapshot_record(
    dir: &Path,
    record: &SideSnapshotRecord,
) -> Result<(), String> {
    let content = serde_json::to_string_pretty(record).map_err(|error| error.to_string())?;
    fs::write(dir.join("snapshot.json"), content).map_err(|error| error.to_string())
}

pub(crate) fn read_side_snapshot_record(dir: &Path) -> Result<SideSnapshotRecord, String> {
    let content =
        fs::read_to_string(dir.join("snapshot.json")).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

pub(crate) fn restore_workspace_from_tree(
    workspace: &Path,
    tree: &Path,
    restored_files: &mut Vec<String>,
    failures: &mut Vec<String>,
) {
    remove_paths_missing_from_tree(workspace, workspace, tree, restored_files, failures);
    copy_tree_to_workspace(tree, tree, workspace, restored_files, failures);
}

pub(crate) fn remove_paths_missing_from_tree(
    workspace: &Path,
    current_root: &Path,
    snapshot_root: &Path,
    restored_files: &mut Vec<String>,
    failures: &mut Vec<String>,
) {
    let Ok(entries) = fs::read_dir(current_root) else {
        return;
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        if should_skip_side_snapshot_name(&name.to_string_lossy()) {
            continue;
        }

        let current_path = entry.path();
        let snapshot_path = snapshot_root.join(&name);
        if !snapshot_path.exists() {
            let relative = display_workspace_relative_path(workspace, &current_path);
            let result = if current_path.is_dir() {
                fs::remove_dir_all(&current_path)
            } else {
                fs::remove_file(&current_path)
            };
            match result {
                Ok(()) => restored_files.push(relative),
                Err(error) => failures.push(format!("{relative}: {error}")),
            }
            continue;
        }

        if current_path.is_dir() {
            remove_paths_missing_from_tree(
                workspace,
                &current_path,
                &snapshot_path,
                restored_files,
                failures,
            );
        }
    }
}

pub(crate) fn copy_tree_to_workspace(
    tree_root: &Path,
    source_root: &Path,
    workspace: &Path,
    restored_files: &mut Vec<String>,
    failures: &mut Vec<String>,
) {
    let Ok(entries) = fs::read_dir(source_root) else {
        return;
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let source_path = entry.path();
        let relative_path = source_path.strip_prefix(tree_root).unwrap_or(&source_path);
        let target_path = workspace.join(relative_path);
        if source_path.is_dir() {
            if let Err(error) = fs::create_dir_all(&target_path) {
                failures.push(format!("{}: {error}", relative_path.display()));
                continue;
            }
            copy_tree_to_workspace(tree_root, &source_path, workspace, restored_files, failures);
        } else if source_path.is_file() {
            if let Some(parent) = target_path.parent()
                && let Err(error) = fs::create_dir_all(parent)
            {
                failures.push(format!("{}: {error}", relative_path.display()));
                continue;
            }
            match fs::copy(&source_path, &target_path) {
                Ok(_) => restored_files.push(relative_path.display().to_string()),
                Err(error) => failures.push(format!("{}: {error}", relative_path.display())),
            }
        } else {
            let _ = name;
        }
    }
}
