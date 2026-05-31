use super::*;

const DEFAULT_DEEPSEEK_CONFIG: &str = r#"provider = "deepseek"

[providers.deepseek]
model = "deepseek-v4-pro"
base_url = "https://api.deepseek.com/beta"
api_key_env = "DEEPSEEK_API_KEY"
"#;

const DEFAULT_MCP_CONFIG: &str = "{\n  \"servers\": {}\n}\n";

const DEFAULT_SEEKFORGE_INSTRUCTIONS: &str = r#"# SeekForge User Instructions

Add personal, cross-project SeekForge preferences here. These instructions are loaded into each model turn after built-in safety/workflow rules and after the latest user message.

Examples:
- Prefer concise Chinese summaries.
- Always mention which tests were run.
- Do not modify generated files unless explicitly requested.
"#;

pub(crate) fn ensure_user_environment(app: &tauri::AppHandle) -> Result<(), String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    ensure_user_environment_paths(&home, &app_data)
}

pub(crate) fn ensure_user_environment_paths(home: &Path, app_data: &Path) -> Result<(), String> {
    let deepseek_dir = home.join(".deepseek");
    let seekforge_dir = home.join(".seekforge");

    fs::create_dir_all(&deepseek_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(seekforge_dir.join("skills")).map_err(|error| error.to_string())?;

    write_default_file_if_missing(&deepseek_dir.join("config.toml"), DEFAULT_DEEPSEEK_CONFIG)?;
    write_default_file_if_missing(&seekforge_dir.join("mcp.json"), DEFAULT_MCP_CONFIG)?;
    write_default_file_if_missing(
        &seekforge_dir.join("instructions.md"),
        DEFAULT_SEEKFORGE_INSTRUCTIONS,
    )?;

    for dir in [
        app_data.to_path_buf(),
        app_data.join("artifacts"),
        app_data.join("sessions"),
        app_data.join("snapshots"),
        app_data.join("side-snapshots"),
        app_data.join("side-git"),
        app_data.join("memory"),
    ] {
        fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn write_default_file_if_missing(path: &Path, content: &str) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, content).map_err(|error| error.to_string())
}
