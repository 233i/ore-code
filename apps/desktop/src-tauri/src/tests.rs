use super::*;
use std::net::TcpListener;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[test]
fn resolves_relative_paths_inside_workspace() {
    let root = make_temp_workspace();
    fs::write(root.join("file.txt"), "ok").unwrap();

    let resolved = resolve_existing_workspace_path(root.to_str().unwrap(), "file.txt").unwrap();

    assert!(resolved.starts_with(root.canonicalize().unwrap()));
}

#[test]
fn rejects_parent_traversal_outside_workspace() {
    let root = make_temp_workspace();
    let outside = root.parent().unwrap().join("outside.txt");
    fs::write(&outside, "no").unwrap();

    let result = resolve_existing_workspace_path(root.to_str().unwrap(), "../outside.txt");

    assert!(result.is_err());
}

#[test]
fn write_paths_must_stay_inside_workspace() {
    let root = make_temp_workspace();

    let result = resolve_workspace_write_path(root.to_str().unwrap(), "../escape.txt");

    assert!(result.is_err());
}

#[test]
fn automation_weekly_rrule_uses_custom_days_and_time() {
    let after = chrono::DateTime::parse_from_rfc3339("2026-05-18T10:00:00.000Z")
        .unwrap()
        .with_timezone(&Utc);

    let next = automation_daemon::next_run_after_rrule(
        "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=30",
        after,
    );

    assert_eq!(next, local_datetime_rfc3339(2026, 5, 19, 9, 30));
}

#[test]
fn automation_daily_custom_time_can_run_next_day() {
    let after = chrono::DateTime::parse_from_rfc3339("2026-05-18T22:00:00.000Z")
        .unwrap()
        .with_timezone(&Utc);

    let next = automation_daemon::next_run_after_rrule(
        "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYHOUR=8;BYMINUTE=15",
        after,
    );

    assert_eq!(next, local_datetime_rfc3339(2026, 5, 19, 8, 15));
}

#[test]
fn file_search_finds_matching_relative_paths() {
    let root = make_temp_workspace();
    fs::create_dir(root.join("src")).unwrap();
    fs::write(root.join("src").join("app.ts"), "hello").unwrap();
    fs::write(root.join("README.md"), "readme").unwrap();

    let result = search_files(&root, &root, "app", Some(10)).unwrap();

    assert_eq!(result.matches.len(), 1);
    assert_eq!(
        result.matches[0].path,
        Path::new("src").join("app.ts").display().to_string()
    );
    assert_eq!(result.matches[0].name, "app.ts");
    assert!(!result.matches[0].is_dir);
    assert!(!result.truncated);
}

#[test]
fn file_search_skips_heavy_directories() {
    let root = make_temp_workspace();
    fs::create_dir(root.join("node_modules")).unwrap();
    fs::write(root.join("node_modules").join("needle.js"), "ignored").unwrap();

    let result = search_files(&root, &root, "needle", Some(10)).unwrap();

    assert!(result.matches.is_empty());
}

#[test]
fn grep_files_finds_text_lines() {
    let root = make_temp_workspace();
    fs::create_dir(root.join("src")).unwrap();
    fs::write(root.join("src").join("app.ts"), "one\nNeedle here\nthree\n").unwrap();

    let result = grep_files(&root, &root, "needle", false, Some(10)).unwrap();

    assert_eq!(result.matches.len(), 1);
    assert_eq!(
        result.matches[0].path,
        Path::new("src").join("app.ts").display().to_string()
    );
    assert_eq!(result.matches[0].line_number, 2);
    assert_eq!(result.matches[0].line, "Needle here");
    assert_eq!(result.matches[0].match_start, 0);
    assert!(!result.truncated);
}

#[test]
fn grep_files_respects_case_sensitive_search() {
    let root = make_temp_workspace();
    fs::write(root.join("note.txt"), "Needle\n").unwrap();

    let result = grep_files(&root, &root, "needle", true, Some(10)).unwrap();

    assert!(result.matches.is_empty());
}

#[test]
fn shell_run_uses_workspace_as_cwd() {
    let root = make_temp_workspace();

    let result = run_shell_command(&root, pwd_command(), 5_000).unwrap();

    assert_eq!(result.exit_code, Some(0));
    assert_eq!(
        result.stdout.trim(),
        root.canonicalize().unwrap().to_str().unwrap()
    );
    assert!(!result.timed_out);
}

#[test]
fn shell_run_captures_stdout_stderr_and_exit_code() {
    let root = make_temp_workspace();

    let result = run_shell_command(&root, output_and_exit_command(), 5_000).unwrap();

    assert_eq!(result.exit_code, Some(7));
    assert_eq!(result.stdout.trim(), "out");
    assert_eq!(result.stderr.trim(), "err");
    assert!(!result.timed_out);
}

#[test]
fn shell_run_times_out_and_kills_process() {
    let root = make_temp_workspace();

    let result = run_shell_command(&root, slow_command(), 50).unwrap();

    assert_eq!(result.exit_code, None);
    assert!(result.timed_out);
}

#[test]
fn sandbox_policy_filters_sensitive_environment_keys() {
    assert!(is_sensitive_env_key("OPENAI_API_KEY"));
    assert!(is_sensitive_env_key("GITHUB_TOKEN"));
    assert!(is_sensitive_env_key("SSH_AUTH_SOCK"));
    assert!(!should_keep_env_key(
        "DEEPSEEK_API_KEY",
        SandboxEnvironmentMode::InheritSafe
    ));
    assert!(should_keep_env_key("PATH", SandboxEnvironmentMode::Minimal));
    assert!(!should_keep_env_key(
        "NODE_OPTIONS",
        SandboxEnvironmentMode::Minimal
    ));
}

#[test]
fn shell_job_start_records_completed_output() {
    let root = make_temp_workspace();
    let store = ShellJobStore::default();

    let started = start_shell_job(
        store.clone(),
        root.to_str().unwrap().to_string(),
        output_and_exit_command().to_string(),
        5_000,
    )
    .unwrap();
    let completed = wait_for_shell_job(&store, &started.id, "completed");

    assert_eq!(completed.status, "completed");
    assert_eq!(completed.exit_code, Some(7));
    assert_eq!(completed.stdout.trim(), "out");
    assert_eq!(completed.stderr.trim(), "err");
    assert_eq!(completed.duration_ms.is_some(), true);
}

#[test]
fn shell_job_cancel_marks_job_canceled() {
    let root = make_temp_workspace();
    let store = ShellJobStore::default();

    let started = start_shell_job(
        store.clone(),
        root.to_str().unwrap().to_string(),
        slow_command().to_string(),
        5_000,
    )
    .unwrap();
    let canceling = cancel_shell_job(&store, &started.id).unwrap();
    let canceled = wait_for_shell_job(&store, &started.id, "canceled");

    assert_eq!(canceling.status, "canceling");
    assert_eq!(canceled.status, "canceled");
    assert!(!canceled.timed_out);
}

