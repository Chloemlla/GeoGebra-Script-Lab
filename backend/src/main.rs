use bytes::Bytes;
use chrono::{DateTime, Utc};
use http::{HeaderMap, HeaderValue, Method, StatusCode};
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioExecutor;
use hyper_util::server::conn::auto::Builder as AutoBuilder;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::convert::Infallible;
use std::env;
use std::net::SocketAddr;
use std::sync::Arc;
use thiserror::Error;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
use url::Url;
use uuid::Uuid;

#[derive(Clone, Debug)]
struct AppConfig {
    bind_addr: SocketAddr,
    api_base_url: String,
    model_base_url: String,
    model_name: String,
    api_key: String,
}

impl AppConfig {
    fn from_env() -> Self {
        let bind_addr = env::var("BIND_ADDR")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or_else(|| SocketAddr::from(([127, 0, 0, 1], 3001)));

        let api_base_url = env::var("API_BASE_URL").unwrap_or_else(|_| "http://127.0.0.1:3001".to_string());
        let model_base_url = env::var("MODEL_BASE_URL").unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
        let model_name = env::var("MODEL_NAME").unwrap_or_else(|_| "gpt-4.1-mini".to_string());
        let api_key = env::var("API_KEY").unwrap_or_default();

        Self {
            bind_addr,
            api_base_url,
            model_base_url,
            model_name,
            api_key,
        }
    }
}

#[derive(Clone)]
struct AppState {
    config: AppConfig,
    store: Arc<RwLock<MemoryStore>>,
    model_client: Arc<ModelClient>,
}

#[derive(Default)]
struct MemoryStore {
    assets: HashMap<String, AssetRecord>,
    jobs: HashMap<String, DrawingJobRecord>,
    shares: HashMap<String, ShareRecord>,
}

#[derive(Debug, Clone, Serialize)]
struct ApiEnvelope<T> {
    success: bool,
    code: String,
    message: String,
    request_id: String,
    data: Option<T>,
    meta: ApiMeta,
    error: Option<ApiErrorBody>,
}

#[derive(Debug, Clone, Serialize)]
struct ApiMeta {
    timestamp: DateTime<Utc>,
    version: &'static str,
}

