use super::*;
use crate::command_utils::hide_child_console_on_windows;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SandboxEnvironmentMode {
    Minimal,
    InheritSafe,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SandboxPolicy {
    #[serde(default = "default_sandbox_enabled")]
    pub(crate) enabled: bool,
    #[serde(default = "default_env_mode")]
    pub(crate) env_mode: SandboxEnvironmentMode,
    #[serde(default)]
    pub(crate) allow_network: bool,
    #[serde(default)]
    pub(crate) allow_read_outside_workspace: bool,
    #[serde(default)]
    pub(crate) allow_write_workspace: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SandboxRunMetadata {
    pub(crate) enabled: bool,
    pub(crate) env_mode: SandboxEnvironmentMode,
    pub(crate) sensitive_env_filtered: usize,
    pub(crate) process_tree_kill: bool,
}

pub(crate) struct SandboxRuntime {
    metadata: SandboxRunMetadata,
    #[cfg(windows)]
    job: Option<WindowsJob>,
}

pub(crate) fn prepare_child_command(
    command: &mut Command,
    policy: Option<&SandboxPolicy>,
) -> SandboxRuntime {
    hide_child_console_on_windows(command);

    let policy = policy.cloned().unwrap_or_else(SandboxPolicy::disabled);
    let mut sensitive_env_filtered = 0;
    if policy.enabled {
        sensitive_env_filtered = apply_sandbox_environment(command, policy.env_mode);
        enable_process_tree_control(command);
    }

    #[cfg(windows)]
    let job = policy.enabled.then(WindowsJob::new).flatten();
    #[cfg(windows)]
    let process_tree_kill = job.is_some();
    #[cfg(not(windows))]
    let process_tree_kill = policy.enabled;

    SandboxRuntime {
        metadata: SandboxRunMetadata {
            enabled: policy.enabled,
            env_mode: policy.env_mode,
            sensitive_env_filtered,
            process_tree_kill,
        },
        #[cfg(windows)]
        job,
    }
}

pub(crate) fn bind_child_to_runtime(runtime: &SandboxRuntime, child: &Child) {
    #[cfg(windows)]
    if let Some(job) = &runtime.job {
        job.assign(child);
    }

    #[cfg(not(windows))]
    {
        let _ = runtime;
        let _ = child;
    }
}

pub(crate) fn terminate_child_tree(child: &mut Child, runtime: &SandboxRuntime) {
    #[cfg(windows)]
    if let Some(job) = &runtime.job {
        job.terminate();
    }

    #[cfg(unix)]
    if runtime.metadata.process_tree_kill {
        terminate_unix_process_group(child.id());
    }

    let _ = child.kill();
}

pub(crate) fn sandbox_metadata(runtime: &SandboxRuntime) -> Option<SandboxRunMetadata> {
    runtime.metadata.enabled.then(|| runtime.metadata.clone())
}

pub(crate) fn is_sensitive_env_key(key: &str) -> bool {
    let normalized = key.to_ascii_uppercase();
    normalized == "SSH_AUTH_SOCK"
        || normalized == "GITHUB_TOKEN"
        || normalized == "OPENAI_API_KEY"
        || normalized == "DEEPSEEK_API_KEY"
        || normalized.ends_with("_KEY")
        || normalized.ends_with("_TOKEN")
        || normalized.ends_with("_SECRET")
        || normalized.contains("PASSWORD")
        || normalized.contains("PRIVATE_KEY")
}

pub(crate) fn should_keep_env_key(key: &str, mode: SandboxEnvironmentMode) -> bool {
    if is_sensitive_env_key(key) {
        return false;
    }

    match mode {
        SandboxEnvironmentMode::InheritSafe => true,
        SandboxEnvironmentMode::Minimal => is_minimal_env_key(key),
    }
}

impl SandboxPolicy {
    pub(crate) fn disabled() -> Self {
        Self {
            enabled: false,
            env_mode: default_env_mode(),
            allow_network: true,
            allow_read_outside_workspace: true,
            allow_write_workspace: true,
        }
    }
}

fn apply_sandbox_environment(command: &mut Command, mode: SandboxEnvironmentMode) -> usize {
    let mut filtered = 0;
    command.env_clear();
    for (key, value) in env::vars_os() {
        let key_text = key.to_string_lossy();
        if should_keep_env_key(&key_text, mode) {
            command.env(key, value);
        } else if is_sensitive_env_key(&key_text) {
            filtered += 1;
        }
    }
    filtered
}

fn default_sandbox_enabled() -> bool {
    true
}

fn default_env_mode() -> SandboxEnvironmentMode {
    SandboxEnvironmentMode::InheritSafe
}

fn is_minimal_env_key(key: &str) -> bool {
    matches!(
        key.to_ascii_uppercase().as_str(),
        "PATH"
            | "PATHEXT"
            | "SYSTEMROOT"
            | "WINDIR"
            | "COMSPEC"
            | "HOME"
            | "USERPROFILE"
            | "HOMEDRIVE"
            | "HOMEPATH"
            | "TEMP"
            | "TMP"
            | "TMPDIR"
            | "LANG"
            | "LC_ALL"
            | "LC_CTYPE"
    )
}

#[cfg(unix)]
fn enable_process_tree_control(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn enable_process_tree_control(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_unix_process_group(pid: u32) {
    const SIGTERM: i32 = 15;
    const SIGKILL: i32 = 9;
    let group_id = -(pid as i32);
    unsafe {
        let _ = kill(group_id, SIGTERM);
    }
    thread::sleep(Duration::from_millis(50));
    unsafe {
        let _ = kill(group_id, SIGKILL);
    }
}

#[cfg(unix)]
unsafe extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}

#[cfg(windows)]
struct WindowsJob {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
impl WindowsJob {
    fn new() -> Option<Self> {
        use windows_sys::Win32::System::JobObjects::{
            CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
        };

        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return None;
        }

        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if ok == 0 {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(handle);
            }
            return None;
        }

        Some(Self { handle })
    }

    fn assign(&self, child: &Child) {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;

        let process_handle = child.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE;
        unsafe {
            let _ = AssignProcessToJobObject(self.handle, process_handle);
        }
    }

    fn terminate(&self) {
        unsafe {
            let _ = windows_sys::Win32::System::JobObjects::TerminateJobObject(self.handle, 1);
        }
    }
}

#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.handle);
        }
    }
}