#[test]
fn shell_job_get_reads_existing_job() {
    let root = make_temp_workspace();
    let store = ShellJobStore::default();

    let started = start_shell_job(
        store.clone(),
        root.to_str().unwrap().to_string(),
        pwd_command().to_string(),
        5_000,
    )
    .unwrap();

    let snapshot = get_shell_job(&store, &started.id).unwrap();

    assert_eq!(snapshot.id, started.id);
    assert_eq!(snapshot.command, pwd_command());
}

#[test]
fn shell_job_get_rejects_unknown_job() {
    let store = ShellJobStore::default();

    let result = get_shell_job(&store, "missing-job");

    assert!(result.is_err());
}

#[test]
fn shell_job_output_truncation_keeps_tail() {
    let output = format!("{}tail", "a".repeat(MAX_JOB_OUTPUT_CHARS + 10));

    let truncated = truncate_job_output(&output);

    assert!(truncated.truncated);
    assert_eq!(truncated.text.chars().count(), MAX_JOB_OUTPUT_CHARS);
    assert!(truncated.text.ends_with("tail"));
}

#[test]
fn git_status_reports_non_git_workspace() {
    if !git_is_available() {
        return;
    }
    let root = make_temp_workspace();

    let result = read_git_status(&root).unwrap();

    assert!(!result.is_repo);
    assert!(result.error.is_some());
}

#[test]
fn fs_delete_file_removes_file_inside_workspace() {
    let root = make_temp_workspace();
    let target = root.join("note.txt");
    fs::write(&target, "hello").unwrap();

    fs_delete_file(root.to_str().unwrap().to_string(), "note.txt".to_string()).unwrap();

    assert!(!target.exists());
}

#[test]
fn skill_id_rejects_path_traversal() {
    assert!(skill_dir_for_id(Path::new("/tmp/ore-code-skills"), "../escape").is_err());
    assert!(skill_dir_for_id(Path::new("/tmp/ore-code-skills"), "bad/id").is_err());
    assert!(skill_dir_for_id(Path::new("/tmp/ore-code-skills"), "-bad").is_err());
}

#[test]
fn skill_dir_for_id_stays_under_skill_root() {
    let root = Path::new("/tmp/ore-code-skills");
    let result = skill_dir_for_id(root, "reviewer-1").unwrap();

    assert_eq!(result, root.join("reviewer-1"));
}

#[test]
fn skill_rename_rejects_target_conflict() {
    let root = make_temp_workspace();
    fs::create_dir(root.join("old")).unwrap();
    fs::create_dir(root.join("new")).unwrap();

    let from_dir = skill_dir_for_id(&root, "old").unwrap();
    let to_dir = skill_dir_for_id(&root, "new").unwrap();

    assert!(rename_skill_dir(&from_dir, &to_dir, "old", "new").is_err());
}

#[test]
fn trash_skill_dir_reports_missing_directory() {
    let root = make_temp_workspace();

    let result = trash_skill_dir(&root.join("missing"));

    assert!(result.is_err());
}

#[test]
fn git_status_reports_workspace_changes() {
    if !git_is_available() {
        return;
    }
    let root = make_temp_workspace();
    init_git_repo(&root);
    fs::write(root.join("note.txt"), "hello\n").unwrap();

    let result = read_git_status(&root).unwrap();

    assert!(result.is_repo);
    assert_eq!(result.entries[0].status, "??");
    assert_eq!(result.entries[0].path, "note.txt");
}

#[test]
fn git_status_preserves_two_column_status_codes() {
    let result = parse_git_status("## main\n M changed.txt\nM  staged.txt\nMM both.txt\n");

    assert_eq!(result.entries[0].status, " M");
    assert_eq!(result.entries[1].status, "M ");
    assert_eq!(result.entries[2].status, "MM");
}

#[test]
fn git_diff_reads_unstaged_diff() {
    if !git_is_available() {
        return;
    }
    let root = make_temp_workspace();
    init_git_repo(&root);
    fs::write(root.join("note.txt"), "hello\n").unwrap();
    run_git_test_command(&root, &["add", "--intent-to-add", "note.txt"]);

    let result = read_git_diff(&root, false, None).unwrap();

    assert!(result.is_repo);
    assert!(result.diff.contains("diff --git"));
    assert!(result.diff.contains("+hello"));
}

#[test]
fn git_diff_filters_by_path() {
    if !git_is_available() {
        return;
    }
    let root = make_temp_workspace();
    init_git_repo(&root);
    fs::write(root.join("one.txt"), "one\n").unwrap();
    fs::write(root.join("two.txt"), "two\n").unwrap();
    run_git_test_command(&root, &["add", "--intent-to-add", "one.txt", "two.txt"]);

    let result = read_git_diff(&root, false, Some("one.txt")).unwrap();

    assert!(result.diff.contains("one.txt"));
    assert!(!result.diff.contains("two.txt"));
}

#[test]
fn git_diff_reads_untracked_file_by_path() {
    if !git_is_available() {
        return;
    }
    let root = make_temp_workspace();
    init_git_repo(&root);
    fs::write(root.join("new-note.txt"), "hello\nworld\n").unwrap();

    let result = read_git_diff(&root, false, Some("new-note.txt")).unwrap();

    assert!(result.is_repo);
    assert!(
        result
            .diff
            .contains("diff --git a/new-note.txt b/new-note.txt")
    );
    assert!(result.diff.contains("new file mode"));
    assert!(result.diff.contains("+hello"));
    assert!(result.diff.contains("+world"));
}

#[test]
fn git_diff_from_subdirectory_uses_repo_relative_status_path() {
    if !git_is_available() {
        return;
    }
    let root = make_temp_workspace();
    init_git_repo(&root);
    configure_git_identity(&root);
    fs::create_dir_all(root.join("apps/desktop/src-tauri")).unwrap();
    fs::create_dir_all(root.join("apps/desktop/src")).unwrap();
    fs::write(root.join("apps/desktop/src/App.tsx"), "before\n").unwrap();
    run_git_test_command(&root, &["add", "apps/desktop/src/App.tsx"]);
    run_git_test_command(&root, &["commit", "-m", "initial"]);
    fs::write(root.join("apps/desktop/src/App.tsx"), "after\n").unwrap();

    let workspace = root.join("apps/desktop/src-tauri");
    let status = read_git_status(&workspace).unwrap();
    let result = read_git_diff(&workspace, false, Some("apps/desktop/src/App.tsx")).unwrap();

    assert_eq!(status.entries[0].status, " M");
    assert_eq!(status.entries[0].path, "apps/desktop/src/App.tsx");
    assert!(result.is_repo);
    assert!(
        result
            .diff
            .contains("diff --git a/apps/desktop/src/App.tsx b/apps/desktop/src/App.tsx")
    );
    assert!(result.diff.contains("-before"));
    assert!(result.diff.contains("+after"));
}

#[test]
fn git_review_tools_read_branch_log_show_and_blame() {
    if !git_is_available() {
        return;
    }
    let root = make_temp_workspace();
    init_git_repo(&root);
    configure_git_identity(&root);
    fs::write(root.join("note.txt"), "hello\n").unwrap();
    run_git_test_command(&root, &["add", "note.txt"]);
    run_git_test_command(&root, &["commit", "-m", "initial"]);

    let branch = read_git_branch(&root).unwrap();
    let log = read_git_log(&root, 5).unwrap();
    let show = read_git_show(&root, "HEAD", Some("note.txt")).unwrap();
    let blame = read_git_blame(&root, "note.txt", None).unwrap();

    assert!(branch.is_repo);
    assert!(!branch.branches.is_empty());
    assert!(log.output.contains("initial"));
    assert!(show.output.contains("note.txt"));
    assert!(blame.output.contains("hello"));
}

