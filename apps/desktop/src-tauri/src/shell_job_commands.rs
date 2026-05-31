use super::*;
use crate::shell_commands::{ShellRunResult, run_shell_command_with_cancel};
use crate::workspace_commands::canonicalize_workspace;

#[derive(Clone, Default)]
pub(crate) struct ShellJobStore {
    pub(crate) jobs: Arc<Mutex<HashMap<String, ShellJobRecord>>>,
    pub(crate) cancel_tokens: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

#[derive(Clone)]
pub(crate) struct ShellJobRecord {
    pub(crate) id: String,
    pub(crate) workspace_path: String,
    pub(crate) command: String,
    pub(crate) status: String,
    pub(crate) exit_code: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) duration_ms: Option<u128>,
    pub(crate) timed_out: bool,
    pub(crate) stdout_truncated: bool,
    pub(crate) stderr_truncated: bool,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellJobSnapshot {
    pub(crate) id: String,
    pub(crate) workspace_path: String,
    pub(crate) command: String,
    pub(crate) status: String,
    pub(crate) exit_code: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) duration_ms: Option<u128>,
    pub(crate) timed_out: bool,
    pub(crate) stdout_truncated: bool,
    pub(crate) stderr_truncated: bool,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) error: Option<String>,
}

#[tauri::command]
pub(crate) fn shell_job_start(
    state: tauri::State<ShellJobStore>,
    workspace_path: String,
    command: String,
    timeout_ms: u64,
) -> Result<ShellJobSnapshot, String> {
    start_shell_job(state.inner().clone(), workspace_path, command, timeout_ms)
}

#[tauri::command]
pub(crate) fn shell_job_list(
    state: tauri::State<ShellJobStore>,
) -> Result<Vec<ShellJobSnapshot>, String> {
    let jobs = state
        .jobs
        .lock()
        .map_err(|_| "shell job store is poisoned".to_string())?;
    let mut snapshots = jobs.values().map(shell_job_snapshot).collect::<Vec<_>>();
    snapshots.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(snapshots)
}

#[tauri::command]
pub(crate) fn shell_job_get(
    state: tauri::State<ShellJobStore>,
    job_id: String,
) -> Result<ShellJobSnapshot, String> {
    get_shell_job(state.inner(), &job_id)
}

#[tauri::command]
pub(crate) fn shell_job_cancel(
    state: tauri::State<ShellJobStore>,
    job_id: String,
) -> Result<ShellJobSnapshot, String> {
    cancel_shell_job(state.inner(), &job_id)
}

pub(crate) fn start_shell_job(
    store: ShellJobStore,
    workspace_path: String,
    command: String,
    timeout_ms: u64,
) -> Result<ShellJobSnapshot, String> {
    let command = command.trim().to_string();
    if command.is_empty() {
        return Err("shell job command must not be empty".to_string());
    }

    let workspace = canonicalize_workspace(&workspace_path)?;
    if !workspace.is_dir() {
        return Err("workspace path must be a directory".to_string());
    }

    let job_id = next_shell_job_id();
    let now = timestamp_now();
    let record = ShellJobRecord {
        id: job_id.clone(),
        workspace_path: workspace.display().to_string(),
        command: command.clone(),
        status: "running".to_string(),
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        duration_ms: None,
        timed_out: false,
        stdout_truncated: false,
        stderr_truncated: false,
        created_at: now.clone(),
        updated_at: now,
        error: None,
    };

    {
        let mut jobs = store
            .jobs
            .lock()
            .map_err(|_| "shell job store is poisoned".to_string())?;
        jobs.insert(job_id.clone(), record.clone());
    }

    let cancel_token = Arc::new(AtomicBool::new(false));
    {
        let mut tokens = store
            .cancel_tokens
            .lock()
            .map_err(|_| "shell job store is poisoned".to_string())?;
        tokens.insert(job_id.clone(), cancel_token.clone());
    }

    let worker_store = store.clone();
    thread::spawn(move || {
        let result = run_shell_command_with_cancel(
            &workspace,
            &command,
            timeout_ms,
            cancel_token,
            None,
            None,
        );
        finish_shell_job(worker_store, &job_id, result);
    });

    Ok(shell_job_snapshot(&record))
}

