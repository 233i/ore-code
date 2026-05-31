use super::*;

pub(crate) fn automation_state_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("automation-state.json"))
}

pub(crate) fn durable_task_state_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("durable-tasks.json"))
}

pub(crate) fn read_json_file_or_default(
    path: &Path,
    default_value: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if !path.exists() {
        return Ok(default_value);
    }
    fs::read_to_string(path)
        .map_err(|error| error.to_string())
        .and_then(|content| serde_json::from_str(&content).map_err(|error| error.to_string()))
}

pub(crate) fn write_json_file(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

pub(crate) fn start_automation_daemon(app: tauri::AppHandle) {
    thread::spawn(move || {
        loop {
            if let Err(error) = automation_daemon_tick(&app) {
                eprintln!("automation daemon tick failed: {error}");
            }
            thread::sleep(Duration::from_secs(AUTOMATION_DAEMON_INTERVAL_SECS));
        }
    });
}

pub(crate) fn automation_daemon_tick(app: &tauri::AppHandle) -> Result<usize, String> {
    let automation_path = automation_state_file(app)?;
    let task_path = durable_task_state_file(app)?;
    let mut automation_state = read_json_file_or_default(
        &automation_path,
        serde_json::json!({ "automations": [], "runs": [] }),
    )?;
    let mut task_state = read_json_file_or_default(&task_path, serde_json::json!({ "tasks": [] }))?;
    let now = Utc::now();
    let mut queued = 0;

    let mut runs = automation_state
        .get("runs")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let Some(automations) = automation_state
        .get_mut("automations")
        .and_then(|value| value.as_array_mut())
    else {
        return Ok(0);
    };

    for automation in automations.iter_mut() {
        if automation.get("status").and_then(|value| value.as_str()) != Some("active") {
            continue;
        }
        let Some(next_run_at) = automation
            .get("nextRunAt")
            .and_then(|value| value.as_str())
            .map(ToString::to_string)
        else {
            continue;
        };
        let due_at = chrono::DateTime::parse_from_rfc3339(&next_run_at)
            .map_err(|error| error.to_string())?
            .with_timezone(&Utc);
        if due_at > now {
            continue;
        }
        let automation_id = automation
            .get("id")
            .and_then(|value| value.as_str())
            .unwrap_or("automation");
        let already_ran = runs.iter().any(|run| {
            run.get("automationId").and_then(|value| value.as_str()) == Some(automation_id)
                && run.get("scheduledFor").and_then(|value| value.as_str())
                    == Some(next_run_at.as_str())
        });
        if already_ran {
            set_json_string(
                automation,
                "nextRunAt",
                next_run_after_rrule(
                    automation
                        .get("rrule")
                        .and_then(|value| value.as_str())
                        .unwrap_or("FREQ=HOURLY;INTERVAL=1"),
                    due_at,
                ),
            );
            continue;
        }

        let now_text = now.to_rfc3339_opts(SecondsFormat::Millis, true);
        let task_id = format!("task-{}", pseudo_id("automation-task"));
        let run_id = format!("automation-run-{}", pseudo_id("automation-run"));
        let name = automation
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("Automation");
        let prompt = automation
            .get("prompt")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        append_queued_task(
            &mut task_state,
            &task_id,
            &format!("Automation: {name}"),
            prompt,
            &now_text,
        )?;
        runs.insert(
            0,
            serde_json::json!({
                "schemaVersion": 1,
                "id": run_id,
                "automationId": automation_id,
                "scheduledFor": next_run_at,
                "status": "running",
                "createdAt": now_text,
                "startedAt": now_text,
                "taskId": task_id
            }),
        );
        set_json_string(automation, "lastRunAt", now_text.clone());
        set_json_string(automation, "updatedAt", now_text);
        set_json_string(
            automation,
            "nextRunAt",
            next_run_after_rrule(
                automation
                    .get("rrule")
                    .and_then(|value| value.as_str())
                    .unwrap_or("FREQ=HOURLY;INTERVAL=1"),
                due_at,
            ),
        );
        queued += 1;
    }

    if queued > 0 {
        automation_state["runs"] = serde_json::Value::Array(runs);
        write_json_file(&automation_path, &automation_state)?;
        write_json_file(&task_path, &task_state)?;
    }

    Ok(queued)
}

pub(crate) fn append_queued_task(
    state: &mut serde_json::Value,
    task_id: &str,
    title: &str,
    prompt: &str,
    now: &str,
) -> Result<(), String> {
    if !state.is_object() {
        *state = serde_json::json!({ "tasks": [] });
    }
    let root = state
        .as_object_mut()
        .ok_or_else(|| "durable task state must be an object".to_string())?;
    let tasks = root
        .entry("tasks".to_string())
        .or_insert_with(|| serde_json::json!([]))
        .as_array_mut()
        .ok_or_else(|| "durable task state tasks must be an array".to_string())?;
    tasks.push(serde_json::json!({
        "id": task_id,
        "title": title,
        "prompt": prompt,
        "status": "queued",
        "createdAt": now,
        "updatedAt": now,
        "checklist": [],
        "gates": [],
        "artifacts": [],
        "prAttempts": [],
        "timeline": [{
            "id": 1,
            "type": "task",
            "message": "Task created by automation daemon.",
            "createdAt": now
        }]
    }));
    root.insert(
        "activeTaskId".to_string(),
        serde_json::Value::String(task_id.to_string()),
    );
    Ok(())
}

pub(crate) fn next_run_after_rrule(rrule: &str, after: chrono::DateTime<Utc>) -> String {
    let parts: HashMap<String, String> = rrule
        .split(';')
        .filter_map(|part| {
            part.split_once('=')
                .map(|(key, value)| (key.to_ascii_uppercase(), value.to_ascii_uppercase()))
        })
        .collect();
    if parts.get("FREQ").map(String::as_str) == Some("WEEKLY") {
        let after_local = after.with_timezone(&Local);
        let hour = parts
            .get("BYHOUR")
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(9);
        let minute = parts
            .get("BYMINUTE")
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(0);
        let byday: Vec<String> = parts
            .get("BYDAY")
            .map(|value| {
                value
                    .split(',')
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string)
                    .collect()
            })
            .unwrap_or_else(|| vec![weekday_token(after_local.weekday()).to_string()]);

        for day_offset in 0..15 {
            let date = after_local.date_naive() + chrono::Duration::days(day_offset);
            let Some(naive) = date.and_hms_opt(hour.min(23), minute.min(59), 0) else {
                continue;
            };
            let Some(candidate_local) = Local.from_local_datetime(&naive).earliest() else {
                continue;
            };
            let candidate = candidate_local.with_timezone(&Utc);
            if candidate > after
                && byday
                    .iter()
                    .any(|day| day == weekday_token(candidate_local.weekday()))
            {
                return candidate.to_rfc3339_opts(SecondsFormat::Millis, true);
            }
        }

        return (after + chrono::Duration::weeks(1)).to_rfc3339_opts(SecondsFormat::Millis, true);
    }
    let interval = parts
        .get("INTERVAL")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(1)
        .max(1);
    (after + chrono::Duration::hours(interval)).to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub(crate) fn weekday_token(weekday: chrono::Weekday) -> &'static str {
    match weekday {
        chrono::Weekday::Mon => "MO",
        chrono::Weekday::Tue => "TU",
        chrono::Weekday::Wed => "WE",
        chrono::Weekday::Thu => "TH",
        chrono::Weekday::Fri => "FR",
        chrono::Weekday::Sat => "SA",
        chrono::Weekday::Sun => "SU",
    }
}

pub(crate) fn set_json_string(value: &mut serde_json::Value, key: &str, next: String) {
    if let Some(object) = value.as_object_mut() {
        object.insert(key.to_string(), serde_json::Value::String(next));
    }
}

pub(crate) fn pseudo_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{prefix}-{nanos}")
}