#[test]
fn secret_last4_handles_short_and_unicode_values() {
    assert_eq!(secret_last4("abc").as_deref(), Some("abc"));
    assert_eq!(secret_last4("sk-123456").as_deref(), Some("3456"));
    assert_eq!(secret_last4("密钥1234").as_deref(), Some("1234"));
    assert_eq!(secret_last4("").as_deref(), None);
}

#[test]
fn provider_secret_account_is_scoped_by_provider() {
    assert_eq!(
        provider_secret_account("deepseek"),
        "provider:deepseek:api-key"
    );
    assert_eq!(
        provider_secret_account("local-gateway"),
        "provider:local-gateway:api-key"
    );
}

#[test]
fn provider_secret_accepts_configured_provider_ids() {
    assert_eq!(
        normalize_provider("Local_Gateway").unwrap(),
        "local_gateway"
    );
    assert!(normalize_provider("../bad").is_err());
}

#[test]
fn app_settings_file_round_trips_non_secret_values() {
    let root = make_temp_workspace();
    let file = root.join("settings.json");
    let settings = serde_json::json!({
        "provider": "deepseek",
        "mode": "agent",
        "workspacePath": "/tmp/project",
        "deepSeekModel": "deepseek-v4-pro"
    });

    let written = write_app_settings_file(&file, settings.clone()).unwrap();
    let loaded = read_app_settings_file(&file).unwrap();

    assert_eq!(written, settings);
    assert_eq!(loaded, settings);
}

#[test]
fn app_settings_file_rejects_secret_keys() {
    let root = make_temp_workspace();
    let file = root.join("settings.json");
    let settings = serde_json::json!({
        "provider": "deepseek",
        "deepSeekApiKey": "sk-test"
    });

    let result = write_app_settings_file(&file, settings);

    assert!(result.is_err());
    assert!(!file.exists());
}

#[test]
fn config_source_reports_loaded_and_missing_files() {
    let root = make_temp_workspace();
    let file = root.join("config.toml");
    fs::write(&file, "provider = \"deepseek\"").unwrap();

    let loaded = read_config_source("project", file);
    let missing = read_config_source("global", root.join("missing.toml"));

    assert_eq!(loaded.status, "loaded");
    assert_eq!(loaded.content.as_deref(), Some("provider = \"deepseek\""));
    assert_eq!(missing.status, "missing");
}

#[test]
fn bootstrap_creates_user_environment_without_project_files() {
    let root = make_temp_workspace();
    let home = root.join("home");
    let app_data = root.join("app-data");

    ensure_user_environment_paths(&home, &app_data).unwrap();

    assert!(home.join(".ore-code").is_dir());
    assert!(home.join(".ore-code").join("config.toml").is_file());
    assert!(home.join(".ore-code").join("skills").is_dir());
    assert!(home.join(".ore-code").join("instructions.md").is_file());
    assert!(home.join(".ore-code").join("mcp.json").is_file());
    assert!(app_data.join("artifacts").is_dir());
    assert!(app_data.join("sessions").is_dir());
    assert!(app_data.join("snapshots").is_dir());
    assert!(app_data.join("side-snapshots").is_dir());
    assert!(app_data.join("side-git").is_dir());
    assert!(app_data.join("memory").is_dir());
    assert!(!root.join(".ore-code").exists());

    let config = fs::read_to_string(home.join(".ore-code").join("config.toml")).unwrap();
    assert!(config.contains("model = \"deepseek-v4-pro\""));
    assert!(config.contains("api_key_env = \"DEEPSEEK_API_KEY\""));

    let instructions = fs::read_to_string(home.join(".ore-code").join("instructions.md")).unwrap();
    assert!(instructions.contains("# Ore Code User Instructions"));

    let mcp: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(home.join(".ore-code").join("mcp.json")).unwrap())
            .unwrap();
    assert_eq!(mcp, serde_json::json!({ "servers": {} }));
}

#[test]
fn bootstrap_does_not_overwrite_existing_user_files() {
    let root = make_temp_workspace();
    let home = root.join("home");
    let app_data = root.join("app-data");
    fs::create_dir_all(home.join(".ore-code")).unwrap();
    fs::write(
        home.join(".ore-code").join("config.toml"),
        "provider = \"local\"\n",
    )
    .unwrap();
    fs::write(
        home.join(".ore-code").join("instructions.md"),
        "custom instructions\n",
    )
    .unwrap();
    fs::write(
        home.join(".ore-code").join("mcp.json"),
        "{ \"servers\": { \"existing\": {} } }\n",
    )
    .unwrap();

    ensure_user_environment_paths(&home, &app_data).unwrap();

    assert_eq!(
        fs::read_to_string(home.join(".ore-code").join("config.toml")).unwrap(),
        "provider = \"local\"\n"
    );
    assert_eq!(
        fs::read_to_string(home.join(".ore-code").join("mcp.json")).unwrap(),
        "{ \"servers\": { \"existing\": {} } }\n"
    );
    assert_eq!(
        fs::read_to_string(home.join(".ore-code").join("instructions.md")).unwrap(),
        "custom instructions\n"
    );
}

#[test]
fn env_name_validation_rejects_shell_injection_shapes() {
    assert_eq!(
        validate_env_name("DEEPSEEK_API_KEY").unwrap(),
        "DEEPSEEK_API_KEY"
    );
    assert!(validate_env_name("deepseek_api_key").is_err());
    assert!(validate_env_name("A;echo").is_err());
}

#[test]
fn web_url_validation_accepts_only_http_urls() {
    assert!(validate_web_url("https://example.com").is_ok());
    assert!(validate_web_url("http://example.com/path").is_ok());
    assert!(validate_web_url("file:///etc/passwd").is_err());
    assert!(validate_web_url("https://example.com/\nheader").is_err());
}

#[test]
fn web_fetch_http_client_returns_metadata_and_truncates_body() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut buffer = [0_u8; 1024];
        let _ = stream.read(&mut buffer).unwrap();
        let body = "x".repeat(1100);
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream.write_all(response.as_bytes()).unwrap();
    });

    let result =
        tauri::async_runtime::block_on(fetch_url_with_http_client(&url, 5_000, 1024)).unwrap();
    server.join().unwrap();

    assert_eq!(result.status, 200);
    assert_eq!(result.final_url, format!("{url}/"));
    assert_eq!(result.content_type.as_deref(), Some("text/plain"));
    assert_eq!(result.body.len(), 1024);
    assert!(result.truncated);
}