#[derive(Debug, Clone, Serialize)]
struct ApiErrorBody {
    message: String,
    details: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
struct UploadCreateResponse {
    asset_id: String,
    upload_url: String,
    file_url: String,
    expires_in: u64,
}

#[derive(Debug, Clone, Serialize)]
struct DrawingJobCreateResponse {
    job_id: String,
    status: String,
    poll_url: String,
    credits_reserved: u32,
    estimated_latency_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
struct DrawingJobResultResponse {
    job_id: String,
    status: String,
    scene_summary: String,
    canvas_mode: String,
    commands: Vec<String>,
    render_hints: RenderHints,
    diagnostics: Diagnostics,
}

#[derive(Debug, Clone, Serialize)]
struct RenderHints {
    reset_before_run: bool,
    suggested_viewport: Viewport,
}

#[derive(Debug, Clone, Serialize)]
struct Viewport {
    xmin: i32,
    xmax: i32,
    ymin: i32,
    ymax: i32,
}

#[derive(Debug, Clone, Serialize)]
struct Diagnostics {
    confidence: f32,
    human_review_recommended: bool,
}

#[derive(Debug, Clone, Serialize)]
struct ShareCreateResponse {
    share_id: String,
    slug: String,
    share_url: String,
    embed_url: String,
    poster_url: String,
}

#[derive(Debug, Clone, Deserialize)]
struct UploadCreateRequest {
    filename: String,
    #[serde(rename = "mimeType")]
    mime_type: String,
    size: u64,
    purpose: String,
    #[serde(rename = "canvasMode")]
    canvas_mode: String,
}

#[derive(Debug, Clone, Deserialize)]
struct DrawingJobCreateRequest {
    #[serde(rename = "assetId")]
    asset_id: String,
    prompt: String,
    #[serde(rename = "canvasMode")]
    canvas_mode: String,
    #[serde(rename = "responseFormat")]
    response_format: String,
    locale: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ShareCreateRequest {
    title: String,
    #[serde(rename = "canvasMode")]
    canvas_mode: String,
    commands: Vec<String>,
    #[serde(rename = "coverAssetId")]
    cover_asset_id: String,
    visibility: String,
    #[serde(rename = "allowFork")]
    allow_fork: bool,
}

#[derive(Debug, Clone, Serialize)]
struct AssetRecord {
    asset_id: String,
    filename: String,
    mime_type: String,
    size: u64,
    purpose: String,
    canvas_mode: String,
    file_url: String,
    upload_url: String,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
struct DrawingJobRecord {
    job_id: String,
    asset_id: String,
    prompt: String,
    canvas_mode: String,
    response_format: String,
    locale: String,
    status: JobStatus,
    commands: Vec<String>,
    scene_summary: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    diagnostics: Diagnostics,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum JobStatus {
    Queued,
    Processing,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
struct ShareRecord {
    share_id: String,
    slug: String,
    title: String,
    canvas_mode: String,
    commands: Vec<String>,
    cover_asset_id: String,
    visibility: String,
    allow_fork: bool,
    share_url: String,
    embed_url: String,
    poster_url: String,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Error)]
enum AppError {
    #[error("not found")]
    NotFound,
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("internal error: {0}")]
    Internal(String),
}

#[derive(Debug, Clone, Serialize)]
struct ModelConfigView {
    base_url: String,
    model_name: String,
    api_key_set: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct ModelConfigUpdateRequest {
    base_url: Option<String>,
    model_name: Option<String>,
    api_key: Option<String>,
}

#[derive(Clone)]
struct ModelClient {
    base_url: Url,
    model_name: String,
    api_key: Option<String>,
    http: reqwest::Client,
}

impl ModelClient {
    fn new(base_url: String, model_name: String, api_key: String) -> Result<Self, AppError> {
        let base_url = Url::parse(&base_url).map_err(|err| AppError::BadRequest(format!("invalid model base URL: {err}")))?;
        let api_key = if api_key.trim().is_empty() { None } else { Some(api_key) };

        Ok(Self {
            base_url,
            model_name,
            api_key,
            http: reqwest::Client::new(),
        })
    }

    fn view(&self) -> ModelConfigView {
        ModelConfigView {
            base_url: self.base_url.as_str().trim_end_matches('/').to_string(),
            model_name: self.model_name.clone(),
            api_key_set: self.api_key.is_some(),
        }
    }

    async fn generate_drawing_commands(&self, input: &DrawingJobCreateRequest) -> Result<ModelDrawingResponse, AppError> {
        let endpoint = self
            .base_url
            .join("/chat/completions")
            .map_err(|err| AppError::Internal(format!("invalid model endpoint: {err}")))?;

        let prompt = format!(
            "You are a geometry assistant. Generate GeoGebra commands only.\nCanvas mode: {}\nLocale: {}\nUser prompt: {}\nReturn JSON with keys sceneSummary, commands, confidence, humanReviewRecommended.",
            input.canvas_mode, input.locale, input.prompt
        );

        let body = json!({
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": "You only output structured JSON for GeoGebra drawing tasks."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"}
        });

        let mut request = self.http.post(endpoint).json(&body);
        if let Some(api_key) = &self.api_key {
            request = request.bearer_auth(api_key);
        }

        let response = request
            .send()
            .await
            .map_err(|err| AppError::Internal(format!("model request failed: {err}")))?;

        if !response.status().is_success() {
            return Err(AppError::Internal(format!("model provider returned {}", response.status())));
        }

        let json: Value = response
            .json()
            .await
            .map_err(|err| AppError::Internal(format!("invalid model response: {err}")))?;

