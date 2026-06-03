use super::*;
use crate::command_utils::{hide_child_console_on_windows, resolve_executable_for_command};

#[derive(Clone)]
pub(crate) struct SideGitSnapshot {
    pub(crate) commit: String,
    pub(crate) branch: String,
    pub(crate) repo_path: String,
}

pub(crate) fn side_git_repos_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("side-git"))
}

pub(crate) fn side_git_repo_dir(
    app: &tauri::AppHandle,
    workspace: &Path,
) -> Result<PathBuf, String> {
    Ok(side_git_repos_dir(app)?.join(stable_hash_hex(&workspace.display().to_string())))
}

pub(crate) fn copy_workspace_tree(workspace: &Path, target: &Path) -> Result<usize, String> {
    let mut file_count = 0;
    copy_dir_filtered(workspace, target, &mut file_count)?;
    Ok(file_count)
}

pub(crate) fn create_side_git_snapshot(
    app: &tauri::AppHandle,
    workspace: &Path,
    snapshot_id: &str,
    thread_id: &str,
    turn_id: &str,
    label: &str,
) -> Result<SideGitSnapshot, String> {
    let repo_dir = side_git_repo_dir(app, workspace)?;
    create_side_git_snapshot_at(&repo_dir, workspace, snapshot_id, thread_id, turn_id, label)
}

pub(crate) fn create_side_git_snapshot_at(
    repo_dir: &Path,
    workspace: &Path,
    snapshot_id: &str,
    thread_id: &str,
    turn_id: &str,
    label: &str,
) -> Result<SideGitSnapshot, String> {
    fs::create_dir_all(repo_dir).map_err(|error| error.to_string())?;
    if !repo_dir.join(".git").is_dir() {
        ensure_git_success(repo_dir, &["init"], "initialize side-git repo")?;
    }
    ensure_git_success(
        repo_dir,
        &["config", "user.name", "Ore Code Side Git"],
        "configure side-git user",
    )?;
    ensure_git_success(
        repo_dir,
        &["config", "user.email", "side-git@ore-code.local"],
        "configure side-git email",
    )?;

    let branch = side_git_branch_name(thread_id);
    let branch_ref = format!("refs/heads/{branch}");
    let branch_exists = run_git_command(repo_dir, &["rev-parse", "--verify", &branch_ref])
        .map(|output| output.status.success())
        .unwrap_or(false);
    if branch_exists {
        ensure_git_success(
            repo_dir,
            &["checkout", "-f", &branch],
            "checkout side-git branch",
        )?;
    } else if git_head_exists(repo_dir) {
        ensure_git_success(
            repo_dir,
            &["checkout", "--orphan", &branch],
            "create side-git branch",
        )?;
    }

    clear_side_git_worktree(repo_dir)?;
    let _file_count = copy_workspace_tree(workspace, repo_dir)?;
    ensure_git_success(repo_dir, &["add", "-A"], "stage side-git snapshot")?;
    let message = format!("{label} {turn_id} ({snapshot_id})");
    ensure_git_success(
        repo_dir,
        &["commit", "--allow-empty", "-m", &message],
        "commit side-git snapshot",
    )?;
    if !branch_exists {
        ensure_git_success(repo_dir, &["branch", "-M", &branch], "name side-git branch")?;
    }
    let commit_output =
        ensure_git_success(repo_dir, &["rev-parse", "HEAD"], "read side-git commit")?;
    let commit = String::from_utf8_lossy(&commit_output.stdout)
        .trim()
        .to_string();

    Ok(SideGitSnapshot {
        commit,
        branch,
        repo_path: repo_dir.display().to_string(),
    })
}

pub(crate) fn restore_side_git_commit(
    repo_dir: &Path,
    commit: &str,
    workspace: &Path,
) -> Result<Vec<String>, String> {
    if !repo_dir.join(".git").is_dir() {
        return Err("side-git repo is missing".to_string());
    }
    if !is_valid_side_git_commit(commit) {
        return Err("invalid side-git commit".to_string());
    }

    let files_output = ensure_git_success(
        repo_dir,
        &["ls-tree", "-r", "--name-only", commit],
        "list side-git files",
    )?;
    let mut restored_files = Vec::new();
    let mut failures = Vec::new();
    clear_workspace_for_side_restore(workspace, &mut restored_files, &mut failures);
    if !failures.is_empty() {
        return Err(failures.join("; "));
    }

    let git_dir = repo_dir.join(".git");
    let git_dir_arg = format!("--git-dir={}", git_dir.display());
    let work_tree_arg = format!("--work-tree={}", workspace.display());
    let mut command_process = Command::new(resolve_executable_for_command("git"));
    hide_child_console_on_windows(
        command_process
            .arg(git_dir_arg)
            .arg(work_tree_arg)
            .args(["checkout", "-f", commit, "--", "."])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()),
    );
    let output = command_process
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    for line in String::from_utf8_lossy(&files_output.stdout).lines() {
        if !line.trim().is_empty() && !restored_files.iter().any(|path| path == line) {
            restored_files.push(line.to_string());
        }
    }
    Ok(restored_files)
}

pub(crate) fn ensure_git_success(
    repo_dir: &Path,
    args: &[&str],
    action: &str,
) -> Result<std::process::Output, String> {
    let output = run_git_command(repo_dir, args)?;
    if output.status.success() {
        return Ok(output);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("failed to {action}")
    } else {
        format!("failed to {action}: {stderr}")
    })
}

pub(crate) fn git_head_exists(repo_dir: &Path) -> bool {
    run_git_command(repo_dir, &["rev-parse", "--verify", "HEAD"])
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub(crate) fn side_git_branch_name(thread_id: &str) -> String {
    let sanitized: String = thread_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    format!("thread-{}", sanitized.trim_matches('-'))
}

pub(crate) fn stable_hash_hex(value: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

pub(crate) fn is_valid_side_git_commit(value: &str) -> bool {
    (7..=64).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) fn clear_side_git_worktree(repo_dir: &Path) -> Result<(), String> {
    for entry in fs::read_dir(repo_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_name().to_string_lossy() == ".git" {
            continue;
        }
        remove_path(&entry.path()).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn clear_workspace_for_side_restore(
    workspace: &Path,
    restored_files: &mut Vec<String>,
    failures: &mut Vec<String>,
) {
    let Ok(entries) = fs::read_dir(workspace) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if should_skip_side_snapshot_name(&name.to_string_lossy()) {
            continue;
        }
        let path = entry.path();
        let relative = display_workspace_relative_path(workspace, &path);
        match remove_path(&path) {
            Ok(()) => restored_files.push(relative),
            Err(error) => failures.push(format!("{relative}: {error}")),
        }
    }
}

pub(crate) fn remove_path(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

pub(crate) fn copy_dir_filtered(
    source: &Path,
    target: &Path,
    file_count: &mut usize,
) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        if should_skip_side_snapshot_name(&name.to_string_lossy()) {
            continue;
        }

        let source_path = entry.path();
        let target_path = target.join(&name);
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if metadata.is_dir() {
            copy_dir_filtered(&source_path, &target_path, file_count)?;
        } else if metadata.is_file() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::copy(&source_path, &target_path).map_err(|error| error.to_string())?;
            *file_count += 1;
        }
    }
    Ok(())
}

pub(crate) fn should_skip_side_snapshot_name(name: &str) -> bool {
    matches!(
        name,
        ".git" | ".ore-code" | "node_modules" | "target" | "dist" | "build" | ".next"
        | ".turbo"
    )
}