#[test]
fn mcp_config_parses_servers_and_timeouts() {
    let value = serde_json::json!({
        "timeouts": { "execute_timeout": 12 },
        "servers": {
            "Demo Server": {
                "command": "node",
                "args": ["server.js"],
                "env": { "A": "B" },
                "disabled_tools": ["write"]
            }
        }
    });

    let configs = parse_mcp_config(&value).unwrap();
    assert_eq!(configs.len(), 1);
    assert_eq!(configs[0].name, "demo_server");
    assert_eq!(configs[0].transport, "stdio");
    assert_eq!(configs[0].args, vec!["server.js"]);
    assert_eq!(configs[0].env.get("A"), Some(&"B".to_string()));
    assert_eq!(configs[0].execute_timeout_secs, 12);
}

#[test]
fn mcp_server_document_writes_advanced_fields() {
    let mut env = HashMap::new();
    env.insert("TOKEN".to_string(), "abc".to_string());
    let input = McpAddServerInput {
        args: Some(vec!["-y".to_string(), "server".to_string()]),
        command: Some("npx".to_string()),
        connect_timeout: Some(9),
        disabled: Some(true),
        disabled_tools: Some(vec!["write".to_string()]),
        enabled_tools: Some(vec!["read".to_string()]),
        env: Some(env),
        execute_timeout: Some(30),
        framing: Some("jsonl".to_string()),
        name: "docs".to_string(),
        url: None,
    };

    let server = mcp_server_document_from_input(&input).unwrap();

    assert_eq!(
        server.get("command").and_then(|value| value.as_str()),
        Some("npx")
    );
    assert_eq!(
        server
            .get("connect_timeout")
            .and_then(|value| value.as_u64()),
        Some(9)
    );
    assert_eq!(
        server
            .get("execute_timeout")
            .and_then(|value| value.as_u64()),
        Some(30)
    );
    assert_eq!(
        server.get("disabled").and_then(|value| value.as_bool()),
        Some(true)
    );
    assert_eq!(
        server
            .get("env")
            .and_then(|value| value.get("TOKEN"))
            .and_then(|value| value.as_str()),
        Some("abc")
    );
    assert_eq!(
        server
            .get("enabled_tools")
            .and_then(|value| value.as_array())
            .and_then(|items| items.first())
            .and_then(|value| value.as_str()),
        Some("read")
    );
}

#[test]
fn mcp_config_supports_http_and_disabled_servers() {
    let value = serde_json::json!({
        "mcpServers": {
            "http": { "url": "http://localhost:3000/mcp" },
            "off": { "command": "node", "enabled": false }
        }
    });

    let configs = parse_mcp_config(&value).unwrap();
    assert_eq!(configs[0].transport, "http");
    assert!(configs[1].disabled);
}

#[test]
fn mcp_status_snapshot_marks_enabled_servers_missing() {
    let value = serde_json::json!({
        "mcpServers": {
            "http": { "url": "http://localhost:3000/mcp" },
            "off": { "command": "node", "enabled": false }
        }
    });
    let configs = parse_mcp_config(&value).unwrap();

    let snapshot = mcp_snapshot_from_server_configs("mcp.json".to_string(), configs);

    assert!(snapshot.configured);
    assert_eq!(snapshot.servers[0].status, "missing");
    assert_eq!(snapshot.servers[1].status, "disabled");
    assert_eq!(
        snapshot.servers[0].connect_timeout_secs,
        DEFAULT_MCP_TIMEOUT_SECS
    );
}

#[test]
fn mcp_replace_server_snapshot_rebuilds_top_level_collections() {
    let value = serde_json::json!({
        "mcpServers": {
            "docs": { "command": "node" }
        }
    });
    let mut configs = parse_mcp_config(&value).unwrap();
    let config = configs.remove(0);
    let mut snapshot =
        mcp_snapshot_from_server_configs("mcp.json".to_string(), vec![config.clone()]);
    let tool = mcp_tool_from_value(
        "docs",
        0,
        serde_json::json!({ "name": "read", "description": "Read" }),
        &mut HashMap::new(),
    )
    .unwrap();

    replace_mcp_server_snapshot(
        &mut snapshot,
        mcp_server_snapshot_from_config(
            &config,
            "connected",
            None,
            Vec::new(),
            Vec::new(),
            vec![tool],
        ),
    );

    assert_eq!(snapshot.servers[0].status, "connected");
    assert_eq!(snapshot.tools.len(), 1);
    assert_eq!(snapshot.tools[0].qualified_name, "mcp_docs_read");
}

#[test]
fn mcp_mark_server_failed_clears_runtime_snapshot_and_tool_map() {
    let (config, tool) = mcp_test_config_and_tool("docs");
    let prompt = McpPromptDescriptor {
        description: "Prompt".to_string(),
        name: "summarize".to_string(),
        server_name: "docs".to_string(),
    };
    let resource = McpResourceDescriptor {
        description: "Resource".to_string(),
        mime_type: Some("text/plain".to_string()),
        name: "readme".to_string(),
        server_name: "docs".to_string(),
        uri: "file://README.md".to_string(),
    };
    let mut snapshot =
        mcp_snapshot_from_server_configs("mcp.json".to_string(), vec![config.clone()]);
    replace_mcp_server_snapshot(
        &mut snapshot,
        mcp_server_snapshot_from_config(
            &config,
            "connected",
            None,
            vec![prompt],
            vec![resource],
            vec![tool.clone()],
        ),
    );
    let mut manager = McpManager {
        generation: 0,
        snapshot: Some(snapshot),
        servers: HashMap::new(),
        tool_map: HashMap::from([(
            tool.qualified_name.clone(),
            ("docs".to_string(), tool.name.clone()),
        )]),
    };

    mark_mcp_server_failed(&mut manager, "docs", "server crashed".to_string());

    let snapshot = manager.snapshot.as_ref().unwrap();
    assert!(manager.tool_map.is_empty());
    assert_eq!(snapshot.tools.len(), 0);
    assert_eq!(snapshot.resources.len(), 0);
    assert_eq!(snapshot.prompts.len(), 0);
    assert_eq!(snapshot.servers[0].status, "failed");
    assert_eq!(snapshot.servers[0].error.as_deref(), Some("server crashed"));
    assert_eq!(snapshot.servers[0].tool_count, 0);
    assert_eq!(snapshot.servers[0].resource_count, 0);
    assert_eq!(snapshot.servers[0].prompt_count, 0);
}

