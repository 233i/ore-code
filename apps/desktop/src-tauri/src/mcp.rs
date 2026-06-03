use super::*;
use crate::command_utils::{hide_child_console_on_windows, resolve_executable_for_command};

#[derive(Default)]
pub(crate) struct McpState {
    pub(crate) manager: Mutex<McpManager>,
}

#[derive(Default)]
pub(crate) struct McpManager {
    pub(crate) generation: u64,
    pub(crate) snapshot: Option<McpToolSnapshot>,
    pub(crate) servers: HashMap<String, McpRuntimeServer>,
    pub(crate) tool_map: HashMap<String, (String, String)>,
}

pub(crate) enum McpRuntimeServer {
    Http {
        connect_timeout_secs: u64,
        timeout_secs: u64,
        url: String,
    },
    Stdio {
        child: Child,
        framing: McpStdioFraming,
        stdin: ChildStdin,
        next_id: u64,
        stdout_rx: std::sync::mpsc::Receiver<Result<serde_json::Value, String>>,
        timeout_secs: u64,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum McpStdioFraming {
    Header,
    JsonLine,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpToolSnapshot {
    pub(crate) config_path: String,
    pub(crate) configured: bool,
    pub(crate) error: Option<String>,
    pub(crate) prompts: Vec<McpPromptDescriptor>,
    pub(crate) resources: Vec<McpResourceDescriptor>,
    pub(crate) servers: Vec<McpServerSnapshot>,
    pub(crate) supported: bool,
    pub(crate) tools: Vec<McpToolDescriptor>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpServerSnapshot {
    pub(crate) args: Vec<String>,
    pub(crate) command: Option<String>,
    pub(crate) connect_timeout_secs: u64,
    pub(crate) disabled_tools: Vec<String>,
    pub(crate) error: Option<String>,
    pub(crate) execute_timeout_secs: u64,
    pub(crate) enabled_tools: Vec<String>,
    pub(crate) env: HashMap<String, String>,
    pub(crate) framing: Option<String>,
    pub(crate) name: String,
    pub(crate) prompt_count: usize,
    pub(crate) prompts: Vec<McpPromptDescriptor>,
    pub(crate) resource_count: usize,
    pub(crate) resources: Vec<McpResourceDescriptor>,
    pub(crate) status: String,
    pub(crate) tool_count: usize,
    pub(crate) tools: Vec<McpToolDescriptor>,
    pub(crate) transport: String,
    pub(crate) url: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpToolDescriptor {
    pub(crate) annotations: Option<serde_json::Value>,
    pub(crate) description: String,
    pub(crate) input_schema: serde_json::Value,
    pub(crate) name: String,
    pub(crate) qualified_name: String,
    pub(crate) server_name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpResourceDescriptor {
    pub(crate) description: String,
    pub(crate) mime_type: Option<String>,
    pub(crate) name: String,
    pub(crate) server_name: String,
    pub(crate) uri: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpPromptDescriptor {
    pub(crate) description: String,
    pub(crate) name: String,
    pub(crate) server_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpCallOutput {
    pub(crate) content: serde_json::Value,
    pub(crate) is_error: bool,
    pub(crate) server: String,
    pub(crate) tool: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpResourceReadOutput {
    pub(crate) content: serde_json::Value,
    pub(crate) mime_type: Option<String>,
    pub(crate) server: String,
    pub(crate) text: String,
    pub(crate) uri: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpPromptGetOutput {
    pub(crate) content: serde_json::Value,
    pub(crate) description: Option<String>,
    pub(crate) prompt: String,
    pub(crate) server: String,
    pub(crate) name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpAddServerInput {
    pub(crate) args: Option<Vec<String>>,
    pub(crate) command: Option<String>,
    pub(crate) connect_timeout: Option<u64>,
    pub(crate) disabled: Option<bool>,
    pub(crate) disabled_tools: Option<Vec<String>>,
    pub(crate) enabled_tools: Option<Vec<String>>,
    pub(crate) env: Option<HashMap<String, String>>,
    pub(crate) execute_timeout: Option<u64>,
    pub(crate) framing: Option<String>,
    pub(crate) name: String,
    pub(crate) url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpValidateResult {
    pub(crate) config_path: String,
    pub(crate) errors: Vec<String>,
    pub(crate) ok: bool,
    pub(crate) servers: Vec<McpServerConfigSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpServerConfigSummary {
    pub(crate) disabled: bool,
    pub(crate) name: String,
    pub(crate) transport: String,
}

#[derive(Clone)]
pub(crate) struct McpServerConfig {
    pub(crate) args: Vec<String>,
    pub(crate) command: Option<String>,
    pub(crate) connect_timeout_secs: u64,
    pub(crate) disabled: bool,
    pub(crate) disabled_tools: Vec<String>,
    pub(crate) enabled_tools: Vec<String>,
    pub(crate) env: HashMap<String, String>,
    pub(crate) execute_timeout_secs: u64,
    pub(crate) framing: Option<McpStdioFraming>,
    pub(crate) name: String,
    pub(crate) transport: String,
    pub(crate) url: Option<String>,
}

#[derive(Clone)]
pub(crate) struct McpDiscovery {
    pub(crate) prompts: Vec<McpPromptDescriptor>,
    pub(crate) resources: Vec<McpResourceDescriptor>,
    pub(crate) tools: Vec<McpToolDescriptor>,
}

#[tauri::command]
pub(crate) fn mcp_config_status(app: tauri::AppHandle) -> Result<McpToolSnapshot, String> {
    Ok(read_mcp_config_snapshot(&app))
}

fn reset_mcp_runtime(state: &tauri::State<McpState>) -> Result<(), String> {
    let mut manager = state.manager.lock().map_err(|error| error.to_string())?;
    manager.stop_all();
    manager.snapshot = None;
    manager.tool_map.clear();
    Ok(())
}

pub(crate) fn read_mcp_config_snapshot(app: &tauri::AppHandle) -> McpToolSnapshot {
    let path = match mcp_config_file(app) {
        Ok(path) => path,
        Err(error) => {
            return mcp_empty_config_snapshot(
                "~/.ore-code/mcp.json".to_string(),
                false,
                Some(error),
            );
        }
    };
    let config_path = path.display().to_string();
    if !path.exists() {
        return mcp_empty_config_snapshot(config_path, false, None);
    }

    match fs::read_to_string(&path)
        .map_err(|error| error.to_string())
        .and_then(|raw| {
            serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| error.to_string())
        })
        .and_then(|value| parse_mcp_config(&value))
    {
        Ok(servers) => mcp_snapshot_from_server_configs(config_path, servers),
        Err(error) => mcp_empty_config_snapshot(config_path, true, Some(error)),
    }
}

fn read_mcp_server_configs(app: &tauri::AppHandle) -> Result<Vec<McpServerConfig>, String> {
    let path = mcp_config_file(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    fs::read_to_string(&path)
        .map_err(|error| error.to_string())
        .and_then(|raw| {
            serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| error.to_string())
        })
        .and_then(|value| parse_mcp_config(&value))
}

pub(crate) fn mcp_empty_config_snapshot(
    config_path: String,
    configured: bool,
    error: Option<String>,
) -> McpToolSnapshot {
    McpToolSnapshot {
        config_path,
        configured,
        error,
        prompts: Vec::new(),
        resources: Vec::new(),
        servers: Vec::new(),
        supported: true,
        tools: Vec::new(),
    }
}

pub(crate) fn mcp_snapshot_from_server_configs(
    config_path: String,
    servers: Vec<McpServerConfig>,
) -> McpToolSnapshot {
    McpToolSnapshot {
        config_path,
        configured: true,
        error: None,
        prompts: Vec::new(),
        resources: Vec::new(),
        servers: servers
            .into_iter()
            .map(|server| {
                let status = if server.disabled {
                    "disabled"
                } else {
                    "missing"
                };
                mcp_server_snapshot_from_config(
                    &server,
                    status,
                    None,
                    Vec::new(),
                    Vec::new(),
                    Vec::new(),
                )
            })
            .collect(),
        supported: true,
        tools: Vec::new(),
    }
}

pub(crate) fn mcp_server_document_from_input(
    input: &McpAddServerInput,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let command = input
        .command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let url = input
        .url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if command.is_none() && url.is_none() {
        return Err("MCP server requires command or url".to_string());
    }

    let mut server = serde_json::Map::new();
    if let Some(command) = command {
        server.insert(
            "command".to_string(),
            serde_json::Value::String(command.to_string()),
        );
    }
    if let Some(url) = url {
        server.insert(
            "url".to_string(),
            serde_json::Value::String(url.to_string()),
        );
    }
    if let Some(args) = input.args.as_ref().filter(|items| !items.is_empty()) {
        server.insert("args".to_string(), serde_json::json!(args));
    }
    if let Some(env) = input.env.as_ref().filter(|items| !items.is_empty()) {
        server.insert("env".to_string(), serde_json::json!(env));
    }
    if let Some(framing) = input
        .framing
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        server.insert(
            "framing".to_string(),
            serde_json::Value::String(framing.to_string()),
        );
    }
    if let Some(timeout) = input.connect_timeout {
        server.insert(
            "connect_timeout".to_string(),
            serde_json::Value::Number(serde_json::Number::from(timeout)),
        );
    }
    if let Some(timeout) = input.execute_timeout {
        server.insert(
            "execute_timeout".to_string(),
            serde_json::Value::Number(serde_json::Number::from(timeout)),
        );
    }
    if let Some(tools) = input
        .enabled_tools
        .as_ref()
        .filter(|items| !items.is_empty())
    {
        server.insert("enabled_tools".to_string(), serde_json::json!(tools));
    }
    if let Some(tools) = input
        .disabled_tools
        .as_ref()
        .filter(|items| !items.is_empty())
    {
        server.insert("disabled_tools".to_string(), serde_json::json!(tools));
    }
    if input.disabled.unwrap_or(false) {
        server.insert("disabled".to_string(), serde_json::Value::Bool(true));
    }
    Ok(server)
}

#[tauri::command]
pub(crate) fn mcp_init_config(
    app: tauri::AppHandle,
    state: tauri::State<McpState>,
) -> Result<McpToolSnapshot, String> {
    let path = mcp_config_file(&app)?;
    if !path.exists() {
        write_mcp_config_document(&path, &serde_json::json!({ "servers": {} }))?;
    }
    reset_mcp_runtime(&state)?;
    mcp_config_status(app)
}

#[tauri::command]
pub(crate) fn mcp_add_server(
    app: tauri::AppHandle,
    input: McpAddServerInput,
    state: tauri::State<McpState>,
) -> Result<McpToolSnapshot, String> {
    let path = mcp_config_file(&app)?;
    let mut document = read_mcp_config_document(&path)?;
    let root = document
        .as_object_mut()
        .ok_or_else(|| "MCP config must be a JSON object".to_string())?;
    let server_key = if root.contains_key("servers") {
        "servers"
    } else if root.contains_key("mcpServers") {
        "mcpServers"
    } else {
        root.insert("servers".to_string(), serde_json::json!({}));
        "servers"
    };
    let servers = root
        .get_mut(server_key)
        .and_then(|value| value.as_object_mut())
        .ok_or_else(|| "MCP config servers must be an object".to_string())?;
    let name = validate_mcp_server_name(&input.name)?;
    let server = mcp_server_document_from_input(&input)?;
    servers.insert(name, serde_json::Value::Object(server));
    write_mcp_config_document(&path, &document)?;
    reset_mcp_runtime(&state)?;
    mcp_config_status(app)
}

#[tauri::command]
pub(crate) fn mcp_update_server(
    app: tauri::AppHandle,
    input: McpAddServerInput,
    state: tauri::State<McpState>,
) -> Result<McpToolSnapshot, String> {
    let path = mcp_config_file(&app)?;
    let mut document = read_mcp_config_document(&path)?;
    let name = validate_mcp_server_name(&input.name)?;
    let servers = mcp_servers_object_mut(&mut document)?;
    if !servers.contains_key(&name) {
        return Err(format!("MCP server does not exist: {name}"));
    }
    let server = mcp_server_document_from_input(&input)?;
    servers.insert(name, serde_json::Value::Object(server));
    write_mcp_config_document(&path, &document)?;
    reset_mcp_runtime(&state)?;
    mcp_config_status(app)
}

#[tauri::command]
pub(crate) fn mcp_set_server_enabled(
    app: tauri::AppHandle,
    enabled: bool,
    name: String,
    state: tauri::State<McpState>,
) -> Result<McpToolSnapshot, String> {
    let path = mcp_config_file(&app)?;
    let mut document = read_mcp_config_document(&path)?;
    let server = mcp_server_object_mut(&mut document, &name)?;
    server.insert("disabled".to_string(), serde_json::Value::Bool(!enabled));
    write_mcp_config_document(&path, &document)?;
    reset_mcp_runtime(&state)?;
    mcp_config_status(app)
}

#[tauri::command]
pub(crate) fn mcp_remove_server(
    app: tauri::AppHandle,
    name: String,
    state: tauri::State<McpState>,
) -> Result<McpToolSnapshot, String> {
    let path = mcp_config_file(&app)?;
    let mut document = read_mcp_config_document(&path)?;
    let normalized = validate_mcp_server_name(&name)?;
    let servers = mcp_servers_object_mut(&mut document)?;
    servers
        .remove(&normalized)
        .ok_or_else(|| format!("MCP server does not exist: {normalized}"))?;
    write_mcp_config_document(&path, &document)?;
    reset_mcp_runtime(&state)?;
    mcp_config_status(app)
}

#[tauri::command]
pub(crate) fn mcp_validate_config(app: tauri::AppHandle) -> Result<McpValidateResult, String> {
    let path = mcp_config_file(&app)?;
    if !path.exists() {
        return Ok(McpValidateResult {
            config_path: path.display().to_string(),
            errors: Vec::new(),
            ok: true,
            servers: Vec::new(),
        });
    }
    let value = fs::read_to_string(&path)
        .map_err(|error| error.to_string())
        .and_then(|raw| {
            serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| error.to_string())
        });
    match value.and_then(|value| parse_mcp_config(&value)) {
        Ok(servers) => Ok(McpValidateResult {
            config_path: path.display().to_string(),
            errors: Vec::new(),
            ok: true,
            servers: servers
                .into_iter()
                .map(|server| McpServerConfigSummary {
                    disabled: server.disabled,
                    name: server.name,
                    transport: server.transport,
                })
                .collect(),
        }),
        Err(error) => Ok(McpValidateResult {
            config_path: path.display().to_string(),
            errors: vec![error],
            ok: false,
            servers: Vec::new(),
        }),
    }
}

#[tauri::command]
pub(crate) async fn mcp_reload_server(
    app: tauri::AppHandle,
    name: String,
    state: tauri::State<'_, McpState>,
) -> Result<McpToolSnapshot, String> {
    let normalized = validate_mcp_server_name(&name)?;
    let config_snapshot = read_mcp_config_snapshot(&app);
    if !config_snapshot.configured || config_snapshot.error.is_some() {
        return Ok(config_snapshot);
    }
    let configs = read_mcp_server_configs(&app)?;
    let server_config = configs
        .iter()
        .find(|server| server.name == normalized)
        .cloned()
        .ok_or_else(|| format!("MCP server does not exist: {normalized}"))?;
    let generation = {
        let mut manager = state.manager.lock().map_err(|error| error.to_string())?;
        manager.stop_server(&normalized);
        if manager.snapshot.is_none() {
            manager.snapshot = Some(config_snapshot.clone());
        }
        if !server_config.disabled {
            if let Some(snapshot) = manager.snapshot.as_mut() {
                replace_mcp_server_snapshot(
                    snapshot,
                    mcp_server_snapshot_from_config(
                        &server_config,
                        "connecting",
                        None,
                        Vec::new(),
                        Vec::new(),
                        Vec::new(),
                    ),
                );
            }
        }
        manager.generation
    };

    let mut runtime_to_insert = None;
    let server_snapshot = if server_config.disabled {
        mcp_server_snapshot_from_config(
            &server_config,
            "disabled",
            None,
            Vec::new(),
            Vec::new(),
            Vec::new(),
        )
    } else {
        let connect_config = server_config.clone();
        match tauri::async_runtime::spawn_blocking(move || connect_mcp_server(&connect_config))
            .await
            .map_err(|error| error.to_string())?
        {
            Ok((runtime, discovery)) => {
                let filtered_tools = filter_mcp_tools(&server_config, discovery.tools);
                let server_snapshot = mcp_server_snapshot_from_config(
                    &server_config,
                    "connected",
                    None,
                    discovery.prompts,
                    discovery.resources,
                    filtered_tools.clone(),
                );
                runtime_to_insert = Some((runtime, filtered_tools));
                server_snapshot
            }
            Err(error) => mcp_server_snapshot_from_config(
                &server_config,
                "failed",
                Some(error),
                Vec::new(),
                Vec::new(),
                Vec::new(),
            ),
        }
    };

    let mut manager = state.manager.lock().map_err(|error| error.to_string())?;
    if manager.generation != generation {
        if let Some((mut runtime, _)) = runtime_to_insert {
            shutdown_mcp_runtime(&mut runtime);
        }
        return Ok(manager
            .snapshot
            .clone()
            .unwrap_or_else(|| read_mcp_config_snapshot(&app)));
    }

    manager.stop_server(&normalized);
    if let Some((runtime, tools)) = runtime_to_insert {
        for tool in &tools {
            manager.tool_map.insert(
                tool.qualified_name.clone(),
                (tool.server_name.clone(), tool.name.clone()),
            );
        }
        manager.servers.insert(normalized.clone(), runtime);
    }
    let snapshot = manager
        .snapshot
        .get_or_insert_with(|| config_snapshot.clone());
    replace_mcp_server_snapshot(snapshot, server_snapshot);
    Ok(snapshot.clone())
}

#[tauri::command]
pub(crate) fn mcp_reload(
    app: tauri::AppHandle,
    state: tauri::State<McpState>,
) -> Result<McpToolSnapshot, String> {
    let mut manager = state.manager.lock().map_err(|error| error.to_string())?;
    manager.stop_all();
    let snapshot = load_mcp_snapshot(&app, &mut manager);
    manager.snapshot = Some(snapshot.clone());
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn mcp_list_tools(
    app: tauri::AppHandle,
    state: tauri::State<McpState>,
) -> Result<McpToolSnapshot, String> {
    let mut manager = state.manager.lock().map_err(|error| error.to_string())?;
    refresh_mcp_runtime_health(&mut manager);
    if let Some(snapshot) = &manager.snapshot {
        return Ok(snapshot.clone());
    }

    let snapshot = load_mcp_snapshot(&app, &mut manager);
    manager.snapshot = Some(snapshot.clone());
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn mcp_call_tool(
    arguments: serde_json::Value,
    qualified_name: String,
    state: tauri::State<McpState>,
) -> Result<McpCallOutput, String> {
    let mut manager = state.manager.lock().map_err(|error| error.to_string())?;
    let (server_name, tool_name) = manager
        .tool_map
        .get(&qualified_name)
        .cloned()
        .ok_or_else(|| format!("MCP tool is not connected: {qualified_name}"))?;
    let params = serde_json::json!({
        "name": tool_name,
        "arguments": arguments
    });
    let response = mcp_json_rpc_for_server(&mut manager, &server_name, "tools/call", params)?;
    let result = response
        .get("result")
        .cloned()
        .unwrap_or_else(|| response.clone());
    let is_error = result
        .get("isError")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    Ok(McpCallOutput {
        content: result,
        is_error,
        server: server_name,
        tool: tool_name,
    })
}

#[tauri::command]
pub(crate) fn mcp_read_resource(
    server_name: String,
    uri: String,
    state: tauri::State<McpState>,
) -> Result<McpResourceReadOutput, String> {
    let mut manager = state.manager.lock().map_err(|error| error.to_string())?;
    let normalized_server = sanitize_mcp_name(&server_name);
    let response = mcp_json_rpc_for_server(
        &mut manager,
        &normalized_server,
        "resources/read",
        serde_json::json!({ "uri": uri }),
    )?;
    let result = response
        .get("result")
        .cloned()
        .unwrap_or_else(|| response.clone());
    let contents = result
        .get("contents")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let text = mcp_contents_text(&contents);
    let mime_type = contents
        .iter()
        .find_map(|item| {
            item.get("mimeType")
                .or_else(|| item.get("mime_type"))
                .and_then(|value| value.as_str())
        })
        .map(ToString::to_string);

    Ok(McpResourceReadOutput {
        content: result,
        mime_type,
        server: normalized_server,
        text,
        uri,
    })
}

#[tauri::command]
pub(crate) fn mcp_get_prompt(
    arguments: serde_json::Value,
    name: String,
    server_name: String,
    state: tauri::State<McpState>,
) -> Result<McpPromptGetOutput, String> {
    let mut manager = state.manager.lock().map_err(|error| error.to_string())?;
    let normalized_server = sanitize_mcp_name(&server_name);
    let response = mcp_json_rpc_for_server(
        &mut manager,
        &normalized_server,
        "prompts/get",
        serde_json::json!({
            "name": name,
            "arguments": arguments
        }),
    )?;
    let result = response
        .get("result")
        .cloned()
        .unwrap_or_else(|| response.clone());
    let prompt = mcp_prompt_text(&result);
    let description = result
        .get("description")
        .and_then(|value| value.as_str())
        .map(ToString::to_string);

    Ok(McpPromptGetOutput {
        content: result,
        description,
        prompt,
        server: normalized_server,
        name,
    })
}

pub(crate) fn refresh_mcp_runtime_health(manager: &mut McpManager) -> bool {
    let failed_servers = manager
        .servers
        .iter_mut()
        .filter_map(|(name, server)| {
            mcp_runtime_health_error(server).map(|error| (name.clone(), error))
        })
        .collect::<Vec<_>>();
    let changed = !failed_servers.is_empty();

    for (name, error) in failed_servers {
        mark_mcp_server_failed(manager, &name, error);
    }

    changed
}

pub(crate) fn mark_mcp_server_failed(manager: &mut McpManager, server_name: &str, error: String) {
    if let Some(mut server) = manager.servers.remove(server_name) {
        shutdown_mcp_runtime(&mut server);
    }
    manager
        .tool_map
        .retain(|_, (mapped_server, _)| mapped_server != server_name);

    if let Some(snapshot) = manager.snapshot.as_mut() {
        mark_mcp_snapshot_server_failed(snapshot, server_name, error);
    }
}

pub(crate) fn mark_mcp_snapshot_server_failed(
    snapshot: &mut McpToolSnapshot,
    server_name: &str,
    error: String,
) -> bool {
    let Some(server) = snapshot
        .servers
        .iter_mut()
        .find(|server| server.name == server_name)
    else {
        return false;
    };

    server.status = "failed".to_string();
    server.error = Some(error);
    server.prompt_count = 0;
    server.prompts.clear();
    server.resource_count = 0;
    server.resources.clear();
    server.tool_count = 0;
    server.tools.clear();
    rebuild_mcp_snapshot_collections(snapshot);
    true
}

pub(crate) fn mcp_json_rpc_for_server(
    manager: &mut McpManager,
    server_name: &str,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let result = match manager.servers.get_mut(server_name) {
        Some(server) => mcp_json_rpc(server, method, params),
        None => Err(format!("MCP server is not connected: {server_name}")),
    };

    match result {
        Ok(response) => Ok(response),
        Err(error) => {
            mark_mcp_server_failed(manager, server_name, error.clone());
            Err(error)
        }
    }
}

fn mcp_runtime_health_error(server: &mut McpRuntimeServer) -> Option<String> {
    let McpRuntimeServer::Stdio { child, .. } = server else {
        return None;
    };

    match child.try_wait() {
        Ok(Some(status)) => Some(format!("MCP server process exited: {status}")),
        Ok(None) => None,
        Err(error) => Some(format!("failed to check MCP server process: {error}")),
    }
}

#[tauri::command]
pub(crate) fn mcp_stop_all(state: tauri::State<McpState>) -> Result<(), String> {
    let mut manager = state.manager.lock().map_err(|error| error.to_string())?;
    manager.stop_all();
    Ok(())
}

impl McpManager {
    fn stop_all(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        for (_name, server) in self.servers.drain() {
            if let McpRuntimeServer::Stdio { mut child, .. } = server {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        self.tool_map.clear();
        self.snapshot = None;
    }

    fn stop_server(&mut self, name: &str) {
        if let Some(server) = self.servers.remove(name) {
            if let McpRuntimeServer::Stdio { mut child, .. } = server {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        self.tool_map
            .retain(|_, (server_name, _)| server_name != name);
    }
}

pub(crate) fn mcp_config_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .home_dir()
        .map_err(|error| error.to_string())?
        .join(".ore-code")
        .join("mcp.json"))
}

pub(crate) fn read_mcp_config_document(path: &Path) -> Result<serde_json::Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({ "servers": {} }));
    }
    fs::read_to_string(path)
        .map_err(|error| error.to_string())
        .and_then(|raw| {
            serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| error.to_string())
        })
}

pub(crate) fn write_mcp_config_document(
    path: &Path,
    document: &serde_json::Value,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(document).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

pub(crate) fn mcp_servers_object_mut(
    document: &mut serde_json::Value,
) -> Result<&mut serde_json::Map<String, serde_json::Value>, String> {
    let root = document
        .as_object_mut()
        .ok_or_else(|| "MCP config must be a JSON object".to_string())?;
    let key = if root.contains_key("servers") {
        "servers"
    } else if root.contains_key("mcpServers") {
        "mcpServers"
    } else {
        return Err("MCP config must contain servers or mcpServers".to_string());
    };
    root.get_mut(key)
        .and_then(|servers| servers.as_object_mut())
        .ok_or_else(|| "MCP config servers must be an object".to_string())
}

pub(crate) fn mcp_server_object_mut<'a>(
    document: &'a mut serde_json::Value,
    name: &str,
) -> Result<&'a mut serde_json::Map<String, serde_json::Value>, String> {
    let normalized = validate_mcp_server_name(name)?;
    let servers = mcp_servers_object_mut(document)?;
    servers
        .get_mut(&normalized)
        .and_then(|server| server.as_object_mut())
        .ok_or_else(|| format!("MCP server does not exist: {normalized}"))
}

pub(crate) fn validate_mcp_server_name(name: &str) -> Result<String, String> {
    let normalized = sanitize_mcp_name(name);
    if normalized.is_empty() {
        return Err("MCP server name is required".to_string());
    }
    Ok(normalized)
}

pub(crate) fn load_mcp_snapshot(
    app: &tauri::AppHandle,
    manager: &mut McpManager,
) -> McpToolSnapshot {
    let path = match mcp_config_file(app) {
        Ok(path) => path,
        Err(error) => {
            return McpToolSnapshot {
                config_path: "~/.ore-code/mcp.json".to_string(),
                configured: false,
                error: Some(error),
                prompts: Vec::new(),
                resources: Vec::new(),
                servers: Vec::new(),
                supported: true,
                tools: Vec::new(),
            };
        }
    };
    let config_path = path.display().to_string();
    if !path.exists() {
        return McpToolSnapshot {
            config_path,
            configured: false,
            error: None,
            prompts: Vec::new(),
            resources: Vec::new(),
            servers: Vec::new(),
            supported: true,
            tools: Vec::new(),
        };
    }

    let config = match fs::read_to_string(&path)
        .map_err(|error| error.to_string())
        .and_then(|raw| {
            serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| error.to_string())
        })
        .and_then(|value| parse_mcp_config(&value))
    {
        Ok(config) => config,
        Err(error) => {
            return McpToolSnapshot {
                config_path,
                configured: true,
                error: Some(error),
                prompts: Vec::new(),
                resources: Vec::new(),
                servers: Vec::new(),
                supported: true,
                tools: Vec::new(),
            };
        }
    };

    manager.stop_all();
    let mut server_snapshots = Vec::new();
    let mut all_prompts = Vec::new();
    let mut all_resources = Vec::new();
    let mut all_tools = Vec::new();

    for server_config in config {
        if server_config.disabled {
            server_snapshots.push(mcp_server_snapshot_from_config(
                &server_config,
                "disabled",
                None,
                Vec::new(),
                Vec::new(),
                Vec::new(),
            ));
            continue;
        }

        match connect_mcp_server(&server_config) {
            Ok((runtime, discovery)) => {
                let tools = discovery.tools;
                let filtered_tools = filter_mcp_tools(&server_config, tools);
                for tool in &filtered_tools {
                    manager.tool_map.insert(
                        tool.qualified_name.clone(),
                        (tool.server_name.clone(), tool.name.clone()),
                    );
                }
                manager.servers.insert(server_config.name.clone(), runtime);
                all_prompts.extend(discovery.prompts.clone());
                all_resources.extend(discovery.resources.clone());
                all_tools.extend(filtered_tools.clone());
                server_snapshots.push(mcp_server_snapshot_from_config(
                    &server_config,
                    "connected",
                    None,
                    discovery.prompts,
                    discovery.resources,
                    filtered_tools,
                ));
            }
            Err(error) => {
                server_snapshots.push(mcp_server_snapshot_from_config(
                    &server_config,
                    "failed",
                    Some(error),
                    Vec::new(),
                    Vec::new(),
                    Vec::new(),
                ));
            }
        }
    }

    McpToolSnapshot {
        config_path,
        configured: true,
        error: None,
        prompts: all_prompts,
        resources: all_resources,
        servers: server_snapshots,
        supported: true,
        tools: all_tools,
    }
}

pub(crate) fn mcp_server_snapshot_from_config(
    server_config: &McpServerConfig,
    status: &str,
    error: Option<String>,
    prompts: Vec<McpPromptDescriptor>,
    resources: Vec<McpResourceDescriptor>,
    tools: Vec<McpToolDescriptor>,
) -> McpServerSnapshot {
    McpServerSnapshot {
        args: server_config.args.clone(),
        command: server_config.command.clone(),
        connect_timeout_secs: server_config.connect_timeout_secs,
        disabled_tools: server_config.disabled_tools.clone(),
        error,
        execute_timeout_secs: server_config.execute_timeout_secs,
        enabled_tools: server_config.enabled_tools.clone(),
        env: server_config.env.clone(),
        framing: server_config.framing.map(mcp_stdio_framing_label),
        name: server_config.name.clone(),
        prompt_count: prompts.len(),
        prompts,
        resource_count: resources.len(),
        resources,
        status: status.to_string(),
        tool_count: tools.len(),
        tools,
        transport: server_config.transport.clone(),
        url: server_config.url.clone(),
    }
}

pub(crate) fn replace_mcp_server_snapshot(
    snapshot: &mut McpToolSnapshot,
    server_snapshot: McpServerSnapshot,
) {
    if let Some(existing) = snapshot
        .servers
        .iter_mut()
        .find(|server| server.name == server_snapshot.name)
    {
        *existing = server_snapshot;
    } else {
        snapshot.servers.push(server_snapshot);
    }
    rebuild_mcp_snapshot_collections(snapshot);
}

fn rebuild_mcp_snapshot_collections(snapshot: &mut McpToolSnapshot) {
    snapshot.prompts = snapshot
        .servers
        .iter()
        .flat_map(|server| server.prompts.clone())
        .collect();
    snapshot.resources = snapshot
        .servers
        .iter()
        .flat_map(|server| server.resources.clone())
        .collect();
    snapshot.tools = snapshot
        .servers
        .iter()
        .flat_map(|server| server.tools.clone())
        .collect();
}

pub(crate) fn parse_mcp_config(value: &serde_json::Value) -> Result<Vec<McpServerConfig>, String> {
    let root = value
        .as_object()
        .ok_or_else(|| "MCP config must be a JSON object".to_string())?;
    let global_timeouts = root.get("timeouts").and_then(|value| value.as_object());
    let servers = root
        .get("servers")
        .or_else(|| root.get("mcpServers"))
        .and_then(|value| value.as_object())
        .ok_or_else(|| "MCP config must contain servers or mcpServers".to_string())?;
    let mut result = Vec::new();

    for (name, raw) in servers {
        let object = raw
            .as_object()
            .ok_or_else(|| format!("MCP server '{name}' must be an object"))?;
        let url = read_string(object, "url");
        let command = read_string(object, "command");
        if url.is_none() && command.is_none() {
            return Err(format!("MCP server '{name}' requires command or url"));
        }

        let disabled = read_bool(object, "disabled").unwrap_or(false)
            || read_bool(object, "enabled")
                .map(|enabled| !enabled)
                .unwrap_or(false);
        let transport = if url.is_some() { "http" } else { "stdio" }.to_string();
        result.push(McpServerConfig {
            args: read_string_array(object, "args"),
            command,
            connect_timeout_secs: read_timeout(object, global_timeouts, "connect_timeout"),
            disabled,
            disabled_tools: read_string_array(object, "disabled_tools"),
            enabled_tools: read_string_array(object, "enabled_tools"),
            env: read_string_map(object, "env"),
            execute_timeout_secs: read_timeout(object, global_timeouts, "execute_timeout"),
            framing: read_stdio_framing(object),
            name: sanitize_mcp_name(name),
            transport,
            url,
        });
    }

    Ok(result)
}

pub(crate) fn connect_mcp_server(
    config: &McpServerConfig,
) -> Result<(McpRuntimeServer, McpDiscovery), String> {
    if config.transport == "http" {
        return discover_mcp_runtime(
            config,
            McpRuntimeServer::Http {
                connect_timeout_secs: config.connect_timeout_secs,
                url: config
                    .url
                    .clone()
                    .ok_or_else(|| "HTTP MCP server missing url".to_string())?,
                timeout_secs: config.execute_timeout_secs,
            },
        );
    }

    let Some(framing) = config.framing else {
        let header_result = connect_stdio_mcp_server(config, McpStdioFraming::Header);
        return match header_result {
            Ok(result) => Ok(result),
            Err(error) if is_mcp_timeout_error(&error) => {
                connect_stdio_mcp_server(config, McpStdioFraming::JsonLine)
                    .map_err(|fallback| format!("{error}; JSONL fallback failed: {fallback}"))
            }
            Err(error) => Err(error),
        };
    };

    connect_stdio_mcp_server(config, framing)
}

fn connect_stdio_mcp_server(
    config: &McpServerConfig,
    framing: McpStdioFraming,
) -> Result<(McpRuntimeServer, McpDiscovery), String> {
    let command = config
        .command
        .clone()
        .ok_or_else(|| "stdio MCP server missing command".to_string())?;
    let resolved_command = resolve_executable_for_command(&command);
    let mut command_process = Command::new(resolved_command);
    hide_child_console_on_windows(
        command_process
            .args(&config.args)
            .envs(&config.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null()),
    );
    let mut child = command_process.spawn().map_err(|error| error.to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to open MCP stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to open MCP stdout".to_string())?;
    let stdout_rx = spawn_mcp_stdout_reader(stdout, framing);
    discover_mcp_runtime(
        config,
        McpRuntimeServer::Stdio {
            child,
            framing,
            stdin,
            next_id: 0,
            stdout_rx,
            timeout_secs: config.execute_timeout_secs,
        },
    )
}

fn discover_mcp_runtime(
    config: &McpServerConfig,
    mut runtime: McpRuntimeServer,
) -> Result<(McpRuntimeServer, McpDiscovery), String> {
    if let Err(error) = mcp_json_rpc(
        &mut runtime,
        "initialize",
        serde_json::json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": "Ore Code",
                "version": "0.1.0"
            }
        }),
    ) {
        shutdown_mcp_runtime(&mut runtime);
        return Err(error);
    }
    let list = match mcp_json_rpc(&mut runtime, "tools/list", serde_json::json!({})) {
        Ok(list) => list,
        Err(error) => {
            shutdown_mcp_runtime(&mut runtime);
            return Err(error);
        }
    };
    let mut used_tool_names = HashMap::new();
    let tools = list
        .get("result")
        .and_then(|result| result.get("tools"))
        .and_then(|tools| tools.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .filter_map(|(index, value)| {
            mcp_tool_from_value(&config.name, index, value, &mut used_tool_names)
        })
        .collect();
    let resources = mcp_json_rpc(&mut runtime, "resources/list", serde_json::json!({}))
        .ok()
        .and_then(|value| {
            value
                .get("result")
                .and_then(|result| result.get("resources"))
                .and_then(|resources| resources.as_array())
                .cloned()
        })
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .filter_map(|(index, value)| mcp_resource_from_value(&config.name, index, value))
        .collect();
    let prompts = mcp_json_rpc(&mut runtime, "prompts/list", serde_json::json!({}))
        .ok()
        .and_then(|value| {
            value
                .get("result")
                .and_then(|result| result.get("prompts"))
                .and_then(|prompts| prompts.as_array())
                .cloned()
        })
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .filter_map(|(index, value)| mcp_prompt_from_value(&config.name, index, value))
        .collect();

    Ok((
        runtime,
        McpDiscovery {
            prompts,
            resources,
            tools,
        },
    ))
}

fn is_mcp_timeout_error(error: &str) -> bool {
    error.contains("timed out")
}

fn shutdown_mcp_runtime(runtime: &mut McpRuntimeServer) {
    if let McpRuntimeServer::Stdio { child, .. } = runtime {
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub(crate) fn mcp_json_rpc(
    server: &mut McpRuntimeServer,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    match server {
        McpRuntimeServer::Http {
            connect_timeout_secs,
            timeout_secs,
            url,
        } => {
            let request = serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": method,
                "params": params
            });
            http_json_rpc(url, &request, *connect_timeout_secs, *timeout_secs)
        }
        McpRuntimeServer::Stdio {
            framing,
            stdin,
            next_id,
            stdout_rx,
            timeout_secs,
            ..
        } => {
            *next_id += 1;
            let request = serde_json::json!({
                "jsonrpc": "2.0",
                "id": *next_id,
                "method": method,
                "params": params
            });
            write_mcp_stdio_request(stdin, *framing, &request)?;
            parse_json_rpc_response(read_mcp_frame_with_timeout(stdout_rx, *timeout_secs)?)
        }
    }
}

pub(crate) fn spawn_mcp_stdout_reader(
    stdout: ChildStdout,
    framing: McpStdioFraming,
) -> std::sync::mpsc::Receiver<Result<serde_json::Value, String>> {
    let (tx, rx) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let result = match framing {
                McpStdioFraming::Header => read_mcp_frame(&mut reader),
                McpStdioFraming::JsonLine => read_mcp_json_line(&mut reader),
            };
            let keep_reading = result.is_ok();
            if tx.send(result).is_err() || !keep_reading {
                break;
            }
        }
    });
    rx
}

pub(crate) fn write_mcp_stdio_request(
    stdin: &mut ChildStdin,
    framing: McpStdioFraming,
    value: &serde_json::Value,
) -> Result<(), String> {
    match framing {
        McpStdioFraming::Header => write_mcp_frame(stdin, value),
        McpStdioFraming::JsonLine => {
            let body = serde_json::to_vec(value).map_err(|error| error.to_string())?;
            stdin
                .write_all(&body)
                .and_then(|_| stdin.write_all(b"\n"))
                .and_then(|_| stdin.flush())
                .map_err(|error| error.to_string())
        }
    }
}

pub(crate) fn read_mcp_frame_with_timeout(
    rx: &std::sync::mpsc::Receiver<Result<serde_json::Value, String>>,
    timeout_secs: u64,
) -> Result<serde_json::Value, String> {
    match rx.recv_timeout(Duration::from_secs(timeout_secs.max(1))) {
        Ok(result) => result,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err(format!(
            "MCP server response timed out after {timeout_secs}s"
        )),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            Err("MCP server stdout reader stopped".to_string())
        }
    }
}

pub(crate) fn write_mcp_frame(
    stdin: &mut ChildStdin,
    value: &serde_json::Value,
) -> Result<(), String> {
    let body = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    stdin
        .write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())
        .and_then(|_| stdin.write_all(&body))
        .and_then(|_| stdin.flush())
        .map_err(|error| error.to_string())
}

pub(crate) fn read_mcp_frame(stdout: &mut dyn BufRead) -> Result<serde_json::Value, String> {
    let mut content_length = None;
    loop {
        let mut line = String::new();
        let read = stdout
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("MCP server closed stdout".to_string());
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|error| error.to_string())?,
            );
        }
    }
    let length = content_length.ok_or_else(|| "MCP response missing Content-Length".to_string())?;
    let mut body = vec![0_u8; length];
    stdout
        .read_exact(&mut body)
        .map_err(|error| error.to_string())?;
    serde_json::from_slice(&body).map_err(|error| error.to_string())
}

