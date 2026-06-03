use std::env;
use std::ffi::OsString;
#[cfg(windows)]
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x08000000;

pub(crate) fn hide_child_console_on_windows(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}

pub(crate) fn resolve_executable_for_command(program: &str) -> PathBuf {
    resolve_executable_for_command_with_path(program, env::var_os("PATH"))
}

#[cfg(not(windows))]
pub(crate) fn resolve_executable_for_command_with_path(
    program: &str,
    _path_var: Option<OsString>,
) -> PathBuf {
    PathBuf::from(program)
}

#[cfg(windows)]
pub(crate) fn resolve_executable_for_command_with_path(
    program: &str,
    path_var: Option<OsString>,
) -> PathBuf {
    let trimmed = program.trim();
    if trimmed.is_empty() {
        return PathBuf::from(program);
    }

    if looks_like_path(trimmed) {
        let path = PathBuf::from(trimmed);
        if path.extension().is_some() {
            return path;
        }
        return executable_extensions()
            .into_iter()
            .map(|extension| path.with_extension(extension.trim_start_matches('.')))
            .find(|candidate| candidate.is_file())
            .unwrap_or(path);
    }

    let candidate_names = executable_candidate_names(trimmed);
    for directory in path_var
        .as_deref()
        .map(env::split_paths)
        .into_iter()
        .flatten()
    {
        for candidate_name in &candidate_names {
            let candidate = directory.join(candidate_name);
            if candidate.is_file() {
                return candidate;
            }
        }
    }

    PathBuf::from(trimmed)
}

#[cfg(windows)]
fn looks_like_path(program: &str) -> bool {
    program.contains('/') || program.contains('\\') || program.as_bytes().get(1) == Some(&b':')
}

#[cfg(windows)]
fn executable_candidate_names(program: &str) -> Vec<String> {
    if Path::new(program).extension().is_some() {
        return vec![program.to_string()];
    }

    let mut candidates = executable_extensions()
        .into_iter()
        .map(|extension| format!("{program}{extension}"))
        .collect::<Vec<_>>();
    candidates.push(program.to_string());
    candidates
}

#[cfg(windows)]
fn executable_extensions() -> Vec<String> {
    env::var_os("PATHEXT")
        .map(|value| {
            value
                .to_string_lossy()
                .split(';')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| {
                    if value.starts_with('.') {
                        value.to_string()
                    } else {
                        format!(".{value}")
                    }
                })
                .collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| {
            vec![
                ".COM".to_string(),
                ".EXE".to_string(),
                ".BAT".to_string(),
                ".CMD".to_string(),
            ]
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(windows))]
    #[test]
    fn hide_child_console_is_noop_on_non_windows() {
        let mut command = Command::new("echo");
        command.arg("ok");

        hide_child_console_on_windows(&mut command);

        assert_eq!(command.get_program(), "echo");
        assert_eq!(
            command
                .get_args()
                .map(|arg| arg.to_string_lossy().to_string())
                .collect::<Vec<_>>(),
            vec!["ok".to_string()]
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn executable_resolution_is_noop_on_non_windows() {
        assert_eq!(
            resolve_executable_for_command("pnpm"),
            PathBuf::from("pnpm")
        );
    }

    #[cfg(windows)]
    #[test]
    fn create_no_window_constant_matches_windows_api_flag() {
        assert_eq!(CREATE_NO_WINDOW, 0x08000000);
    }

    #[cfg(windows)]
    #[test]
    fn executable_resolution_finds_cmd_shims_on_windows_path() {
        let root = std::env::temp_dir().join(format!(
            "ore-code-command-utils-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let shim = root.join("pnpm.cmd");
        std::fs::write(&shim, "@echo off\r\n").unwrap();

        let resolved =
            resolve_executable_for_command_with_path("pnpm", Some(root.into_os_string()));

        assert_eq!(resolved, shim);
    }
}