#[test]
fn mcp_runtime_health_marks_exited_stdio_server_failed() {
    if !node_is_available() {
        return;
    }
    let (config, tool) = mcp_test_config_and_tool("dead");
    let mut snapshot =
        mcp_snapshot_from_server_configs("mcp.json".to_string(), vec![config.clone()]);
    replace_mcp_server_snapshot(
        &mut snapshot,
        mcp_server_snapshot_from_config(
            &config,
            "connected",
            None,
            Vec::new(),
            Vec::new(),
            vec![tool.clone()],
        ),
    );
    let mut child = Command::new("node")
        .args(["-e", "process.exit(7);"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stdout_rx = spawn_mcp_stdout_reader(stdout, McpStdioFraming::Header);
    let mut manager = McpManager {
        generation: 0,
        snapshot: Some(snapshot),
        servers: HashMap::from([(
            "dead".to_string(),
            McpRuntimeServer::Stdio {
                child,
                framing: McpStdioFraming::Header,
                stdin,
                next_id: 0,
                stdout_rx,
                timeout_secs: 1,
            },
        )]),
        tool_map: HashMap::from([(
            tool.qualified_name.clone(),
            ("dead".to_string(), tool.name.clone()),
        )]),
    };

    for _ in 0..50 {
        if refresh_mcp_runtime_health(&mut manager) {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }

    let snapshot = manager.snapshot.as_ref().unwrap();
    assert!(!manager.servers.contains_key("dead"));
    assert!(manager.tool_map.is_empty());
    assert_eq!(snapshot.tools.len(), 0);
    assert_eq!(snapshot.servers[0].status, "failed");
    assert!(
        snapshot.servers[0]
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("MCP server process exited")
    );
}

#[test]
fn mcp_sanitizes_tool_names() {
    assert_eq!(sanitize_mcp_name("Demo Server!"), "demo_server");
    let descriptor = mcp_tool_from_value(
        "Demo Server",
        0,
        serde_json::json!({
            "name": "Read File",
            "description": "Read",
            "inputSchema": { "type": "object" },
            "annotations": { "readOnlyHint": true }
        }),
        &mut HashMap::new(),
    )
    .unwrap();
    assert_eq!(descriptor.qualified_name, "mcp_demo_server_read_file");
    assert_eq!(descriptor.name, "Read File");
    assert_eq!(
        descriptor
            .annotations
            .unwrap()
            .get("readOnlyHint")
            .and_then(|value| value.as_bool()),
        Some(true)
    );
}

#[test]
fn mcp_tool_names_are_unique_after_sanitize() {
    let mut used_names = HashMap::new();
    let first = mcp_tool_from_value(
        "docs",
        0,
        serde_json::json!({ "name": "Read File" }),
        &mut used_names,
    )
    .unwrap();
    let second = mcp_tool_from_value(
        "docs",
        1,
        serde_json::json!({ "name": "read-file" }),
        &mut used_names,
    )
    .unwrap();

    assert_eq!(first.qualified_name, "mcp_docs_read_file");
    assert_eq!(second.qualified_name, "mcp_docs_read_file_2");
    assert_eq!(second.name, "read-file");
}

#[test]
fn mcp_http_url_parser_accepts_http_only() {
    let parsed = parse_http_url("http://127.0.0.1:3000/mcp").unwrap();
    assert_eq!(parsed.host, "127.0.0.1");
    assert_eq!(parsed.port, 3000);
    assert_eq!(parsed.path, "/mcp");
    assert!(parse_http_url("https://example.com/mcp").is_err());
}

#[test]
fn mcp_stdio_mock_server_lists_and_calls_tools() {
    if !node_is_available() {
        return;
    }
    let script = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("test-fixtures")
        .join("mcp-server")
        .join("fake-mcp-server.mjs");
    let config = McpServerConfig {
        args: vec![script.display().to_string()],
        command: Some("node".to_string()),
        connect_timeout_secs: 5,
        disabled: false,
        disabled_tools: Vec::new(),
        enabled_tools: Vec::new(),
        env: HashMap::new(),
        execute_timeout_secs: 5,
        framing: None,
        name: "fake".to_string(),
        transport: "stdio".to_string(),
        url: None,
    };

    let (mut runtime, discovery) = connect_mcp_server(&config).unwrap();

    assert_eq!(discovery.tools.len(), 2);
    assert_eq!(discovery.tools[0].qualified_name, "mcp_fake_read_context");
    assert_eq!(
        discovery.tools[0]
            .annotations
            .as_ref()
            .and_then(|value| value.get("readOnlyHint"))
            .and_then(|value| value.as_bool()),
        Some(true)
    );
    assert_eq!(discovery.tools[1].qualified_name, "mcp_fake_write_note");

    let response = mcp_json_rpc(
        &mut runtime,
        "tools/call",
        serde_json::json!({
            "name": "read_context",
            "arguments": { "topic": "workspace" }
        }),
    )
    .unwrap();
    stop_mcp_runtime(&mut runtime);

    assert_eq!(
        response["result"]["content"][0]["text"].as_str(),
        Some("context:workspace")
    );
    assert_eq!(response["result"]["isError"].as_bool(), Some(false));
}

#[test]
fn mcp_stdio_connect_times_out() {
    if !node_is_available() {
        return;
    }
    let config = McpServerConfig {
        args: vec!["-e".to_string(), "setInterval(() => {}, 1000);".to_string()],
        command: Some("node".to_string()),
        connect_timeout_secs: 1,
        disabled: false,
        disabled_tools: Vec::new(),
        enabled_tools: Vec::new(),
        env: HashMap::new(),
        execute_timeout_secs: 1,
        framing: None,
        name: "hung".to_string(),
        transport: "stdio".to_string(),
        url: None,
    };

    let error = match connect_mcp_server(&config) {
        Ok(_) => panic!("hung MCP server unexpectedly connected"),
        Err(error) => error,
    };

    assert!(error.contains("timed out"));
}

#[test]
fn mcp_stdio_falls_back_to_json_lines() {
    if !node_is_available() {
        return;
    }
    let script = r#"
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.method === 'initialize') {
    console.log(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'jsonl-mcp', version: '0.1.0' }
      }
    }));
    return;
  }
  if (request.method === 'tools/list') {
    console.log(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { tools: [{ name: 'ping', description: 'Ping', inputSchema: {} }] }
    }));
    return;
  }
  console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }));
});
"#;
    let config = McpServerConfig {
        args: vec!["-e".to_string(), script.to_string()],
        command: Some("node".to_string()),
        connect_timeout_secs: 1,
        disabled: false,
        disabled_tools: Vec::new(),
        enabled_tools: Vec::new(),
        env: HashMap::new(),
        execute_timeout_secs: 1,
        framing: Some(McpStdioFraming::JsonLine),
        name: "jsonl".to_string(),
        transport: "stdio".to_string(),
        url: None,
    };

    let (mut runtime, discovery) = connect_mcp_server(&config).unwrap();
    stop_mcp_runtime(&mut runtime);

    assert_eq!(discovery.tools.len(), 1);
    assert_eq!(discovery.tools[0].qualified_name, "mcp_jsonl_ping");
}

