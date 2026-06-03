use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderSecretStatus {
    pub(crate) provider: String,
    pub(crate) source: String,
    pub(crate) has_secret: bool,
    pub(crate) last4: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderSecretValue {
    pub(crate) provider: String,
    pub(crate) value: String,
    pub(crate) last4: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigSourceStatus {
    pub(crate) scope: String,
    pub(crate) path: String,
    pub(crate) status: String,
    pub(crate) content: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigEnvStatus {
    pub(crate) name: String,
    pub(crate) present: bool,
    pub(crate) value: Option<String>,
    pub(crate) last4: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OreCodeConfigStatus {
    pub(crate) sources: Vec<ConfigSourceStatus>,
    pub(crate) env: Vec<ConfigEnvStatus>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigEnvSecretValue {
    pub(crate) name: String,
    pub(crate) value: String,
    pub(crate) last4: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppSettingsDocument {
    pub(crate) settings: serde_json::Value,
}

#[tauri::command]
pub(crate) fn provider_secret_status(provider: String) -> Result<ProviderSecretStatus, String> {
    let provider = normalize_provider(&provider)?;
    match read_provider_secret(&provider) {
        Ok(value) => Ok(secret_status(&provider, Some(&value))),
        Err(keyring_core::Error::NoEntry) => Ok(secret_status(&provider, None)),
        Err(error) => Err(secret_error(error)),
    }
}

#[tauri::command]
pub(crate) fn provider_secret_get(provider: String) -> Result<ProviderSecretValue, String> {
    let provider = normalize_provider(&provider)?;
    let value = read_provider_secret(&provider).map_err(secret_error)?;
    Ok(ProviderSecretValue {
        provider,
        last4: secret_last4(&value),
        value,
    })
}

#[tauri::command]
pub(crate) fn provider_secret_set(
    provider: String,
    value: String,
) -> Result<ProviderSecretStatus, String> {
    let provider = normalize_provider(&provider)?;
    let value = value.trim();
    if value.is_empty() {
        return Err("secret value must not be empty".to_string());
    }

    ensure_keyring_store()?;
    keyring_entry(&provider)
        .map_err(secret_error)?
        .set_password(value)
        .map_err(secret_error)?;

    Ok(secret_status(&provider, Some(value)))
}

#[tauri::command]
pub(crate) fn provider_secret_delete(provider: String) -> Result<ProviderSecretStatus, String> {
    let provider = normalize_provider(&provider)?;
    ensure_keyring_store()?;
    match keyring_entry(&provider)
        .map_err(secret_error)?
        .delete_credential()
    {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(secret_status(&provider, None)),
        Err(error) => Err(secret_error(error)),
    }
}

#[tauri::command]
pub(crate) fn app_settings_read(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    read_app_settings_file(&app_settings_file(&app)?)
}

#[tauri::command]
pub(crate) fn app_settings_write(
    app: tauri::AppHandle,
    settings: serde_json::Value,
) -> Result<serde_json::Value, String> {
    write_app_settings_file(&app_settings_file(&app)?, settings)
}

#[tauri::command]
pub(crate) fn ore_code_config_status(
    app: tauri::AppHandle,
    workspace_path: String,
) -> Result<OreCodeConfigStatus, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let workspace = canonicalize_workspace_or_raw(&workspace_path);
    let sources = vec![
        read_config_source("global", home.join(".ore-code").join("config.toml")),
        read_config_source("project", workspace.join(".ore-code").join("config.toml")),
    ];

    Ok(OreCodeConfigStatus {
        sources,
        env: config_env_statuses(&[
            "ORE_CODE_PROFILE",
            "ORE_CODE_PROVIDER",
            "ORE_CODE_MODEL",
            "ORE_CODE_BASE_URL",
            "ORE_CODE_DEEPSEEK_MODEL_MODE",
            "ORE_CODE_DEEPSEEK_THINKING",
            "DEEPSEEK_API_KEY",
        ]),
    })
}

#[tauri::command]
pub(crate) fn ore_code_config_env_secret_get(name: String) -> Result<ConfigEnvSecretValue, String> {
    let normalized = validate_env_name(&name)?;
    let value = env::var(&normalized)
        .map_err(|_| format!("environment variable {normalized} is not set"))?;
    Ok(ConfigEnvSecretValue {
        name: normalized,
        last4: secret_last4(&value),
        value,
    })
}

pub(crate) fn app_settings_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("settings.json"))
}

pub(crate) fn read_app_settings_file(path: &Path) -> Result<serde_json::Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let document: AppSettingsDocument =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;
    Ok(document.settings)
}

pub(crate) fn write_app_settings_file(
    path: &Path,
    settings: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if settings_contains_secret_key(&settings) {
        return Err("app settings must not contain secrets".to_string());
    }

    let parent = path
        .parent()
        .ok_or_else(|| "settings file has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let document = AppSettingsDocument {
        settings: settings.clone(),
    };
    let content = serde_json::to_string_pretty(&document).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())?;
    Ok(settings)
}

pub(crate) fn settings_contains_secret_key(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(map) => map.iter().any(|(key, child)| {
            let normalized = key.to_ascii_lowercase().replace(['_', '-'], "");
            normalized.contains("apikey")
                || normalized.contains("secret")
                || normalized.contains("token")
                || normalized.contains("password")
                || settings_contains_secret_key(child)
        }),
        serde_json::Value::Array(items) => items.iter().any(settings_contains_secret_key),
        _ => false,
    }
}