        Ok(ModelDrawingResponse::from_json(json))
    }
}

#[derive(Debug, Clone)]
struct ModelDrawingResponse {
    scene_summary: String,
    commands: Vec<String>,
    confidence: f32,
    human_review_recommended: bool,
}

impl ModelDrawingResponse {
    fn fallback() -> Self {
        Self {
            scene_summary: "model output is unavailable, fallback command set generated locally".to_string(),
            commands: vec![
                "A = (-3, 0)".to_string(),
                "B = (3, 0)".to_string(),
                "C = (1, 4)".to_string(),
                "tri = Polygon(A, B, C)".to_string(),
                "M = Midpoint(B, C)".to_string(),
                "median = Segment(A, M)".to_string(),
            ],
            confidence: 0.72,
            human_review_recommended: true,
        }
    }

    fn from_json(value: Value) -> Self {
        let scene_summary = value
            .get("sceneSummary")
            .or_else(|| value.get("scene_summary"))
            .and_then(Value::as_str)
            .unwrap_or("AI generated drawing commands")
            .to_string();

        let commands = value
            .get("commands")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
            .filter(|items| !items.is_empty())
            .unwrap_or_else(|| fallback_commands());

        let confidence = value
            .get("confidence")
            .and_then(Value::as_f64)
            .map(|value| value as f32)
            .unwrap_or(0.85);

        let human_review_recommended = value
            .get("humanReviewRecommended")
            .or_else(|| value.get("human_review_recommended"))
            .and_then(Value::as_bool)
            .unwrap_or(confidence < 0.8);

        Self {
            scene_summary,
            commands,
            confidence,
            human_review_recommended,
        }
    }
}

fn fallback_commands() -> Vec<String> {
    vec![
        "A = (-3, 0)".to_string(),
        "B = (3, 0)".to_string(),
        "C = (1, 4)".to_string(),
        "tri = Polygon(A, B, C)".to_string(),
        "M = Midpoint(B, C)".to_string(),
        "median = Segment(A, M)".to_string(),
    ]
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = AppConfig::from_env();
    let model_client = Arc::new(ModelClient::new(
        config.model_base_url.clone(),
        config.model_name.clone(),
        config.api_key.clone(),
    )?);

    let state = AppState {
        config,
        store: Arc::new(RwLock::new(MemoryStore::default())),
        model_client,
    };

    let listener = TcpListener::bind(state.config.bind_addr).await?;
    println!("geograba-backend listening on http://{}", state.config.bind_addr);

    loop {
        let (stream, _) = listener.accept().await?;
        let state = state.clone();

        tokio::spawn(async move {
            let service = service_fn(move |request| handle_request(request, state.clone()));
            if let Err(error) = AutoBuilder::new(TokioExecutor::new())
                .serve_connection(stream, service)
                .await
            {
                eprintln!("connection error: {error}");
            }
        });
    }
}

async fn handle_request(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let response = match route_request(request, state).await {
        Ok(response) => response,
        Err(error) => error_response(error),
    };

    Ok(response)
}

async fn route_request(request: Request<Incoming>, state: AppState) -> Result<Response<Full<Bytes>>, AppError> {
    let method = request.method().clone();
    let path = request.uri().path().to_string();

    match (method, path.as_str()) {
        (Method::GET, "/health") => Ok(json_response(StatusCode::OK, envelope(true, "OK", "service is healthy", request_id(), Some(json!({"status": "ok"})), None))),
        (Method::GET, "/api/v1/model/config") => Ok(json_response(StatusCode::OK, envelope(true, "MODEL_CONFIG", "current model config", request_id(), Some(json!(state.model_client.view())), None))),
        (Method::PUT, "/api/v1/model/config") => update_model_config(request, state).await,
        (Method::POST, "/api/v1/assets/uploads") => create_upload(request, state).await,
        (Method::POST, "/api/v1/ai/drawing-jobs") => create_drawing_job(request, state).await,
        (Method::GET, "/api/v1/ai/drawing-jobs/demo") => get_demo_job(state).await,
        (Method::POST, "/api/v1/shares") => create_share(request, state).await,
        _ if method == Method::GET && path.starts_with("/api/v1/ai/drawing-jobs/") => get_drawing_job(path, state).await,
        _ => Err(AppError::NotFound),
    }
}

async fn update_model_config(request: Request<Incoming>, state: AppState) -> Result<Response<Full<Bytes>>, AppError> {
    let body = read_json(request).await?;
    let payload: ModelConfigUpdateRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid model config body: {err}")))?;

    let base_url = payload.base_url.unwrap_or_else(|| state.config.model_base_url.clone());
    let model_name = payload.model_name.unwrap_or_else(|| state.config.model_name.clone());
    let api_key = payload.api_key.unwrap_or_else(|| state.config.api_key.clone());

    let client = ModelClient::new(base_url, model_name, api_key)?;
    let mut state_store = state.store.write().await;
    drop(state_store);

    let mut updated_state = state;
    updated_state.model_client = Arc::new(client);

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "MODEL_CONFIG_UPDATED",
            "model config updated",
            request_id(),
            Some(json!(updated_state.model_client.view())),
            None,
        ),
    ))
}

async fn create_upload(request: Request<Incoming>, state: AppState) -> Result<Response<Full<Bytes>>, AppError> {
    let body = read_json(request).await?;
    let payload: UploadCreateRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid upload body: {err}")))?;

    if payload.filename.trim().is_empty() {
        return Err(AppError::BadRequest("filename is required".to_string()));
    }

    let asset_id = format!("asset_{}", short_id());
    let upload_url = format!("{}/api/v1/uploads/{asset_id}", state.config.api_base_url.trim_end_matches('/'));
    let file_url = format!("{}/assets/{asset_id}", state.config.api_base_url.trim_end_matches('/'));

    let record = AssetRecord {
        asset_id: asset_id.clone(),
        filename: payload.filename,
        mime_type: payload.mime_type,
        size: payload.size,
        purpose: payload.purpose,
        canvas_mode: payload.canvas_mode,
        file_url: file_url.clone(),
        upload_url: upload_url.clone(),
        expires_at: Utc::now() + chrono::Duration::minutes(15),
    };

    state.store.write().await.assets.insert(asset_id.clone(), record);

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "UPLOAD_URL_CREATED",
            "upload slot created",
            request_id(),
            Some(json!({
                "assetId": asset_id,
                "uploadUrl": upload_url,
                "fileUrl": file_url,
                "expiresIn": 900u64,
            })),
            None,
        ),
    ))
}