#[test]
fn mcp_http_mock_endpoint_lists_and_calls_tools() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = thread::spawn(move || {
        for _ in 0..5 {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_http_json_request(&mut stream);
            let method = request
                .get("method")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            let id = request
                .get("id")
                .cloned()
                .unwrap_or_else(|| serde_json::json!(1));
            let result = match method {
                "initialize" => serde_json::json!({
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "http-fake", "version": "0.1.0" }
                }),
                "tools/list" => serde_json::json!({
                    "tools": [{
                        "name": "read_context",
                        "description": "Read HTTP context",
                        "inputSchema": { "type": "object" },
                        "annotations": { "readOnlyHint": true }
                    }]
                }),
                "tools/call" => serde_json::json!({
                    "content": [{ "type": "text", "text": "http-context" }],
                    "isError": false
                }),
                "resources/list" => serde_json::json!({
                    "resources": [{
                        "uri": "file:///demo.md",
                        "name": "Demo Resource",
                        "description": "Demo resource",
                        "mimeType": "text/markdown"
                    }]
                }),
                "prompts/list" => serde_json::json!({
                    "prompts": [{
                        "name": "summarize",
                        "description": "Summarize resource"
                    }]
                }),
                _ => serde_json::json!({ "unknown": method }),
            };
            write_http_json_response(
                &mut stream,
                &serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": result
                }),
            );
        }
    });
    let config = McpServerConfig {
        args: Vec::new(),
        command: None,
        connect_timeout_secs: 5,
        disabled: false,
        disabled_tools: Vec::new(),
        enabled_tools: Vec::new(),
        env: HashMap::new(),
        execute_timeout_secs: 5,
        framing: None,
        name: "http_fake".to_string(),
        transport: "http".to_string(),
        url: Some(format!("http://127.0.0.1:{port}/mcp")),
    };

    let (mut runtime, discovery) = connect_mcp_server(&config).unwrap();
    let response = mcp_json_rpc(
        &mut runtime,
        "tools/call",
        serde_json::json!({
            "name": "read_context",
            "arguments": {}
        }),
    )
    .unwrap();
    server.join().unwrap();

    assert_eq!(discovery.tools.len(), 1);
    assert_eq!(
        discovery.tools[0].qualified_name,
        "mcp_http_fake_read_context"
    );
    assert_eq!(discovery.resources[0].uri, "file:///demo.md");
    assert_eq!(discovery.prompts[0].name, "summarize");
    assert_eq!(
        response["result"]["content"][0]["text"].as_str(),
        Some("http-context")
    );
}

#[test]
fn mcp_extracts_resource_and_prompt_text() {
    let contents = vec![
        serde_json::json!({ "type": "text", "text": "hello" }),
        serde_json::json!({ "type": "text", "text": "world" }),
    ];
    assert_eq!(mcp_contents_text(&contents), "hello\n\nworld");

    let prompt = serde_json::json!({
        "messages": [
            { "role": "user", "content": { "type": "text", "text": "summarize this" } },
            { "role": "assistant", "content": { "type": "text", "text": "ok" } }
        ]
    });
    assert_eq!(
        mcp_prompt_text(&prompt),
        "user: summarize this\n\nassistant: ok"
    );
}

#[test]
fn session_file_path_rejects_unsafe_thread_ids() {
    let root = make_temp_workspace();

    assert!(session_file_path(&root, "thread-1_ok.2").is_ok());
    assert!(session_file_path(&root, "../escape").is_err());
    assert!(session_file_path(&root, "").is_err());
    assert!(session_file_path(&root, "..").is_err());
}

#[test]
fn session_file_round_trips_jsonl_events() {
    let root = make_temp_workspace();
    let file = session_file_path(&root, "thread-a").unwrap();
    let events = vec![
        session_user_event("thread-a", "turn-a", "run pnpm test", 0),
        serde_json::json!({
            "id": "event-2",
            "seq": 1,
            "threadId": "thread-a",
            "turnId": "turn-a",
            "createdAt": "2026-05-09T00:00:01.000Z",
            "type": "turn_completed"
        }),
    ];

    write_session_file(&file, &events).unwrap();
    let loaded = read_session_file(&file).unwrap();

    assert_eq!(loaded, events);
}

#[test]
fn session_summary_uses_first_user_message_and_last_timestamp() {
    let events = vec![
        serde_json::json!({
            "id": "event-1",
            "seq": 0,
            "threadId": "thread-a",
            "turnId": "turn-a",
            "createdAt": "2026-05-09T00:00:00.000Z",
            "type": "assistant_delta",
            "text": "ignored"
        }),
        session_user_event("thread-a", "turn-a", "  read   README  ", 1),
    ];

    let summary = summarize_session_values("thread-a", &events);

    assert_eq!(summary.thread_id, "thread-a");
    assert_eq!(summary.title, "read README");
    assert_eq!(summary.event_count, 2);
    assert_eq!(summary.updated_at, "2026-05-09T00:00:01.000Z");
    assert_eq!(summary.workspace_path, None);

    let mut workspaces = HashMap::new();
    workspaces.insert("thread-a".to_string(), "/repo/app".to_string());
    let summary =
        summarize_session_values_with_titles("thread-a", &events, &HashMap::new(), &workspaces);
    assert_eq!(summary.workspace_path.as_deref(), Some("/repo/app"));
}

#[test]
fn session_index_round_trips_sorted_summaries() {
    let root = make_temp_workspace();
    let index_file = root.join("session-index.json");
    let summaries = vec![
        SessionSummary {
            thread_id: "thread-old".to_string(),
            title: "Old".to_string(),
            event_count: 1,
            updated_at: "2026-05-09T00:00:01.000Z".to_string(),
            workspace_path: Some("/repo/old".to_string()),
        },
        SessionSummary {
            thread_id: "thread-new".to_string(),
            title: "New".to_string(),
            event_count: 3,
            updated_at: "2026-05-09T00:00:03.000Z".to_string(),
            workspace_path: Some("/repo/new".to_string()),
        },
    ];

    write_session_index_file(&index_file, &summaries).unwrap();
    let loaded = read_session_index_file(&index_file).unwrap();

    assert_eq!(loaded.len(), 2);
    assert_eq!(loaded[0].thread_id, "thread-new");
    assert_eq!(loaded[1].thread_id, "thread-old");
    assert_eq!(loaded[0].workspace_path.as_deref(), Some("/repo/new"));
}

#[test]
fn session_index_filters_invalid_thread_ids() {
    let root = make_temp_workspace();
    let index_file = root.join("session-index.json");
    fs::write(
        &index_file,
        serde_json::json!([
            {
                "threadId": "thread-good",
                "title": "Good",
                "eventCount": 1,
                "updatedAt": "2026-05-09T00:00:02.000Z"
            },
            {
                "threadId": "../bad",
                "title": "Bad",
                "eventCount": 1,
                "updatedAt": "2026-05-09T00:00:03.000Z"
            }
        ])
        .to_string(),
    )
    .unwrap();

    let loaded = read_session_index_file(&index_file).unwrap();

    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].thread_id, "thread-good");
}

#[test]
fn session_transcript_bundle_reads_latest_chunk_only() {
    let root = make_temp_workspace();
    let transcript = serde_json::json!({
        "version": 1,
        "threadId": "thread-transcript",
        "chunkSize": 2,
        "totalItemCount": 3,
        "updatedAt": "2026-05-09T00:00:03.000Z",
        "chunks": [
            {
                "id": "chunk-000000",
                "index": 0,
                "itemCount": 2,
                "items": [
                    { "id": "message:u1", "type": "message", "message": { "id": "u1", "role": "user", "text": "old" } },
                    { "id": "message:a1", "type": "message", "message": { "id": "a1", "role": "assistant", "text": "old" } }
                ]
            },
            {
                "id": "chunk-000001",
                "index": 1,
                "itemCount": 1,
                "items": [
                    { "id": "message:u2", "type": "message", "message": { "id": "u2", "role": "user", "text": "latest" } }
                ]
            }
        ]
    });

    write_session_transcript_bundle(&root, "thread-transcript", &transcript).unwrap();
    let loaded = read_session_transcript_bundle(&root, "thread-transcript")
        .unwrap()
        .unwrap();

    assert_eq!(loaded["totalItemCount"], 3);
    let chunks = loaded["chunks"].as_array().unwrap();
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0]["id"], "chunk-000001");
    assert_eq!(chunks[0]["items"][0]["message"]["text"], "latest");
    let earlier = read_session_transcript_chunk(&root, "thread-transcript", 0)
        .unwrap()
        .unwrap();
    let earlier_chunks = earlier["chunks"].as_array().unwrap();
    assert_eq!(earlier_chunks.len(), 1);
    assert_eq!(earlier_chunks[0]["id"], "chunk-000000");
    assert_eq!(earlier_chunks[0]["items"][0]["message"]["text"], "old");
    assert!(root.join("thread-transcript").join("index.json").exists());
    assert!(
        root.join("thread-transcript")
            .join("chunk-000000.json")
            .exists()
    );
    assert!(
        root.join("thread-transcript")
            .join("chunk-000001.json")
            .exists()
    );
}