pub(crate) fn read_config_source(scope: &str, path: PathBuf) -> ConfigSourceStatus {
    let path_text = path.display().to_string();
    if !path.exists() {
        return ConfigSourceStatus {
            scope: scope.to_string(),
            path: path_text,
            status: "missing".to_string(),
            content: None,
            error: None,
        };
    }

    match fs::read_to_string(&path) {
        Ok(content) => ConfigSourceStatus {
            scope: scope.to_string(),
            path: path_text,
            status: "loaded".to_string(),
            content: Some(content),
            error: None,
        },
        Err(error) => ConfigSourceStatus {
            scope: scope.to_string(),
            path: path_text,
            status: "error".to_string(),
            content: None,
            error: Some(error.to_string()),
        },
    }
}

pub(crate) fn canonicalize_workspace_or_raw(path: &str) -> PathBuf {
    canonicalize_workspace(path).unwrap_or_else(|_| PathBuf::from(path))
}

pub(crate) fn config_env_statuses(names: &[&str]) -> Vec<ConfigEnvStatus> {
    names
        .iter()
        .map(|name| {
            let value = env::var(name).ok();
            let is_secret = name.to_ascii_lowercase().contains("key")
                || name.to_ascii_lowercase().contains("secret")
                || name.to_ascii_lowercase().contains("token");
            ConfigEnvStatus {
                name: (*name).to_string(),
                present: value.is_some(),
                value: if is_secret { None } else { value.clone() },
                last4: value.as_deref().and_then(secret_last4),
            }
        })
        .collect()
}

pub(crate) fn validate_env_name(name: &str) -> Result<String, String> {
    let normalized = name.trim();
    if normalized.is_empty()
        || normalized.len() > 128
        || !normalized.chars().all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
        })
    {
        return Err("invalid environment variable name".to_string());
    }
    Ok(normalized.to_string())
}

pub(crate) fn read_provider_secret(provider: &str) -> keyring_core::Result<String> {
    ensure_keyring_store()
        .map_err(|error| keyring_core::Error::Invalid("store".to_string(), error))?;
    keyring_entry(provider)?.get_password()
}

pub(crate) fn keyring_entry(provider: &str) -> keyring_core::Result<keyring_core::Entry> {
    keyring_core::Entry::new(SECRET_SERVICE, &provider_secret_account(provider))
}

pub(crate) fn ensure_keyring_store() -> Result<(), String> {
    static STORE_INIT: OnceLock<Result<(), String>> = OnceLock::new();
    STORE_INIT.get_or_init(configure_keyring_store).clone()
}

#[cfg(target_os = "macos")]
pub(crate) fn configure_keyring_store() -> Result<(), String> {
    keyring_core::set_default_store(
        apple_native_keyring_store::keychain::Store::new().map_err(secret_error)?,
    );
    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn configure_keyring_store() -> Result<(), String> {
    keyring_core::set_default_store(
        windows_native_keyring_store::Store::new().map_err(secret_error)?,
    );
    Ok(())
}

#[cfg(target_os = "linux")]
pub(crate) fn configure_keyring_store() -> Result<(), String> {
    keyring_core::set_default_store(
        zbus_secret_service_keyring_store::Store::new().map_err(secret_error)?,
    );
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub(crate) fn configure_keyring_store() -> Result<(), String> {
    Err(
        "provider secret storage is currently supported on macOS, Windows, and Linux only"
            .to_string(),
    )
}

pub(crate) fn normalize_provider(provider: &str) -> Result<String, String> {
    let provider = provider.trim().to_lowercase();
    if !provider.is_empty()
        && provider.len() <= 64
        && provider.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        Ok(provider)
    } else {
        Err(format!("unsupported provider secret: {provider}"))
    }
}

pub(crate) fn provider_secret_account(provider: &str) -> String {
    format!("provider:{provider}:api-key")
}

pub(crate) fn secret_status(provider: &str, value: Option<&str>) -> ProviderSecretStatus {
    ProviderSecretStatus {
        provider: provider.to_string(),
        source: if value.is_some() {
            secret_source()
        } else {
            "missing"
        }
        .to_string(),
        has_secret: value.is_some(),
        last4: value.and_then(secret_last4),
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn secret_source() -> &'static str {
    "keychain"
}

#[cfg(target_os = "windows")]
pub(crate) fn secret_source() -> &'static str {
    "credential-manager"
}

#[cfg(target_os = "linux")]
pub(crate) fn secret_source() -> &'static str {
    "secret-service"
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub(crate) fn secret_source() -> &'static str {
    "unsupported"
}

pub(crate) fn secret_last4(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let chars: Vec<char> = trimmed.chars().collect();
    let start = chars.len().saturating_sub(4);
    Some(chars[start..].iter().collect())
}

pub(crate) fn secret_error(error: keyring_core::Error) -> String {
    error.to_string()
}