pub(crate) fn read_mcp_json_line(stdout: &mut dyn BufRead) -> Result<serde_json::Value, String> {
    let mut line = String::new();
    let read = stdout
        .read_line(&mut line)
        .map_err(|error| error.to_string())?;
    if read == 0 {
        return Err("MCP server closed stdout".to_string());
    }
    serde_json::from_str(line.trim()).map_err(|error| error.to_string())
}

pub(crate) fn http_json_rpc(
    url: &str,
    request: &serde_json::Value,
    connect_timeout_secs: u64,
    timeout_secs: u64,
) -> Result<serde_json::Value, String> {
    let parsed = parse_http_url(url)?;
    let body = serde_json::to_string(request).map_err(|error| error.to_string())?;
    let address = (parsed.host.as_str(), parsed.port)
        .to_socket_addrs()
        .map_err(|error| error.to_string())?
        .next()
        .ok_or_else(|| format!("could not resolve MCP host: {}", parsed.host))?;
    let mut stream =
        TcpStream::connect_timeout(&address, Duration::from_secs(connect_timeout_secs))
            .map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(timeout_secs)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(timeout_secs)))
        .map_err(|error| error.to_string())?;
    let http = format!(
        "POST {} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nAccept: application/json\r\nMCP-Protocol-Version: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        parsed.path,
        parsed.host_header,
        MCP_PROTOCOL_VERSION,
        body.len(),
        body
    );
    stream
        .write_all(http.as_bytes())
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    let body_start = response
        .find("\r\n\r\n")
        .ok_or_else(|| "invalid HTTP MCP response".to_string())?
        + 4;
    let status_line = response.lines().next().unwrap_or_default();
    if !status_line.contains(" 200 ") && !status_line.contains(" 202 ") {
        return Err(format!("HTTP MCP request failed: {status_line}"));
    }
    parse_json_rpc_response(
        serde_json::from_str(&response[body_start..]).map_err(|error| error.to_string())?,
    )
}