#[test]
fn artifact_file_store_round_trips_records() {
    let root = make_temp_workspace();

    let metadata = write_artifact(
        &root,
        "shell-log",
        "stdout\nok\n",
        "test output",
        Some("call-1".to_string()),
    )
    .unwrap();
    let artifacts = list_artifacts(&root).unwrap();
    let record = read_artifact(&root, &metadata.id).unwrap();

    assert_eq!(artifacts.len(), 1);
    assert_eq!(artifacts[0].id, metadata.id);
    assert_eq!(record.id, metadata.id);
    assert_eq!(record.artifact_type, "shell-log");
    assert_eq!(record.size, 10);
    assert!(record.created_at.contains('T'));
    assert!(record.created_at.ends_with('Z'));
    assert_eq!(record.summary, "test output");
    assert_eq!(record.source_call_id.as_deref(), Some("call-1"));
    assert_eq!(record.content, "stdout\nok\n");
}

#[test]
fn artifact_paths_reject_unsafe_ids() {
    let root = make_temp_workspace();

    assert!(artifact_metadata_path(&root, "artifact-abc_123").is_ok());
    assert!(artifact_metadata_path(&root, "../artifact-abc").is_err());
    assert!(artifact_metadata_path(&root, "not-artifact").is_err());
}

#[test]
fn artifact_write_rejects_unknown_type() {
    let root = make_temp_workspace();

    let result = write_artifact(&root, "unknown", "content", "summary", None);

    assert!(result.is_err());
}

#[test]
fn snapshot_file_store_round_trips_records() {
    let root = make_temp_workspace();
    let snapshot = serde_json::json!({
        "id": "snapshot-turn-1",
        "threadId": "thread-1",
        "turnId": "turn-1",
        "workspacePath": "/workspace",
        "createdAt": "2026-05-11T00:00:00.000Z",
        "files": [{
            "path": "note.txt",
            "changeKind": "updated",
            "existedBefore": true,
            "beforeContentRef": "snapshot-turn-1/0/before.txt",
            "afterContentRef": "snapshot-turn-1/0/after.txt",
            "additions": 1,
            "deletions": 1,
            "diffRef": "snapshot-turn-1/0/diff.patch",
            "beforeContent": "before",
            "afterContent": "after",
            "diff": "--- a/note.txt\n+++ b/note.txt\n-before\n+after"
        }]
    });
    let path = snapshot_file_path(&root, "snapshot-turn-1").unwrap();

    write_snapshot_file(&path, &snapshot).unwrap();
    let loaded = read_snapshot_file(&path).unwrap();

    assert_eq!(loaded, snapshot);
}

#[test]
fn snapshot_paths_reject_unsafe_ids() {
    let root = make_temp_workspace();

    assert!(snapshot_file_path(&root, "snapshot-abc_123").is_ok());
    assert!(snapshot_file_path(&root, "../snapshot-abc").is_err());
    assert!(snapshot_file_path(&root, "artifact-abc").is_err());
}

#[test]
fn side_snapshot_restore_reverts_workspace_without_touching_git_dir() {
    let workspace = make_temp_workspace();
    let snapshot_tree = make_temp_workspace();
    fs::create_dir(workspace.join(".git")).unwrap();
    fs::write(workspace.join(".git").join("HEAD"), "main").unwrap();
    fs::write(workspace.join("keep.txt"), "before").unwrap();
    fs::write(workspace.join("added.txt"), "after").unwrap();
    fs::write(snapshot_tree.join("keep.txt"), "before").unwrap();

    let mut restored_files = Vec::new();
    let mut failures = Vec::new();
    restore_workspace_from_tree(
        &workspace,
        &snapshot_tree,
        &mut restored_files,
        &mut failures,
    );

    assert!(failures.is_empty());
    assert_eq!(
        fs::read_to_string(workspace.join("keep.txt")).unwrap(),
        "before"
    );
    assert!(!workspace.join("added.txt").exists());
    assert_eq!(
        fs::read_to_string(workspace.join(".git").join("HEAD")).unwrap(),
        "main"
    );
}

#[test]
fn side_git_snapshot_commits_thread_branch_and_restores_commit() {
    if !git_is_available() {
        return;
    }

    let workspace = make_temp_workspace();
    let repo_dir = make_temp_workspace();
    fs::create_dir(workspace.join(".git")).unwrap();
    fs::write(workspace.join(".git").join("HEAD"), "main").unwrap();
    fs::write(workspace.join("keep.txt"), "before").unwrap();

    let pre = create_side_git_snapshot_at(
        &repo_dir,
        &workspace,
        "side-snapshot-turn-1-pre",
        "thread/one",
        "turn-1",
        "pre-turn",
    )
    .unwrap();
    assert_eq!(pre.branch, "thread-thread-one");
    assert!(is_valid_side_git_commit(&pre.commit));

    fs::write(workspace.join("keep.txt"), "after").unwrap();
    fs::write(workspace.join("added.txt"), "after").unwrap();
    let post = create_side_git_snapshot_at(
        &repo_dir,
        &workspace,
        "side-snapshot-turn-1-post",
        "thread/one",
        "turn-1",
        "post-turn",
    )
    .unwrap();
    assert_eq!(post.branch, pre.branch);
    assert_ne!(post.commit, pre.commit);

    fs::write(workspace.join("keep.txt"), "current").unwrap();
    fs::write(workspace.join("stray.txt"), "current").unwrap();
    let restored = restore_side_git_commit(&repo_dir, &pre.commit, &workspace).unwrap();

    assert!(restored.iter().any(|path| path == "keep.txt"));
    assert_eq!(
        fs::read_to_string(workspace.join("keep.txt")).unwrap(),
        "before"
    );
    assert!(!workspace.join("added.txt").exists());
    assert!(!workspace.join("stray.txt").exists());
    assert_eq!(
        fs::read_to_string(workspace.join(".git").join("HEAD")).unwrap(),
        "main"
    );
}

#[test]
fn shell_invocation_uses_platform_shell() {
    let invocation = shell_invocation("echo ok");
    #[cfg(windows)]
    {
        assert_eq!(invocation.program, "cmd.exe");
        assert_eq!(
            invocation.args,
            vec!["/C".to_string(), "echo ok".to_string()]
        );
    }
    #[cfg(not(windows))]
    {
        assert_eq!(invocation.program, "sh");
        assert_eq!(
            invocation.args,
            vec!["-lc".to_string(), "echo ok".to_string()]
        );
    }
}

