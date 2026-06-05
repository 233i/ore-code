use super::*;
use crate::command_utils::{hide_child_console_on_windows, resolve_executable_for_command};
use crate::workspace_commands::canonicalize_workspace;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatusEntry {
    pub(crate) status: String,
    pub(crate) path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatusResult {
    pub(crate) is_repo: bool,
    pub(crate) branch: Option<String>,
    pub(crate) entries: Vec<GitStatusEntry>,
    pub(crate) raw: String,
    pub(crate) error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitDiffResult {
    pub(crate) is_repo: bool,
    pub(crate) diff: String,
    pub(crate) error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitBranchResult {
    pub(crate) is_repo: bool,
    pub(crate) current: Option<String>,
    pub(crate) branches: Vec<String>,
    pub(crate) raw: String,
    pub(crate) error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitTextResult {
    pub(crate) is_repo: bool,
    pub(crate) output: String,
    pub(crate) error: Option<String>,
}

#[tauri::command]
pub(crate) fn git_status(workspace_path: String) -> Result<GitStatusResult, String> {
    let workspace = canonicalize_workspace(&workspace_path)?;
    if !workspace.is_dir() {
        return Err("workspace path must be a directory".to_string());
    }

    read_git_status(&workspace)
}

#[tauri::command]
pub(crate) fn git_diff(
    workspace_path: String,
    staged: bool,
    path: Option<String>,
) -> Result<GitDiffResult, String> {
    let workspace = canonicalize_workspace(&workspace_path)?;
    if !workspace.is_dir() {
        return Err("workspace path must be a directory".to_string());
    }

    read_git_diff(&workspace, staged, path.as_deref())
}

#[tauri::command]
pub(crate) fn git_branch(workspace_path: String) -> Result<GitBranchResult, String> {
    let workspace = canonicalize_workspace(&workspace_path)?;
    if !workspace.is_dir() {
        return Err("workspace path must be a directory".to_string());
    }

    read_git_branch(&workspace)
}

#[tauri::command]
pub(crate) fn git_log(
    workspace_path: String,
    max_count: Option<u32>,
) -> Result<GitTextResult, String> {
    let workspace = canonicalize_workspace(&workspace_path)?;
    if !workspace.is_dir() {
        return Err("workspace path must be a directory".to_string());
    }

    read_git_log(&workspace, max_count.unwrap_or(20).clamp(1, 100))
}

#[tauri::command]
pub(crate) fn git_show(
    workspace_path: String,
    rev: String,
    path: Option<String>,
) -> Result<GitTextResult, String> {
    let workspace = canonicalize_workspace(&workspace_path)?;
    if !workspace.is_dir() {
        return Err("workspace path must be a directory".to_string());
    }

    read_git_show(&workspace, &rev, path.as_deref())
}

#[tauri::command]
pub(crate) fn git_blame(
    workspace_path: String,
    path: String,
    rev: Option<String>,
) -> Result<GitTextResult, String> {
    let workspace = canonicalize_workspace(&workspace_path)?;
    if !workspace.is_dir() {
        return Err("workspace path must be a directory".to_string());
    }

    read_git_blame(&workspace, &path, rev.as_deref())
}

pub(crate) fn read_git_status(workspace: &Path) -> Result<GitStatusResult, String> {
    if let Some(error) = git_repo_error(workspace)? {
        return Ok(GitStatusResult {
            is_repo: false,
            branch: None,
            entries: Vec::new(),
            raw: String::new(),
            error: Some(error),
        });
    }

    let repo_root = git_repo_root(workspace)?;
    let output = run_git_command(&repo_root, &["status", "--porcelain=v1", "-uall", "-b"])?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(parse_git_status(&raw))
}

pub(crate) fn read_git_diff(
    workspace: &Path,
    staged: bool,
    path: Option<&str>,
) -> Result<GitDiffResult, String> {
    if let Some(error) = git_repo_error(workspace)? {
        return Ok(GitDiffResult {
            is_repo: false,
            diff: String::new(),
            error: Some(error),
        });
    }

    let repo_root = git_repo_root(workspace)?;
    if !staged
        && let Some(path) = path
        && is_untracked_git_path(&repo_root, path)?
    {
        return Ok(GitDiffResult {
            is_repo: true,
            diff: build_untracked_file_diff(&repo_root, path)?,
            error: None,
        });
    }

    let mut args = vec!["diff", "--no-ext-diff"];
    if staged {
        args.push("--cached");
    }
    if path.is_some() {
        args.push("--");
    }
    if let Some(path) = path {
        args.push(path);
    }

    let output = run_git_command(&repo_root, &args)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(GitDiffResult {
        is_repo: true,
        diff: String::from_utf8_lossy(&output.stdout).to_string(),
        error: None,
    })
}

pub(crate) fn is_untracked_git_path(workspace: &Path, path: &str) -> Result<bool, String> {
    let output = run_git_command(
        workspace,
        &["status", "--porcelain=v1", "-uall", "--", path],
    )?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .any(|line| line.starts_with("?? ")))
}

pub(crate) fn build_untracked_file_diff(workspace: &Path, path: &str) -> Result<String, String> {
    let file_path = workspace.join(path);
    if !file_path.is_file() {
        return Ok(format!("No unstaged diff for untracked path: {path}"));
    }

    let bytes = fs::read(&file_path).map_err(|error| error.to_string())?;
    let content = String::from_utf8_lossy(&bytes);
    let line_count = content.lines().count();
    let mut diff = format!(
        "diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{line_count} @@\n"
    );

    for line in content.lines() {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }

    if !content.ends_with('\n') && !content.is_empty() {
        diff.push_str("\\ No newline at end of file\n");
    }

    Ok(diff)
}

pub(crate) fn read_git_branch(workspace: &Path) -> Result<GitBranchResult, String> {
    if let Some(error) = git_repo_error(workspace)? {
        return Ok(GitBranchResult {
            is_repo: false,
            current: None,
            branches: Vec::new(),
            raw: String::new(),
            error: Some(error),
        });
    }

    let current_output = run_git_command(workspace, &["branch", "--show-current"])?;
    if !current_output.status.success() {
        return Err(String::from_utf8_lossy(&current_output.stderr)
            .trim()
            .to_string());
    }
    let current = String::from_utf8_lossy(&current_output.stdout)
        .trim()
        .to_string();

    let list_output = run_git_command(workspace, &["branch", "--format=%(refname:short)"])?;
    if !list_output.status.success() {
        return Err(String::from_utf8_lossy(&list_output.stderr)
            .trim()
            .to_string());
    }
    let raw = String::from_utf8_lossy(&list_output.stdout).to_string();
    let branches = raw
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();

    Ok(GitBranchResult {
        is_repo: true,
        current: (!current.is_empty()).then_some(current),
        branches,
        raw,
        error: None,
    })
}

pub(crate) fn read_git_log(workspace: &Path, max_count: u32) -> Result<GitTextResult, String> {
    let max_count_arg = format!("--max-count={max_count}");
    git_text_command(
        workspace,
        &["log", "--oneline", "--decorate", max_count_arg.as_str()],
    )
}

pub(crate) fn read_git_show(
    workspace: &Path,
    rev: &str,
    path: Option<&str>,
) -> Result<GitTextResult, String> {
    let rev = rev.trim();
    if rev.is_empty() {
        return Err("git show revision must not be empty".to_string());
    }

    let mut args = vec!["show", "--stat", "--patch", rev];
    if path.is_some() {
        args.push("--");
    }
    if let Some(path) = path {
        args.push(path);
    }

    git_text_command(workspace, &args)
}

pub(crate) fn read_git_blame(
    workspace: &Path,
    path: &str,
    rev: Option<&str>,
) -> Result<GitTextResult, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("git blame path must not be empty".to_string());
    }

    let mut args = vec!["blame"];
    if let Some(rev) = rev.map(str::trim).filter(|value| !value.is_empty()) {
        args.push(rev);
    }
    args.push("--");
    args.push(path);

    git_text_command(workspace, &args)
}

pub(crate) fn git_text_command(workspace: &Path, args: &[&str]) -> Result<GitTextResult, String> {
    if let Some(error) = git_repo_error(workspace)? {
        return Ok(GitTextResult {
            is_repo: false,
            output: String::new(),
            error: Some(error),
        });
    }

    let output = run_git_command(workspace, args)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(GitTextResult {
        is_repo: true,
        output: String::from_utf8_lossy(&output.stdout).to_string(),
        error: None,
    })
}

pub(crate) fn git_repo_error(workspace: &Path) -> Result<Option<String>, String> {
    let output = run_git_command(workspace, &["rev-parse", "--is-inside-work-tree"])?;
    if output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "true" {
        return Ok(None);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok(Some(if stderr.is_empty() {
        "selected workspace is not inside a Git repository".to_string()
    } else {
        stderr
    }))
}

pub(crate) fn git_repo_root(workspace: &Path) -> Result<PathBuf, String> {
    let output = run_git_command(workspace, &["rev-parse", "--show-toplevel"])?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if root.is_empty() {
        return Err("git repository root is empty".to_string());
    }

    Ok(PathBuf::from(root))
}

pub(crate) fn run_git_command(
    workspace: &Path,
    args: &[&str],
) -> Result<std::process::Output, String> {
    let mut command_process = Command::new(resolve_executable_for_command("git"));
    hide_child_console_on_windows(
        command_process
            .args(args)
            .current_dir(workspace)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()),
    );
    command_process.output().map_err(|error| error.to_string())
}

pub(crate) fn parse_git_status(raw: &str) -> GitStatusResult {
    let mut branch = None;
    let mut entries = Vec::new();

    for line in raw.lines() {
        if let Some(branch_line) = line.strip_prefix("## ") {
            branch = Some(branch_line.to_string());
            continue;
        }

        if line.len() >= 3 {
            entries.push(GitStatusEntry {
                status: line[..2].to_string(),
                path: line[3..].to_string(),
            });
        }
    }

    GitStatusResult {
        is_repo: true,
        branch,
        entries,
        raw: raw.to_string(),
        error: None,
    }
}