pub(crate) fn parse_json_rpc_response(
    value: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if let Some(error) = value.get("error") {
        return Err(error.to_string());
    }

    Ok(value)
}

pub(crate) fn mcp_contents_text(contents: &[serde_json::Value]) -> String {
    contents
        .iter()
        .filter_map(|item| {
            item.get("text")
                .and_then(|value| value.as_str())
                .or_else(|| item.get("blob").and_then(|value| value.as_str()))
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub(crate) fn mcp_prompt_text(result: &serde_json::Value) -> String {
    let Some(messages) = result.get("messages").and_then(|value| value.as_array()) else {
        return String::new();
    };

    messages
        .iter()
        .filter_map(|message| {
            let role = message
                .get("role")
                .and_then(|value| value.as_str())
                .unwrap_or("user");
            let content = message.get("content")?;
            let text = if let Some(text) = content.as_str() {
                text
            } else {
                content
                    .get("text")
                    .and_then(|value| value.as_str())
                    .or_else(|| content.get("data").and_then(|value| value.as_str()))?
            };
            Some(format!("{role}: {text}"))
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub(crate) struct ParsedHttpUrl {
    pub(crate) host: String,
    pub(crate) host_header: String,
    pub(crate) path: String,
    pub(crate) port: u16,
}

pub(crate) fn parse_http_url(url: &str) -> Result<ParsedHttpUrl, String> {
    let without_scheme = url
        .strip_prefix("http://")
        .ok_or_else(|| "Only http:// MCP URLs are supported in this batch".to_string())?;
    let (host_port, path) = without_scheme
        .split_once('/')
        .map(|(host, path)| (host, format!("/{path}")))
        .unwrap_or((without_scheme, "/".to_string()));
    let (host, port) = host_port
        .split_once(':')
        .map(|(host, port)| {
            Ok::<_, String>((
                host.to_string(),
                port.parse::<u16>().map_err(|error| error.to_string())?,
            ))
        })
        .unwrap_or_else(|| Ok((host_port.to_string(), 80)))?;

    Ok(ParsedHttpUrl {
        host: host.clone(),
        host_header: host_port.to_string(),
        path,
        port,
    })
}

pub(crate) fn mcp_tool_from_value(
    server_name: &str,
    index: usize,
    value: serde_json::Value,
    used_names: &mut HashMap<String, usize>,
) -> Option<McpToolDescriptor> {
    let object = value.as_object()?;
    let name = object
        .get("name")
        .and_then(|value| value.as_str())
        .filter(|name| !name.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("tool_{index}"));
    let sanitized_name = sanitize_mcp_name(&name);
    let base_name = if sanitized_name.is_empty() {
        format!("tool_{index}")
    } else {
        sanitized_name
    };
    let seen = used_names.entry(base_name.clone()).or_insert(0);
    *seen += 1;
    let unique_name = if *seen == 1 {
        base_name
    } else {
        format!("{}_{}", base_name, *seen)
    };
    let qualified_name = format!("mcp_{}_{}", sanitize_mcp_name(server_name), unique_name);
    let description = object
        .get("description")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let input_schema = object
        .get("inputSchema")
        .or_else(|| object.get("input_schema"))
        .cloned()
        .unwrap_or_else(|| serde_json::json!({ "type": "object", "additionalProperties": true }));
    let annotations = object.get("annotations").cloned();

    Some(McpToolDescriptor {
        annotations,
        description,
        input_schema,
        name,
        qualified_name,
        server_name: server_name.to_string(),
    })
}

pub(crate) fn mcp_resource_from_value(
    server_name: &str,
    index: usize,
    value: serde_json::Value,
) -> Option<McpResourceDescriptor> {
    let object = value.as_object()?;
    let uri = object
        .get("uri")
        .and_then(|value| value.as_str())
        .filter(|uri| !uri.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("resource:{index}"));
    let name = object
        .get("name")
        .and_then(|value| value.as_str())
        .filter(|name| !name.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| uri.clone());
    let description = object
        .get("description")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let mime_type = object
        .get("mimeType")
        .or_else(|| object.get("mime_type"))
        .and_then(|value| value.as_str())
        .map(ToString::to_string);

    Some(McpResourceDescriptor {
        description,
        mime_type,
        name,
        server_name: server_name.to_string(),
        uri,
    })
}

pub(crate) fn mcp_prompt_from_value(
    server_name: &str,
    index: usize,
    value: serde_json::Value,
) -> Option<McpPromptDescriptor> {
    let object = value.as_object()?;
    let name = object
        .get("name")
        .and_then(|value| value.as_str())
        .filter(|name| !name.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("prompt_{index}"));
    let description = object
        .get("description")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();

    Some(McpPromptDescriptor {
        description,
        name,
        server_name: server_name.to_string(),
    })
}

pub(crate) fn filter_mcp_tools(
    config: &McpServerConfig,
    tools: Vec<McpToolDescriptor>,
) -> Vec<McpToolDescriptor> {
    tools
        .into_iter()
        .filter(|tool| {
            let sanitized_name = sanitize_mcp_name(&tool.name);
            let is_enabled = config.enabled_tools.is_empty()
                || config.enabled_tools.contains(&tool.name)
                || config.enabled_tools.contains(&sanitized_name)
                || config.enabled_tools.contains(&tool.qualified_name);
            let is_disabled = config.disabled_tools.contains(&tool.name)
                || config.disabled_tools.contains(&sanitized_name)
                || config.disabled_tools.contains(&tool.qualified_name);
            is_enabled && !is_disabled
        })
        .collect()
}

pub(crate) fn sanitize_mcp_name(value: &str) -> String {
    let mut result = String::new();
    let mut last_was_underscore = false;
    for character in value.chars() {
        let next = if character.is_ascii_alphanumeric() {
            Some(character.to_ascii_lowercase())
        } else {
            Some('_')
        };
        if let Some(next) = next {
            if next == '_' {
                if !last_was_underscore && !result.is_empty() {
                    result.push(next);
                    last_was_underscore = true;
                }
            } else {
                result.push(next);
                last_was_underscore = false;
            }
        }
    }
    result.trim_matches('_').to_string()
}

pub(crate) fn read_string(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<String> {
    object
        .get(key)
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
}

pub(crate) fn read_bool(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<bool> {
    object.get(key).and_then(|value| value.as_bool())
}

pub(crate) fn read_string_array(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Vec<String> {
    object
        .get(key)
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(ToString::to_string))
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn read_string_map(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> HashMap<String, String> {
    object
        .get(key)
        .and_then(|value| value.as_object())
        .map(|values| {
            values
                .iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| (key.clone(), value.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn read_timeout(
    object: &serde_json::Map<String, serde_json::Value>,
    global: Option<&serde_json::Map<String, serde_json::Value>>,
    key: &str,
) -> u64 {
    object
        .get(key)
        .or_else(|| global.and_then(|global| global.get(key)))
        .and_then(|value| value.as_u64())
        .unwrap_or(DEFAULT_MCP_TIMEOUT_SECS)
}

pub(crate) fn read_stdio_framing(
    object: &serde_json::Map<String, serde_json::Value>,
) -> Option<McpStdioFraming> {
    match read_string(object, "framing")?.as_str() {
        "header" | "headers" | "content-length" | "content_length" => Some(McpStdioFraming::Header),
        "jsonl" | "json-line" | "json_line" | "ndjson" => Some(McpStdioFraming::JsonLine),
        _ => None,
    }
}

fn mcp_stdio_framing_label(framing: McpStdioFraming) -> String {
    match framing {
        McpStdioFraming::Header => "header".to_string(),
        McpStdioFraming::JsonLine => "jsonl".to_string(),
    }
}