pub(crate) fn cancel_shell_job(
    store: &ShellJobStore,
    job_id: &str,
) -> Result<ShellJobSnapshot, String> {
    let token = {
        let tokens = store
            .cancel_tokens
            .lock()
            .map_err(|_| "shell job store is poisoned".to_string())?;
        tokens.get(job_id).cloned()
    }
    .ok_or_else(|| "shell job is not running or does not exist".to_string())?;

    token.store(true, Ordering::Relaxed);

    let mut jobs = store
        .jobs
        .lock()
        .map_err(|_| "shell job store is poisoned".to_string())?;
    let job = jobs
        .get_mut(job_id)
        .ok_or_else(|| "shell job does not exist".to_string())?;
    job.status = "canceling".to_string();
    job.updated_at = timestamp_now();
    Ok(shell_job_snapshot(job))
}

pub(crate) fn get_shell_job(
    store: &ShellJobStore,
    job_id: &str,
) -> Result<ShellJobSnapshot, String> {
    let jobs = store
        .jobs
        .lock()
        .map_err(|_| "shell job store is poisoned".to_string())?;
    let job = jobs
        .get(job_id)
        .ok_or_else(|| "shell job does not exist".to_string())?;
    Ok(shell_job_snapshot(job))
}

pub(crate) fn finish_shell_job(
    store: ShellJobStore,
    job_id: &str,
    result: Result<(ShellRunResult, bool), String>,
) {
    if let Ok(mut tokens) = store.cancel_tokens.lock() {
        tokens.remove(job_id);
    }

    let Ok(mut jobs) = store.jobs.lock() else {
        return;
    };
    let Some(job) = jobs.get_mut(job_id) else {
        return;
    };

    match result {
        Ok((output, canceled)) => {
            let stdout = truncate_job_output(&output.stdout);
            let stderr = truncate_job_output(&output.stderr);
            job.status = if canceled {
                "canceled".to_string()
            } else {
                "completed".to_string()
            };
            job.exit_code = output.exit_code;
            job.stdout = stdout.text;
            job.stderr = stderr.text;
            job.duration_ms = Some(output.duration_ms);
            job.timed_out = output.timed_out;
            job.stdout_truncated = stdout.truncated;
            job.stderr_truncated = stderr.truncated;
            job.error = None;
        }
        Err(error) => {
            job.status = "failed".to_string();
            job.error = Some(error);
        }
    }

    job.updated_at = timestamp_now();
}

pub(crate) fn shell_job_snapshot(job: &ShellJobRecord) -> ShellJobSnapshot {
    ShellJobSnapshot {
        id: job.id.clone(),
        workspace_path: job.workspace_path.clone(),
        command: job.command.clone(),
        status: job.status.clone(),
        exit_code: job.exit_code,
        stdout: job.stdout.clone(),
        stderr: job.stderr.clone(),
        duration_ms: job.duration_ms,
        timed_out: job.timed_out,
        stdout_truncated: job.stdout_truncated,
        stderr_truncated: job.stderr_truncated,
        created_at: job.created_at.clone(),
        updated_at: job.updated_at.clone(),
        error: job.error.clone(),
    }
}

pub(crate) struct TruncatedText {
    pub(crate) text: String,
    pub(crate) truncated: bool,
}

pub(crate) fn truncate_job_output(value: &str) -> TruncatedText {
    if value.chars().count() <= MAX_JOB_OUTPUT_CHARS {
        return TruncatedText {
            text: value.to_string(),
            truncated: false,
        };
    }

    TruncatedText {
        text: value
            .chars()
            .rev()
            .take(MAX_JOB_OUTPUT_CHARS)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect(),
        truncated: true,
    }
}

pub(crate) fn next_shell_job_id() -> String {
    static JOB_COUNTER: AtomicU64 = AtomicU64::new(0);
    let count = JOB_COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("job-{millis}-{count}")
}

pub(crate) fn timestamp_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
