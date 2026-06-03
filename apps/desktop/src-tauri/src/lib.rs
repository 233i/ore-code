use chrono::{Datelike, Local, SecondsFormat, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

mod artifacts;
mod automation_commands;
mod automation_daemon;
mod bootstrap;
mod command_utils;
mod config_status;
mod file_commands;
mod git_commands;
mod mcp;
mod note_commands;
mod process_commands;
mod sandbox_commands;
mod session_commands;
mod shell_commands;
mod shell_job_commands;
mod side_git;
mod skill_commands;
mod snapshots;
mod web_fetch;

pub(crate) use file_commands::display_workspace_relative_path;
pub(crate) use git_commands::run_git_command;
pub(crate) use shell_job_commands::timestamp_now;
pub(crate) use workspace_commands::canonicalize_workspace;
mod workspace_commands;
#[cfg(test)]
pub(crate) use artifacts::*;
#[cfg(test)]
pub(crate) use bootstrap::*;
#[cfg(test)]
pub(crate) use config_status::*;
#[cfg(test)]
pub(crate) use file_commands::*;
#[cfg(test)]
pub(crate) use git_commands::*;
#[cfg(test)]
pub(crate) use mcp::*;
#[cfg(test)]
pub(crate) use process_commands::*;
#[cfg(test)]
pub(crate) use sandbox_commands::*;
#[cfg(test)]
pub(crate) use session_commands::*;
#[cfg(test)]
pub(crate) use shell_commands::*;
#[cfg(test)]
pub(crate) use shell_job_commands::*;
#[cfg(test)]
pub(crate) use side_git::*;
#[cfg(test)]
pub(crate) use skill_commands::*;
#[cfg(test)]
pub(crate) use snapshots::*;
#[cfg(test)]
pub(crate) use web_fetch::*;
#[cfg(test)]
pub(crate) use workspace_commands::*;

const SECRET_SERVICE: &str = "Ore Code";
const SESSION_TITLE_LIMIT: usize = 80;
const DEFAULT_SEARCH_LIMIT: usize = 50;
const MAX_SEARCH_LIMIT: usize = 200;
const MAX_JOB_OUTPUT_CHARS: usize = 20_000;
const MCP_PROTOCOL_VERSION: &str = "2024-11-05";
const DEFAULT_MCP_TIMEOUT_SECS: u64 = 5;
const AUTOMATION_DAEMON_INTERVAL_SECS: u64 = 60;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(shell_job_commands::ShellJobStore::default())
        .manage(mcp::McpState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            bootstrap::ensure_user_environment(app.handle())?;
            automation_daemon::start_automation_daemon(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace_commands::workspace_status,
            workspace_commands::user_home_dir,
            workspace_commands::workspace_validate,
            file_commands::fs_read_text,
            file_commands::fs_list_dir,
            file_commands::fs_search_files,
            file_commands::fs_grep_files,
            file_commands::fs_write_text,
            file_commands::fs_delete_file,
            skill_commands::skill_create,
            skill_commands::skill_update,
            skill_commands::skill_rename,
            skill_commands::skill_trash,
            shell_commands::shell_run,
            process_commands::process_run,
            shell_job_commands::shell_job_start,
            shell_job_commands::shell_job_list,
            shell_job_commands::shell_job_get,
            shell_job_commands::shell_job_cancel,
            git_commands::git_status,
            git_commands::git_diff,
            git_commands::git_branch,
            git_commands::git_log,
            git_commands::git_show,
            git_commands::git_blame,
            config_status::provider_secret_status,
            config_status::provider_secret_get,
            config_status::provider_secret_set,
            config_status::provider_secret_delete,
            config_status::app_settings_read,
            config_status::app_settings_write,
            automation_commands::durable_task_state_load,
            automation_commands::durable_task_state_save,
            automation_commands::automation_state_load,
            automation_commands::automation_state_save,
            automation_commands::automation_daemon_status,
            config_status::ore_code_config_status,
            config_status::ore_code_config_env_secret_get,
            web_fetch::web_fetch_url,
            mcp::mcp_config_status,
            mcp::mcp_init_config,
            mcp::mcp_add_server,
            mcp::mcp_update_server,
            mcp::mcp_set_server_enabled,
            mcp::mcp_remove_server,
            mcp::mcp_validate_config,
            mcp::mcp_reload,
            mcp::mcp_reload_server,
            mcp::mcp_list_tools,
            mcp::mcp_call_tool,
            mcp::mcp_read_resource,
            mcp::mcp_get_prompt,
            mcp::mcp_stop_all,
            note_commands::note_list,
            note_commands::note_add,
            note_commands::note_delete,
            session_commands::session_save_events,
            session_commands::session_list_threads,
            session_commands::session_load_thread,
            session_commands::session_load_transcript_chunk,
            session_commands::session_load_transcript_tail,
            session_commands::session_rename_thread,
            session_commands::session_delete_thread,
            artifacts::artifact_write,
            artifacts::artifact_list,
            artifacts::artifact_read,
            snapshots::snapshot_save,
            snapshots::snapshot_load,
            snapshots::side_snapshot_create,
            snapshots::side_snapshot_restore
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ore Code");
}

#[cfg(test)]
mod tests;