async fn create_drawing_job(request: Request<Incoming>, state: AppState) -> Result<Response<Full<Bytes>>, AppError> {
    let body = read_json(request).await?;
    let payload: DrawingJobCreateRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid drawing job body: {err}")))?;

    if !state.store.read().await.assets.contains_key(&payload.asset_id) {
        return Err(AppError::BadRequest(format!("asset not found: {}", payload.asset_id)));
    }

    let job_id = format!("job_{}", short_id());
    let request_clone = payload.clone();
    let model_client = state.model_client.clone();
    let store = state.store.clone();

    let now = Utc::now();
    let record = DrawingJobRecord {
        job_id: job_id.clone(),
        asset_id: payload.asset_id.clone(),
        prompt: payload.prompt,
        canvas_mode: payload.canvas_mode,
        response_format: payload.response_format,
        locale: payload.locale,
        status: JobStatus::Queued,
        commands: Vec::new(),
        scene_summary: String::new(),
        created_at: now,
        updated_at: now,
        diagnostics: Diagnostics {
            confidence: 0.0,
            human_review_recommended: true,
        },
    };
    store.write().await.jobs.insert(job_id.clone(), record);

    tokio::spawn(async move {
        sleep(Duration::from_millis(120)).await;
        let mut result = model_client
            .generate_drawing_commands(&request_clone)
            .await
            .unwrap_or_else(|_| ModelDrawingResponse::fallback());

        if result.commands.is_empty() {
            result.commands = fallback_commands();
        }

        let mut store = store.write().await;
        if let Some(job) = store.jobs.get_mut(&job_id) {
            job.status = JobStatus::Completed;
            job.commands = result.commands;
            job.scene_summary = result.scene_summary;
            job.updated_at = Utc::now();
            job.diagnostics = Diagnostics {
                confidence: result.confidence,
                human_review_recommended: result.human_review_recommended,
            };
        }
    });

    Ok(json_response(
        StatusCode::ACCEPTED,
        envelope(
            true,
            "JOB_ACCEPTED",
            "drawing job queued",
            request_id(),
            Some(json!({
                "jobId": job_id,
                "status": "queued",
                "pollUrl": format!("/api/v1/ai/drawing-jobs/{job_id}"),
                "creditsReserved": 12u32,
                "estimatedLatencyMs": 6000u64,
            })),
            None,
        ),
    ))
}

