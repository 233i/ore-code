use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebFetchResult {
    pub(crate) url: String,
    pub(crate) final_url: String,
    pub(crate) status: u16,
    pub(crate) content_type: Option<String>,
    pub(crate) body: String,
    pub(crate) truncated: bool,
}

#[tauri::command]
pub(crate) async fn web_fetch_url(
    url: String,
    timeout_ms: Option<u64>,
    max_bytes: Option<usize>,
) -> Result<WebFetchResult, String> {
    fetch_url_with_http_client(
        &url,
        timeout_ms.unwrap_or(20_000),
        max_bytes.unwrap_or(500_000),
    )
    .await
}

pub(crate) async fn fetch_url_with_http_client(
    url: &str,
    timeout_ms: u64,
    max_bytes: usize,
) -> Result<WebFetchResult, String> {
    validate_web_url(url)?;
    let max_bytes = max_bytes.clamp(1_024, 2_000_000);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_millis(timeout_ms.clamp(1_000, 60_000)))
        .user_agent("Ore Code/0.1")
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(url)
        .header(
            reqwest::header::ACCEPT,
            "text/html,text/plain,application/json;q=0.8,*/*;q=0.5",
        )
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string);
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    let truncated = bytes.len() > max_bytes;
    let body_bytes = if truncated {
        &bytes[..max_bytes]
    } else {
        &bytes
    };

    Ok(WebFetchResult {
        url: url.to_string(),
        final_url,
        status,
        content_type,
        body: String::from_utf8_lossy(body_bytes).to_string(),
        truncated,
    })
}

pub(crate) fn validate_web_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.len() > 2048 || trimmed.chars().any(|character| character.is_control()) {
        return Err("invalid URL".to_string());
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("only http(s) URLs are supported".to_string());
    }
    Ok(())
}
