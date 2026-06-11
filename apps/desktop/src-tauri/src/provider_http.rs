use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderHttpRequest {
    pub(crate) url: String,
    pub(crate) headers: HashMap<String, String>,
    pub(crate) body: String,
    pub(crate) timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderHttpStreamRequest {
    pub(crate) stream_id: String,
    pub(crate) url: String,
    pub(crate) headers: HashMap<String, String>,
    pub(crate) body: String,
    pub(crate) timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderHttpResponse {
    pub(crate) status: u16,
    pub(crate) status_text: String,
    pub(crate) body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderHttpStreamResponse {
    pub(crate) status: u16,
    pub(crate) status_text: String,
    pub(crate) streaming: bool,
    pub(crate) body: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderHttpStreamEvent {
    pub(crate) stream_id: String,
    pub(crate) kind: String,
    pub(crate) bytes: Option<Vec<u8>>,
    pub(crate) error: Option<String>,
}

#[tauri::command]
pub(crate) async fn provider_http_request(
    request: ProviderHttpRequest,
) -> Result<ProviderHttpResponse, String> {
    provider_http_request_with_client(request).await
}

pub(crate) async fn provider_http_request_with_client(
    request: ProviderHttpRequest,
) -> Result<ProviderHttpResponse, String> {
    let response = send_provider_http_request(request).await?;
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let body = response.text().await.map_err(|error| error.to_string())?;

    Ok(ProviderHttpResponse {
        status: status.as_u16(),
        status_text,
        body,
    })
}

#[tauri::command]
pub(crate) async fn provider_http_stream(
    app: tauri::AppHandle,
    request: ProviderHttpStreamRequest,
) -> Result<ProviderHttpStreamResponse, String> {
    let stream_id = request.stream_id.clone();
    let response = send_provider_http_request(request.into_provider_request()).await?;
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();

    if !status.is_success() {
        let body = response.text().await.map_err(|error| error.to_string())?;
        return Ok(ProviderHttpStreamResponse {
            status: status.as_u16(),
            status_text,
            streaming: false,
            body: Some(body),
        });
    }

    tauri::async_runtime::spawn(async move {
        stream_provider_http_response(app, stream_id, response).await;
    });

    Ok(ProviderHttpStreamResponse {
        status: status.as_u16(),
        status_text,
        streaming: true,
        body: None,
    })
}

async fn send_provider_http_request(
    request: ProviderHttpRequest,
) -> Result<reqwest::Response, String> {
    web_fetch::validate_web_url(&request.url)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_millis(
            request.timeout_ms.unwrap_or(600_000).clamp(1_000, 900_000),
        ))
        .user_agent("Ore Code/0.1")
        .build()
        .map_err(|error| error.to_string())?;
    let mut builder = client.post(&request.url);
    for (name, value) in request.headers {
        let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("invalid header name {name}: {error}"))?;
        let header_value = reqwest::header::HeaderValue::from_str(&value)
            .map_err(|error| format!("invalid header value for {name}: {error}"))?;
        builder = builder.header(header_name, header_value);
    }
    builder
        .body(request.body)
        .send()
        .await
        .map_err(|error| error.to_string())
}

async fn stream_provider_http_response(
    app: tauri::AppHandle,
    stream_id: String,
    mut response: reqwest::Response,
) {
    loop {
        match response.chunk().await {
            Ok(Some(bytes)) => emit_provider_http_stream_event(
                &app,
                ProviderHttpStreamEvent {
                    stream_id: stream_id.clone(),
                    kind: "chunk".to_string(),
                    bytes: Some(bytes.to_vec()),
                    error: None,
                },
            ),
            Ok(None) => {
                emit_provider_http_stream_event(
                    &app,
                    ProviderHttpStreamEvent {
                        stream_id,
                        kind: "done".to_string(),
                        bytes: None,
                        error: None,
                    },
                );
                break;
            }
            Err(error) => {
                emit_provider_http_stream_event(
                    &app,
                    ProviderHttpStreamEvent {
                        stream_id,
                        kind: "error".to_string(),
                        bytes: None,
                        error: Some(error.to_string()),
                    },
                );
                break;
            }
        }
    }
}

fn emit_provider_http_stream_event(app: &tauri::AppHandle, event: ProviderHttpStreamEvent) {
    let _ = app.emit("provider_http_stream", event);
}

impl ProviderHttpStreamRequest {
    fn into_provider_request(self) -> ProviderHttpRequest {
        ProviderHttpRequest {
            url: self.url,
            headers: self.headers,
            body: self.body,
            timeout_ms: self.timeout_ms,
        }
    }
}