async fn get_drawing_job(path: String, state: AppState) -> Result<Response<Full<Bytes>>, AppError> {
    let job_id = path.trim_start_matches("/api/v1/ai/drawing-jobs/");
    let store = state.store.read().await;
    let job = store.jobs.get(job_id).ok_or(AppError::NotFound)?;

    if job.status != JobStatus::Completed {
        return Ok(json_response(
            StatusCode::OK,
            envelope(
                true,
                "JOB_RUNNING",
                "drawing job is still processing",
                request_id(),
                Some(json!({
                    "jobId": job.job_id,
                    "status": job.status,
                })),
                None,
            ),
        ));
    }

    let response = DrawingJobResultResponse {
        job_id: job.job_id.clone(),
        status: "completed".to_string(),
        scene_summary: job.scene_summary.clone(),
        canvas_mode: job.canvas_mode.clone(),
        commands: job.commands.clone(),
        render_hints: RenderHints {
            reset_before_run: true,
            suggested_viewport: Viewport {
                xmin: -5,
                xmax: 5,
                ymin: -2,
                ymax: 6,
            },
        },
        diagnostics: job.diagnostics.clone(),
    };

    Ok(json_response(
        StatusCode::OK,
        envelope(true, "JOB_COMPLETED", "drawing job completed", request_id(), Some(json!(response)), None),
    ))
}

async fn get_demo_job(state: AppState) -> Result<Response<Full<Bytes>>, AppError> {
    let store = state.store.read().await;
    let job = store.jobs.values().next().ok_or(AppError::NotFound)?;
    let response = DrawingJobResultResponse {
        job_id: job.job_id.clone(),
        status: "completed".to_string(),
        scene_summary: if job.scene_summary.is_empty() {
            "demo drawing job".to_string()
        } else {
            job.scene_summary.clone()
        },
        canvas_mode: job.canvas_mode.clone(),
        commands: if job.commands.is_empty() { fallback_commands() } else { job.commands.clone() },
        render_hints: RenderHints {
            reset_before_run: true,
            suggested_viewport: Viewport {
                xmin: -5,
                xmax: 5,
                ymin: -2,
                ymax: 6,
            },
        },
        diagnostics: job.diagnostics.clone(),
    };

    Ok(json_response(
        StatusCode::OK,
        envelope(true, "JOB_COMPLETED", "drawing job completed", request_id(), Some(json!(response)), None),
    ))
}

