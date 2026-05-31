use super::*;
use crate::automation_daemon::{
    automation_state_file, durable_task_state_file, read_json_file_or_default, write_json_file,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutomationDaemonStatus {
    pub(crate) automation_path: String,
    pub(crate) durable_task_path: String,
    pub(crate) interval_secs: u64,
    pub(crate) supported: bool,
}

#[tauri::command]
pub(crate) fn durable_task_state_load(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    read_json_file_or_default(
        &durable_task_state_file(&app)?,
        serde_json::json!({ "tasks": [] }),
    )
}

#[tauri::command]
pub(crate) fn durable_task_state_save(
    app: tauri::AppHandle,
    state: serde_json::Value,
) -> Result<(), String> {
    write_json_file(&durable_task_state_file(&app)?, &state)
}

#[tauri::command]
pub(crate) fn automation_state_load(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    read_json_file_or_default(
        &automation_state_file(&app)?,
        serde_json::json!({ "automations": [], "runs": [] }),
    )
}

#[tauri::command]
pub(crate) fn automation_state_save(
    app: tauri::AppHandle,
    state: serde_json::Value,
) -> Result<(), String> {
    write_json_file(&automation_state_file(&app)?, &state)
}

#[tauri::command]
pub(crate) fn automation_daemon_status(
    app: tauri::AppHandle,
) -> Result<AutomationDaemonStatus, String> {
    Ok(AutomationDaemonStatus {
        automation_path: automation_state_file(&app)?.display().to_string(),
        durable_task_path: durable_task_state_file(&app)?.display().to_string(),
        interval_secs: AUTOMATION_DAEMON_INTERVAL_SECS,
        supported: true,
    })
}