#[test]
fn process_run_executes_program_without_shell() {
    let root = make_temp_workspace();
    let result = run_process(
        &root,
        ProcessRunInput {
            workspace_path: root.display().to_string(),
            program: "rustc".to_string(),
            args: vec!["--version".to_string()],
            stdin: None,
            sandbox_policy: None,
            timeout_ms: 5_000,
        },
    )
    .unwrap();

    assert_eq!(result.exit_code, Some(0));
    assert!(result.stdout.contains("rustc"));
    assert_eq!(result.program, "rustc");
    assert_eq!(result.args, vec!["--version"]);
}

#[test]
fn process_run_reports_sandbox_metadata_when_enabled() {
    let root = make_temp_workspace();
    let result = run_process(
        &root,
        ProcessRunInput {
            workspace_path: root.display().to_string(),
            program: "rustc".to_string(),
            args: vec!["--version".to_string()],
            stdin: None,
            sandbox_policy: Some(SandboxPolicy {
                enabled: true,
                env_mode: SandboxEnvironmentMode::Minimal,
                allow_network: false,
                allow_read_outside_workspace: false,
                allow_write_workspace: false,
            }),
            timeout_ms: 5_000,
        },
    )
    .unwrap();

    assert_eq!(result.exit_code, Some(0));
    assert!(
        result
            .sandbox
            .as_ref()
            .is_some_and(|sandbox| sandbox.enabled)
    );
    assert_eq!(
        result.sandbox.as_ref().map(|sandbox| sandbox.env_mode),
        Some(SandboxEnvironmentMode::Minimal)
    );
}

#[test]
fn process_run_reports_missing_program() {
    let root = make_temp_workspace();
    let result = run_process(
        &root,
        ProcessRunInput {
            workspace_path: root.display().to_string(),
            program: "ore-code-definitely-missing-command".to_string(),
            args: Vec::new(),
            stdin: None,
            sandbox_policy: None,
            timeout_ms: 5_000,
        },
    );

    assert!(result.is_err());
}

fn mcp_test_config_and_tool(name: &str) -> (McpServerConfig, McpToolDescriptor) {
    let config = McpServerConfig {
        args: Vec::new(),
        command: Some("node".to_string()),
        connect_timeout_secs: DEFAULT_MCP_TIMEOUT_SECS,
        disabled: false,
        disabled_tools: Vec::new(),
        enabled_tools: Vec::new(),
        env: HashMap::new(),
        execute_timeout_secs: DEFAULT_MCP_TIMEOUT_SECS,
        framing: Some(McpStdioFraming::Header),
        name: name.to_string(),
        transport: "stdio".to_string(),
        url: None,
    };
    let tool = mcp_tool_from_value(
        name,
        0,
        serde_json::json!({ "name": "read", "description": "Read" }),
        &mut HashMap::new(),
    )
    .unwrap();
    (config, tool)
}

fn stop_mcp_runtime(runtime: &mut McpRuntimeServer) {
    if let McpRuntimeServer::Stdio { child, .. } = runtime {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn read_http_json_request(stream: &mut TcpStream) -> serde_json::Value {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];
    loop {
        let read = stream.read(&mut chunk).unwrap();
        assert!(read > 0, "HTTP MCP test server received an empty request");
        buffer.extend_from_slice(&chunk[..read]);
        if let Some((body_start, content_length)) = http_request_body_start_and_len(&buffer) {
            if buffer.len() >= body_start + content_length {
                return serde_json::from_slice(&buffer[body_start..body_start + content_length])
                    .unwrap();
            }
        }
    }
}

fn http_request_body_start_and_len(buffer: &[u8]) -> Option<(usize, usize)> {
    let header_end = buffer.windows(4).position(|window| window == b"\r\n\r\n")?;
    let headers = String::from_utf8_lossy(&buffer[..header_end]);
    let content_length = headers
        .lines()
        .find_map(|line| line.strip_prefix("Content-Length:"))
        .and_then(|value| value.trim().parse::<usize>().ok())?;
    Some((header_end + 4, content_length))
}

fn write_http_json_response(stream: &mut TcpStream, value: &serde_json::Value) {
    let body = serde_json::to_string(value).unwrap();
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream.write_all(response.as_bytes()).unwrap();
}

fn make_temp_workspace() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let count = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "ore-code-test-{}-{nanos}-{count}",
        std::process::id()
    ));
    fs::create_dir(&root).unwrap();
    root
}

fn local_datetime_rfc3339(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> String {
    let local = match Local.with_ymd_and_hms(year, month, day, hour, minute, 0) {
        chrono::LocalResult::Single(value) => value,
        chrono::LocalResult::Ambiguous(earliest, _) => earliest,
        chrono::LocalResult::None => panic!("invalid local datetime"),
    };
    local
        .with_timezone(&Utc)
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn git_is_available() -> bool {
    Command::new("git").arg("--version").output().is_ok()
}

fn node_is_available() -> bool {
    Command::new("node").arg("--version").output().is_ok()
}

fn init_git_repo(root: &Path) {
    run_git_test_command(root, &["init"]);
}

fn configure_git_identity(root: &Path) {
    run_git_test_command(root, &["config", "user.email", "ore-code@example.test"]);
    run_git_test_command(root, &["config", "user.name", "Ore Code Test"]);
}

fn run_git_test_command(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .unwrap_or_else(|error| panic!("failed to run git {args:?}: {error}"));
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[cfg(windows)]
fn pwd_command() -> &'static str {
    "cd"
}

#[cfg(not(windows))]
fn pwd_command() -> &'static str {
    "pwd"
}

#[cfg(windows)]
fn output_and_exit_command() -> &'static str {
    "echo out && echo err 1>&2 && exit /B 7"
}

#[cfg(not(windows))]
fn output_and_exit_command() -> &'static str {
    "echo out && echo err >&2 && exit 7"
}

#[cfg(windows)]
fn slow_command() -> &'static str {
    "ping -n 3 127.0.0.1 >NUL"
}

#[cfg(not(windows))]
fn slow_command() -> &'static str {
    "sleep 2"
}

fn wait_for_shell_job(
    store: &ShellJobStore,
    job_id: &str,
    expected_status: &str,
) -> ShellJobSnapshot {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let snapshot = {
            let jobs = store.jobs.lock().unwrap();
            shell_job_snapshot(jobs.get(job_id).unwrap())
        };

        if snapshot.status == expected_status {
            return snapshot;
        }

        if Instant::now() >= deadline {
            panic!("shell job {job_id} did not reach status {expected_status}");
        }

        thread::sleep(Duration::from_millis(10));
    }
}

fn session_user_event(thread_id: &str, turn_id: &str, text: &str, seq: usize) -> serde_json::Value {
    serde_json::json!({
        "id": format!("event-{seq}"),
        "seq": seq,
        "threadId": thread_id,
        "turnId": turn_id,
        "createdAt": format!("2026-05-09T00:00:0{seq}.000Z"),
        "type": "user_message",
        "text": text
    })
}