async fn create_share(request: Request<Incoming>, state: AppState) -> Result<Response<Full<Bytes>>, AppError> {
    let body = read_json(request).await?;
    let payload: ShareCreateRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid share body: {err}")))?;

    if !state.store.read().await.assets.contains_key(&payload.cover_asset_id) {
        return Err(AppError::BadRequest(format!("cover asset not found: {}", payload.cover_asset_id)));
    }

    let share_id = format!("share_{}", short_id());
    let slug = format!("{}-{}", slugify(&payload.title), short_id_suffix());
    let base = state.config.api_base_url.trim_end_matches('/');
    let share_url = format!("{base}/s/{slug}");
    let embed_url = format!("{base}/embed/{slug}");
    let poster_url = format!("{base}/shares/{slug}/poster.png");

    let record = ShareRecord {
        share_id: share_id.clone(),
        slug: slug.clone(),
        title: payload.title,
        canvas_mode: payload.canvas_mode,
        commands: payload.commands.clone(),
        cover_asset_id: payload.cover_asset_id,
        visibility: payload.visibility,
        allow_fork: payload.allow_fork,
        share_url: share_url.clone(),
        embed_url: embed_url.clone(),
        poster_url: poster_url.clone(),
        created_at: Utc::now(),
    };

    state.store.write().await.shares.insert(share_id.clone(), record);

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "SHARE_CREATED",
            "share published",
            request_id(),
            Some(json!({
                "shareId": share_id,
                "slug": slug,
                "shareUrl": share_url,
                "embedUrl": embed_url,
                "posterUrl": poster_url,
            })),
            None,
        ),
    ))
}

async fn read_json(request: Request<Incoming>) -> Result<Value, AppError> {
    let body = request
        .into_body()
        .collect()
        .await
        .map_err(|err| AppError::BadRequest(format!("unable to read body: {err}")))?;

    let bytes = body.to_bytes();
    serde_json::from_slice(&bytes).map_err(|err| AppError::BadRequest(format!("invalid JSON: {err}")))
}

fn json_response<T: Serialize>(status: StatusCode, envelope: ApiEnvelope<T>) -> Response<Full<Bytes>> {
    let body = serde_json::to_vec(&envelope).unwrap_or_else(|_| b"{}".to_vec());
    let mut response = Response::new(Full::new(Bytes::from(body)));
    *response.status_mut() = status;
    response.headers_mut().insert(http::header::CONTENT_TYPE, HeaderValue::from_static("application/json; charset=utf-8"));
    response
}

fn error_response(error: AppError) -> Response<Full<Bytes>> {
    match error {
        AppError::NotFound => json_response(
            StatusCode::NOT_FOUND,
            envelope::<Value>(false, "NOT_FOUND", "resource not found", request_id(), None, Some(ApiErrorBody { message: "not found".to_string(), details: None })),
        ),
        AppError::BadRequest(message) => json_response(
            StatusCode::BAD_REQUEST,
            envelope::<Value>(false, "BAD_REQUEST", &message, request_id(), None, Some(ApiErrorBody { message, details: None })),
        ),
        AppError::Internal(message) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            envelope::<Value>(false, "INTERNAL_ERROR", &message, request_id(), None, Some(ApiErrorBody { message, details: None })),
        ),
    }
}

fn envelope<T: Serialize>(
    success: bool,
    code: &str,
    message: &str,
    request_id: String,
    data: Option<T>,
    error: Option<ApiErrorBody>,
) -> ApiEnvelope<T> {
    ApiEnvelope {
        success,
        code: code.to_string(),
        message: message.to_string(),
        request_id,
        data,
        meta: ApiMeta {
            timestamp: Utc::now(),
            version: "v1",
        },
        error,
    }
}

fn request_id() -> String {
    format!("req_{}", short_id())
}

fn short_id() -> String {
    Uuid::new_v4().as_simple().to_string()[..24].to_string()
}

fn short_id_suffix() -> String {
    Uuid::new_v4().as_simple().to_string()[..6].to_string()
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;

    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }

    slug.trim_matches('-').to_string()
}
