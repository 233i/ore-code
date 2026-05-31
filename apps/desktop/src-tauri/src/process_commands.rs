use super::*;
use crate::command_utils::resolve_executable_for_command;
use crate::sandbox_commands::{
    SandboxPolicy, SandboxRunMetadata, bind_child_to_runtime, prepare_child_command,
    sandbox_metadata, terminate_child_tree,
};
use crate::shell_commands::{join_pipe_reader, read_pipe_to_end};
use crate::workspace_commands::canonicalize_workspace;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessRunInput {
    pub(crate) workspace_path: String,
    pub(crate) program: String,
    #[serde(default)]
    pub(crate) args: Vec<String>,
    pub(crate) stdin: Option<String>,
    pub(crate) sandbox_policy: Option<SandboxPolicy>,
    pub(crate) timeout_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessRunResult {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) command: String,
    pub(crate) exit_code: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) duration_ms: u128,
    pub(crate) timed_out: bool,
    pub(crate) sandbox: Option<SandboxRunMetadata>,
}

#[tauri::command]
pub(crate) async fn process_run(input: ProcessRunInput) -> Result<ProcessRunResult, String> {
    let workspace = canonicalize_workspace(&input.workspace_path)?;
    if !workspace.is_dir() {
        return Err("workspace path must be a directory".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || run_process(&workspace, input))
        .await
        .map_err(|error| error.to_string())?
}

pub(crate) fn run_process(
    workspace: &Path,
    input: ProcessRunInput,
) -> Result<ProcessRunResult, String> {
    let program = input.program.trim().to_string();
    if program.is_empty() {
        return Err("process program must not be empty".to_string());
    }

    let started_at = Instant::now();
    let timeout = Duration::from_millis(input.timeout_ms);
    let resolved_program = resolve_executable_for_command(&program);
    let mut command_process = Command::new(&resolved_program);
    command_process
        .args(&input.args)
        .current_dir(workspace)
        .stdin(if input.stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let sandbox_runtime =
        prepare_child_command(&mut command_process, input.sandbox_policy.as_ref());
    let mut child = command_process.spawn().map_err(|error| error.to_string())?;
    bind_child_to_runtime(&sandbox_runtime, &child);

    if let Some(stdin_text) = input.stdin {
        if let Some(mut stdin) = child.stdin.take() {
            thread::spawn(move || {
                let _ = stdin.write_all(stdin_text.as_bytes());
            });
        }
    }

    let stdout = child
        .stdout
        .take()
        .map(|mut pipe| thread::spawn(move || read_pipe_to_end(&mut pipe, None)));
    let stderr = child
        .stderr
        .take()
        .map(|mut pipe| thread::spawn(move || read_pipe_to_end(&mut pipe, None)));

    loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Ok(process_result_from_parts(
                program,
                input.args,
                status.code(),
                stdout,
                stderr,
                started_at,
                false,
                sandbox_metadata(&sandbox_runtime),
            ));
        }

        if started_at.elapsed() >= timeout {
            terminate_child_tree(&mut child, &sandbox_runtime);
            let _ = child.wait().map_err(|error| error.to_string())?;
            return Ok(process_result_from_parts(
                program,
                input.args,
                None,
                stdout,
                stderr,
                started_at,
                true,
                sandbox_metadata(&sandbox_runtime),
            ));
        }

        thread::sleep(Duration::from_millis(10));
    }
}

fn process_result_from_parts(
    program: String,
    args: Vec<String>,
    exit_code: Option<i32>,
    stdout: Option<thread::JoinHandle<Vec<u8>>>,
    stderr: Option<thread::JoinHandle<Vec<u8>>>,
    started_at: Instant,
    timed_out: bool,
    sandbox: Option<SandboxRunMetadata>,
) -> ProcessRunResult {
    ProcessRunResult {
        command: process_command_string(&program, &args),
        program,
        args,
        exit_code,
        stdout: String::from_utf8_lossy(&join_pipe_reader(stdout)).to_string(),
        stderr: String::from_utf8_lossy(&join_pipe_reader(stderr)).to_string(),
        duration_ms: started_at.elapsed().as_millis(),
        timed_out,
        sandbox,
    }
}

fn process_command_string(program: &str, args: &[String]) -> String {
    std::iter::once(program)
        .chain(args.iter().map(String::as_str))
        .map(format_process_arg)
        .collect::<Vec<_>>()
        .join(" ")
}

fn format_process_arg(value: &str) -> String {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || "_./:=@+-".contains(ch))
    {
        value.to_string()
    } else {
        serde_json::to_string(value).unwrap_or_else(|_| value.to_string())
    }
}
