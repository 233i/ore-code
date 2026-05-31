use super::*;
use crate::workspace_commands::{
    canonicalize_workspace, resolve_existing_workspace_path, resolve_workspace_write_path,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FsEntry {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) is_dir: bool,
    pub(crate) size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadTextResult {
    pub(crate) path: String,
    pub(crate) content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteTextResult {
    pub(crate) path: String,
    pub(crate) bytes_written: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileSearchMatch {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) is_dir: bool,
    pub(crate) size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileSearchResult {
    pub(crate) matches: Vec<FileSearchMatch>,
    pub(crate) truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrepMatch {
    pub(crate) path: String,
    pub(crate) line_number: usize,
    pub(crate) line: String,
    pub(crate) match_start: usize,
    pub(crate) match_end: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrepFilesResult {
    pub(crate) matches: Vec<GrepMatch>,
    pub(crate) truncated: bool,
}

#[tauri::command]
pub(crate) fn fs_read_text(workspace_path: String, path: String) -> Result<ReadTextResult, String> {
    let resolved = resolve_existing_workspace_path(&workspace_path, &path)?;
    let content = fs::read_to_string(&resolved).map_err(|error| error.to_string())?;

    Ok(ReadTextResult {
        path: resolved.display().to_string(),
        content,
    })
}

#[tauri::command]
pub(crate) fn fs_list_dir(workspace_path: String, path: String) -> Result<Vec<FsEntry>, String> {
    let resolved = resolve_existing_workspace_path(&workspace_path, &path)?;
    let mut entries = Vec::new();

    for entry in fs::read_dir(&resolved).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        entries.push(FsEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().display().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.is_file().then_some(metadata.len()),
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[tauri::command]
pub(crate) fn fs_write_text(
    workspace_path: String,
    path: String,
    content: String,
) -> Result<WriteTextResult, String> {
    let resolved = resolve_workspace_write_path(&workspace_path, &path)?;
    fs::write(&resolved, content.as_bytes()).map_err(|error| error.to_string())?;

    Ok(WriteTextResult {
        path: resolved.display().to_string(),
        bytes_written: content.len(),
    })
}

#[tauri::command]
pub(crate) fn fs_delete_file(workspace_path: String, path: String) -> Result<(), String> {
    let resolved = resolve_workspace_write_path(&workspace_path, &path)?;
    let metadata = fs::metadata(&resolved).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("delete only supports files".to_string());
    }

    fs::remove_file(&resolved).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn fs_search_files(
    workspace_path: String,
    path: String,
    query: String,
    max_results: Option<usize>,
) -> Result<FileSearchResult, String> {
    let workspace = canonicalize_workspace(&workspace_path)?;
    let root = resolve_existing_workspace_path(&workspace_path, &path)?;
    search_files(&workspace, &root, &query, max_results)
}

#[tauri::command]
pub(crate) fn fs_grep_files(
    workspace_path: String,
    path: String,
    pattern: String,
    case_sensitive: Option<bool>,
    max_results: Option<usize>,
) -> Result<GrepFilesResult, String> {
    let workspace = canonicalize_workspace(&workspace_path)?;
    let root = resolve_existing_workspace_path(&workspace_path, &path)?;
    grep_files(
        &workspace,
        &root,
        &pattern,
        case_sensitive.unwrap_or(false),
        max_results,
    )
}

pub(crate) fn search_files(
    workspace: &Path,
    root: &Path,
    query: &str,
    max_results: Option<usize>,
) -> Result<FileSearchResult, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("search query must not be empty".to_string());
    }

    let limit = bounded_search_limit(max_results);
    let query_lower = query.to_lowercase();
    let mut matches = Vec::new();
    let mut truncated = false;

    walk_workspace(root, &mut |path, metadata| {
        if matches.len() >= limit {
            truncated = true;
            return Ok(false);
        }

        let relative = display_workspace_relative_path(workspace, path);
        if relative.to_lowercase().contains(&query_lower) {
            matches.push(FileSearchMatch {
                path: relative,
                name: path
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| relative_path_fallback(path)),
                is_dir: metadata.is_dir(),
                size: metadata.is_file().then_some(metadata.len()),
            });
        }

        Ok(true)
    })?;

    Ok(FileSearchResult { matches, truncated })
}

pub(crate) fn grep_files(
    workspace: &Path,
    root: &Path,
    pattern: &str,
    case_sensitive: bool,
    max_results: Option<usize>,
) -> Result<GrepFilesResult, String> {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return Err("grep pattern must not be empty".to_string());
    }

    let limit = bounded_search_limit(max_results);
    let needle = if case_sensitive {
        pattern.to_string()
    } else {
        pattern.to_lowercase()
    };
    let mut matches = Vec::new();
    let mut truncated = false;

    walk_workspace(root, &mut |path, metadata| {
        if matches.len() >= limit {
            truncated = true;
            return Ok(false);
        }

        if !metadata.is_file() {
            return Ok(true);
        }

        let Ok(content) = fs::read_to_string(path) else {
            return Ok(true);
        };

        for (line_index, line) in content.lines().enumerate() {
            let haystack = if case_sensitive {
                line.to_string()
            } else {
                line.to_lowercase()
            };

            if let Some(match_start) = haystack.find(&needle) {
                matches.push(GrepMatch {
                    path: display_workspace_relative_path(workspace, path),
                    line_number: line_index + 1,
                    line: line.to_string(),
                    match_start,
                    match_end: match_start + needle.len(),
                });
                if matches.len() >= limit {
                    truncated = true;
                    return Ok(false);
                }
            }
        }

        Ok(true)
    })?;

    Ok(GrepFilesResult { matches, truncated })
}

pub(crate) fn walk_workspace<F>(root: &Path, visit: &mut F) -> Result<(), String>
where
    F: FnMut(&Path, &fs::Metadata) -> Result<bool, String>,
{
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        if !visit(&path, &metadata)? {
            return Ok(());
        }

        if !metadata.is_dir() || should_skip_search_dir(&path) {
            continue;
        }

        let mut children = Vec::new();
        for entry in fs::read_dir(&path).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_symlink()
            {
                continue;
            }
            children.push(entry.path());
        }
        children.sort();
        stack.extend(children.into_iter().rev());
    }

    Ok(())
}

pub(crate) fn should_skip_search_dir(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };

    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | "build" | ".next" | ".turbo" | ".cache"
    )
}

pub(crate) fn bounded_search_limit(max_results: Option<usize>) -> usize {
    max_results
        .unwrap_or(DEFAULT_SEARCH_LIMIT)
        .clamp(1, MAX_SEARCH_LIMIT)
}

pub(crate) fn display_workspace_relative_path(workspace: &Path, path: &Path) -> String {
    path.strip_prefix(workspace)
        .unwrap_or(path)
        .display()
        .to_string()
}

pub(crate) fn relative_path_fallback(path: &Path) -> String {
    path.display().to_string()
}
