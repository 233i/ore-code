use super::*;
use crate::sandbox_commands::{
    SandboxPolicy, SandboxRunMetadata, bind_child_to_runtime, prepare_child_command,
    sandbox_metadata, terminate_child_tree,
};
use crate::workspace_commands::canonicalize_workspace;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellRunResult {
    pub(crate) command: String,
    pub(crate) exit_code: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) duration_ms: u128,
    pub(crate) timed_out: bool,
    pub(crate) sandbox: Option<SandboxRunMetadata>,
}

#[derive(Clone)]
pub(crate) struct ShellOutputEmitter {
    pub(crate) app: tauri::AppHandle,
    pub(crate) run_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellRunOutputEvent {
    pub(crate) run_id: String,
    pub(crate) stream: String,
    pub(crate) text: String,
}

pub(crate) struct ShellInvocation {
    pub(crate) program: &'static str,
    pub(crate) args: Vec<String>,
}

#[tauri::command]
pub(crate) async fn shell_run(
    app: tauri::AppHandle,
    workspace_path: String,
    command: String,
    timeout_ms: u64,
    run_id: Option<String>,
    sandbox_policy: Option<SandboxPolicy>,
) -> Result<ShellRunResult, String> {
    let workspace = canonicalize_workspace(&workspace_path)?;
    if !workspace.is_dir() {
        return Err("workspace path must be a directory".to_string());
    }

    let emitter = run_id.map(|run_id| ShellOutputEmitter { app, run_id });
    tauri::async_runtime::spawn_blocking(move || {
        run_shell_command_with_policy(&workspace, &command, timeout_ms, emitter, sandbox_policy)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[allow(dead_code)]
pub(crate) fn run_shell_command(
    workspace: &Path,
    command: &str,
    timeout_ms: u64,
) -> Result<ShellRunResult, String> {
    run_shell_command_with_output(workspace, command, timeout_ms, None)
}

pub(crate) fn run_shell_command_with_output(
    workspace: &Path,
    command: &str,
    timeout_ms: u64,
    output_emitter: Option<ShellOutputEmitter>,
) -> Result<ShellRunResult, String> {
    run_shell_command_with_cancel(
        workspace,
        command,
        timeout_ms,
        Arc::new(AtomicBool::new(false)),
        output_emitter,
        None,
    )
    .map(|(result, _canceled)| result)
}

pub(crate) fn run_shell_command_with_policy(
    workspace: &Path,
    command: &str,
    timeout_ms: u64,
    output_emitter: Option<ShellOutputEmitter>,
    sandbox_policy: Option<SandboxPolicy>,
) -> Result<ShellRunResult, String> {
    run_shell_command_with_cancel(
        workspace,
        command,
        timeout_ms,
        Arc::new(AtomicBool::new(false)),
        output_emitter,
        sandbox_policy,
    )
    .map(|(result, _canceled)| result)
}

pub(crate) fn run_shell_command_with_cancel(
    workspace: &Path,
    command: &str,
    timeout_ms: u64,
    cancel_token: Arc<AtomicBool>,
    output_emitter: Option<ShellOutputEmitter>,
    sandbox_policy: Option<SandboxPolicy>,
) -> Result<(ShellRunResult, bool), String> {
    let started_at = Instant::now();
    let timeout = Duration::from_millis(timeout_ms);
    let invocation = shell_invocation(command);
    let mut command_process = Command::new(invocation.program);
    command_process
        .args(invocation.args)
        .current_dir(workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let sandbox_runtime = prepare_child_command(&mut command_process, sandbox_policy.as_ref());
    let mut child = command_process.spawn().map_err(|error| error.to_string())?;
    bind_child_to_runtime(&sandbox_runtime, &child);
    let stdout = child.stdout.take().map(|mut pipe| {
        let emitter = output_emitter.clone().map(|emitter| (emitter, "stdout"));
        thread::spawn(move || read_pipe_to_end(&mut pipe, emitter))
    });
    let stderr = child.stderr.take().map(|mut pipe| {
        let emitter = output_emitter.clone().map(|emitter| (emitter, "stderr"));
        thread::spawn(move || read_pipe_to_end(&mut pipe, emitter))
    });

    loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Ok((
                shell_result_from_parts(
                    command,
                    status.code(),
                    stdout,
                    stderr,
                    started_at,
                    false,
                    sandbox_metadata(&sandbox_runtime),
                ),
                false,
            ));
        }

        if cancel_token.load(Ordering::Relaxed) {
            terminate_child_tree(&mut child, &sandbox_runtime);
            let status = child.wait().map_err(|error| error.to_string())?;
            return Ok((
                shell_result_from_parts(
                    command,
                    status.code(),
                    stdout,
                    stderr,
                    started_at,
                    false,
                    sandbox_metadata(&sandbox_runtime),
                ),
                true,
            ));
        }

        if started_at.elapsed() >= timeout {
            terminate_child_tree(&mut child, &sandbox_runtime);
            let _ = child.wait().map_err(|error| error.to_string())?;
            return Ok((
                shell_result_from_parts(
                    command,
                    None,
                    stdout,
                    stderr,
                    started_at,
                    true,
                    sandbox_metadata(&sandbox_runtime),
                ),
                false,
            ));
        }

        thread::sleep(Duration::from_millis(10));
    }
}

pub(crate) fn shell_result_from_parts(
    command: &str,
    exit_code: Option<i32>,
    stdout: Option<thread::JoinHandle<Vec<u8>>>,
    stderr: Option<thread::JoinHandle<Vec<u8>>>,
    started_at: Instant,
    timed_out: bool,
    sandbox: Option<SandboxRunMetadata>,
) -> ShellRunResult {
    ShellRunResult {
        command: command.to_string(),
        exit_code,
        stdout: String::from_utf8_lossy(&join_pipe_reader(stdout)).to_string(),
        stderr: String::from_utf8_lossy(&join_pipe_reader(stderr)).to_string(),
        duration_ms: started_at.elapsed().as_millis(),
        timed_out,
        sandbox,
    }
}

pub(crate) fn read_pipe_to_end<R: Read>(
    pipe: &mut R,
    output_emitter: Option<(ShellOutputEmitter, &'static str)>,
) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        match pipe.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                let chunk = &buffer[..count];
                bytes.extend_from_slice(chunk);
                if let Some((emitter, stream)) = &output_emitter {
                    emitter.emit(stream, chunk);
                }
            }
            Err(_) => break,
        }
    }
    bytes
}

impl ShellOutputEmitter {
    fn emit(&self, stream: &str, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }

        let _ = self.app.emit(
            "shell_run_output",
            ShellRunOutputEvent {
                run_id: self.run_id.clone(),
                stream: stream.to_string(),
                text: String::from_utf8_lossy(bytes).to_string(),
            },
        );
    }
}

pub(crate) fn join_pipe_reader(handle: Option<thread::JoinHandle<Vec<u8>>>) -> Vec<u8> {
    handle
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default()
}

#[cfg(windows)]
pub(crate) fn shell_invocation(command: &str) -> ShellInvocation {
    ShellInvocation {
        program: "cmd.exe",
        args: vec!["/C".to_string(), command.to_string()],
    }
}

#[cfg(not(windows))]
pub(crate) fn shell_invocation(command: &str) -> ShellInvocation {
    ShellInvocation {
        program: "sh",
        args: vec!["-lc".to_string(), command.to_string()],
    }
}
