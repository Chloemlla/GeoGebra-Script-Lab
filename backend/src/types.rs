use bytes::Bytes;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEnvelope<T> {
    pub success: bool,
    pub code: String,
    pub message: String,
    pub request_id: String,
    pub data: Option<T>,
    pub meta: ApiMeta,
    pub error: Option<ApiErrorBody>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiMeta {
    pub timestamp: DateTime<Utc>,
    pub version: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorBody {
    pub message: String,
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawingJobResultResponse {
    pub job_id: String,
    pub status: String,
    pub scene_summary: String,
    pub canvas_mode: String,
    pub commands: Vec<String>,
    pub render_hints: RenderHints,
    pub diagnostics: Diagnostics,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderHints {
    pub reset_before_run: bool,
    pub suggested_viewport: Viewport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub xmin: i32,
    pub xmax: i32,
    pub ymin: i32,
    pub ymax: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub confidence: f32,
    pub human_review_recommended: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UploadCreateRequest {
    pub filename: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    pub size: u64,
    pub purpose: String,
    #[serde(rename = "canvasMode")]
    pub canvas_mode: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DrawingJobCreateRequest {
    #[serde(rename = "assetId")]
    pub asset_id: String,
    pub prompt: String,
    #[serde(rename = "canvasMode")]
    pub canvas_mode: String,
    #[serde(rename = "responseFormat")]
    pub response_format: String,
    pub locale: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ShareCreateRequest {
    pub title: String,
    #[serde(rename = "canvasMode")]
    pub canvas_mode: String,
    pub commands: Vec<String>,
    #[serde(rename = "coverAssetId")]
    pub cover_asset_id: String,
    pub visibility: String,
    #[serde(rename = "allowFork")]
    pub allow_fork: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    pub email: String,
    pub username: String,
    pub password: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub account: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetRecord {
    pub asset_id: String,
    #[serde(default)]
    pub owner_user_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size: u64,
    pub purpose: String,
    pub canvas_mode: String,
    pub file_url: String,
    pub upload_url: String,
    pub expires_at: DateTime<Utc>,
    pub uploaded: bool,
    pub uploaded_bytes: u64,
    pub uploaded_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct UploadedAsset {
    pub content_type: String,
    pub bytes: Bytes,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawingJobRecord {
    pub job_id: String,
    #[serde(default)]
    pub owner_user_id: String,
    pub asset_id: String,
    pub prompt: String,
    pub canvas_mode: String,
    pub response_format: String,
    pub locale: String,
    pub status: JobStatus,
    pub commands: Vec<String>,
    pub scene_summary: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub diagnostics: Diagnostics,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Processing,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareRecord {
    pub share_id: String,
    #[serde(default)]
    pub owner_user_id: String,
    pub slug: String,
    pub title: String,
    pub canvas_mode: String,
    pub commands: Vec<String>,
    pub cover_asset_id: String,
    pub visibility: String,
    pub allow_fork: bool,
    pub share_url: String,
    pub embed_url: String,
    pub poster_url: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfigView {
    pub base_url: String,
    pub model_name: String,
    pub api_key_set: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfigUpdateRequest {
    #[serde(alias = "base_url")]
    pub base_url: Option<String>,
    #[serde(alias = "model_name")]
    pub model_name: Option<String>,
    #[serde(alias = "api_key")]
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserRecord {
    pub user_id: String,
    pub email: String,
    pub username: String,
    pub display_name: String,
    pub password_hash: String,
    pub created_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub session_id: String,
    pub user_id: String,
    pub token: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub user_id: String,
    pub email: String,
    pub username: String,
    pub display_name: String,
    pub created_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSessionResponse {
    pub token: String,
    pub token_type: &'static str,
    pub expires_at: DateTime<Utc>,
    pub user: UserProfile,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentSessionResponse {
    pub expires_at: DateTime<Utc>,
    pub user: UserProfile,
}

#[derive(Debug, Clone)]
pub struct AuthContext {
    pub user: UserRecord,
    pub session: SessionRecord,
}
