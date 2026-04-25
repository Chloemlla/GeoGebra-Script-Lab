use bytes::Bytes;
use chrono::Utc;
use http::{HeaderValue, Method, StatusCode};
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::{Request, Response};
use serde_json::{json, Value};
use std::convert::Infallible;
use std::time::Instant;

use crate::admin::build_admin_dashboard;
use crate::auth::{
    build_auth_session_response, build_current_session_response, build_session, hash_password,
    normalize_display_name, normalize_email, normalize_username, require_auth, validate_email,
    validate_password, validate_username, verify_password,
};
use crate::error::AppError;
use crate::frontend::serve_frontend_asset;
use crate::http::responses::{
    cors_preflight_response, envelope, error_response, json_response, text_response, with_cors,
};
use crate::metrics::endpoint_label;
use crate::model::ModelClient;
use crate::state::AppState;
use crate::store::{
    cache_asset_payload, find_any_job_record, find_asset_payload, find_asset_record,
    find_job_record, find_share_by_slug, find_user_by_email, find_user_by_id,
    find_user_by_username, revoke_session_by_token, upsert_asset_record, upsert_job_record,
    upsert_share_record,
};
use crate::types::{
    Diagnostics, DrawingJobCreateRequest, DrawingJobRecord, DrawingJobResultResponse, JobStatus,
    LoginRequest, ModelConfigUpdateRequest, RegisterRequest, RenderHints, ShareCreateRequest,
    ShareRecord, UploadedAsset, UploadCreateRequest, UserRecord, Viewport,
};
use crate::utils::{fallback_commands, request_id, short_id, short_id_suffix, slugify};

pub async fn handle_request(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let endpoint = endpoint_label(request.method(), request.uri().path());
    let started_at = Instant::now();
    let metrics = state.metrics.clone();

    let response = match route_request(request, state).await {
        Ok(response) => response,
        Err(error) => error_response(error),
    };

    metrics.record_request(&endpoint, started_at.elapsed());
    Ok(with_cors(response))
}

pub async fn route_request(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let is_drawing_job_get = method == Method::GET && path.starts_with("/api/v1/ai/drawing-jobs/");
    let is_upload_put = method == Method::PUT && path.starts_with("/api/v1/uploads/");
    let is_asset_get = method == Method::GET && path.starts_with("/assets/");
    let is_share_get = method == Method::GET && path.starts_with("/api/v1/shares/");
    let is_frontend_get = method == Method::GET && !path.starts_with("/api/");

    match (method, path.as_str()) {
        (Method::OPTIONS, _) => Ok(cors_preflight_response()),
        (Method::GET, "/health") => Ok(json_response(
            StatusCode::OK,
            envelope(
                true,
                "OK",
                "service is healthy",
                request_id(),
                Some(json!({"status": "ok"})),
                None,
            ),
        )),
        (Method::GET, "/healthz") => Ok(text_response(
            StatusCode::OK,
            "ok",
            "text/plain; charset=utf-8",
        )),
        (Method::GET, "/api/v1/admin/dashboard") => Ok(json_response(
            StatusCode::OK,
            envelope(
                true,
                "ADMIN_DASHBOARD",
                "admin dashboard snapshot",
                request_id(),
                Some(json!(build_admin_dashboard(&state).await)),
                None,
            ),
        )),
        (Method::GET, "/metrics") | (Method::GET, "/api/v1/metrics") => Ok(json_response(
            StatusCode::OK,
            envelope(
                true,
                "METRICS",
                "metrics snapshot",
                request_id(),
                Some(json!(state.metrics.snapshot())),
                None,
            ),
        )),
        (Method::GET, "/api/v1/model/config") => Ok(json_response(
            StatusCode::OK,
            envelope(
                true,
                "MODEL_CONFIG",
                "current model config",
                request_id(),
                Some(json!(state.model_client.view())),
                None,
            ),
        )),
        (Method::POST, "/api/v1/auth/register") => register_user(request, state).await,
        (Method::POST, "/api/v1/auth/login") => login_user(request, state).await,
        (Method::GET, "/api/v1/auth/me") => get_current_session(request, state).await,
        (Method::POST, "/api/v1/auth/logout") => logout_user(request, state).await,
        (Method::PUT, "/api/v1/model/config") => update_model_config(request, state).await,
        (Method::POST, "/api/v1/assets/uploads") => create_upload(request, state).await,
        (Method::POST, "/api/v1/ai/drawing-jobs") => create_drawing_job(request, state).await,
        (Method::GET, "/api/v1/ai/drawing-jobs/demo") => get_demo_job(state).await,
        (Method::POST, "/api/v1/shares") => create_share(request, state).await,
        _ if is_upload_put => upload_asset(path, request, state).await,
        _ if is_asset_get => get_asset(path, state).await,
        _ if is_share_get => get_share(path, state).await,
        _ if is_drawing_job_get => get_drawing_job(path, request, state).await,
        _ if is_frontend_get => serve_frontend_asset(path, &state.frontend_assets),
        _ => Err(AppError::NotFound),
    }
}

async fn register_user(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let body = read_json(request).await?;
    let payload: RegisterRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid register body: {err}")))?;

    validate_email(&payload.email)?;
    validate_username(&payload.username)?;
    validate_password(&payload.password)?;

    let email = normalize_email(&payload.email);
    let username = normalize_username(&payload.username);

    if find_user_by_email(&email, &state).await?.is_some() {
        return Err(AppError::Conflict("email is already registered".to_string()));
    }

    if find_user_by_username(&username, &state).await?.is_some() {
        return Err(AppError::Conflict("username is already taken".to_string()));
    }

    let user = UserRecord {
        user_id: format!("user_{}", short_id()),
        email,
        username: username.clone(),
        display_name: normalize_display_name(payload.display_name.as_deref(), &username),
        password_hash: hash_password(&payload.password)?,
        created_at: Utc::now(),
        last_login_at: Some(Utc::now()),
    };
    let session = build_session(&user.user_id);
    let response = build_auth_session_response(
        session.token.clone(),
        session.expires_at.to_owned(),
        &user,
    );

    if let Some(mongo_store) = &state.mongo_store {
        mongo_store.upsert_user(&user).await?;
        mongo_store.upsert_session(&session).await?;
    }

    let mut store = state.store.write().await;
    store.users.insert(user.user_id.clone(), user);
    store.sessions.insert(session.session_id.clone(), session);
    drop(store);

    Ok(json_response(
        StatusCode::CREATED,
        envelope(
            true,
            "AUTH_REGISTERED",
            "account created",
            request_id(),
            Some(json!(response)),
            None,
        ),
    ))
}

async fn login_user(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let body = read_json(request).await?;
    let payload: LoginRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid login body: {err}")))?;

    let account = payload.account.trim();
    if account.is_empty() {
        return Err(AppError::BadRequest("account is required".to_string()));
    }

    let account_key = account.to_ascii_lowercase();
    let mut user = if account_key.contains('@') {
        find_user_by_email(&normalize_email(account), &state).await?
    } else {
        find_user_by_username(&normalize_username(account), &state).await?
    }
    .ok_or_else(|| AppError::Unauthorized("account or password is incorrect".to_string()))?;

    if !verify_password(&payload.password, &user.password_hash)? {
        return Err(AppError::Unauthorized(
            "account or password is incorrect".to_string(),
        ));
    }

    user.last_login_at = Some(Utc::now());
    let session = build_session(&user.user_id);
    let response = build_auth_session_response(
        session.token.clone(),
        session.expires_at.to_owned(),
        &user,
    );

    if let Some(mongo_store) = &state.mongo_store {
        mongo_store.upsert_user(&user).await?;
        mongo_store.upsert_session(&session).await?;
    }

    let mut store = state.store.write().await;
    store.users.insert(user.user_id.clone(), user);
    store.sessions.insert(session.session_id.clone(), session);
    drop(store);

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "AUTH_LOGGED_IN",
            "login succeeded",
            request_id(),
            Some(json!(response)),
            None,
        ),
    ))
}

async fn get_current_session(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let response = build_current_session_response(&auth.session, &auth.user);

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "AUTH_SESSION",
            "session is valid",
            request_id(),
            Some(json!(response)),
            None,
        ),
    ))
}

async fn logout_user(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    revoke_session_by_token(&auth.session.token, &state).await?;

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "AUTH_LOGGED_OUT",
            "logout succeeded",
            request_id(),
            Some(json!({
                "sessionId": auth.session.session_id,
            })),
            None,
        ),
    ))
}

async fn update_model_config(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let body = read_json(request).await?;
    let payload: ModelConfigUpdateRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid model config body: {err}")))?;

    let base_url = payload
        .base_url
        .unwrap_or_else(|| state.config.model_base_url.clone());
    let model_name = payload
        .model_name
        .unwrap_or_else(|| state.config.model_name.clone());
    let api_key = payload
        .api_key
        .unwrap_or_else(|| state.config.api_key.clone());

    let client = ModelClient::new(base_url, model_name, api_key)?;
    let mut updated_state = state;
    updated_state.model_client = std::sync::Arc::new(client);

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

async fn create_upload(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let body = read_json(request).await?;
    let payload: UploadCreateRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid upload body: {err}")))?;

    if payload.filename.trim().is_empty() {
        return Err(AppError::BadRequest("filename is required".to_string()));
    }

    let asset_id = format!("asset_{}", short_id());
    let upload_url = format!(
        "{}/api/v1/uploads/{asset_id}",
        state.config.api_base_url.trim_end_matches('/')
    );
    let file_url = format!(
        "{}/assets/{asset_id}",
        state.config.api_base_url.trim_end_matches('/')
    );

    let record = crate::types::AssetRecord {
        asset_id: asset_id.clone(),
        owner_user_id: auth.user.user_id.clone(),
        filename: payload.filename,
        mime_type: payload.mime_type,
        size: payload.size,
        purpose: payload.purpose,
        canvas_mode: payload.canvas_mode,
        file_url: file_url.clone(),
        upload_url: upload_url.clone(),
        expires_at: Utc::now() + chrono::Duration::minutes(15),
        uploaded: false,
        uploaded_bytes: 0,
        uploaded_at: None,
    };

    upsert_asset_record(&state, &record).await?;

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

async fn create_drawing_job(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let body = read_json(request).await?;
    let payload: DrawingJobCreateRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid drawing job body: {err}")))?;

    let asset = find_asset_record(&payload.asset_id, &state)
        .await?
        .ok_or_else(|| AppError::BadRequest(format!("asset not found: {}", payload.asset_id)))?;

    ensure_owner(&asset.owner_user_id, &auth.user.user_id, "asset")?;

    if !asset.uploaded && asset.size > 0 {
        return Err(AppError::BadRequest(
            "asset upload is not completed yet".to_string(),
        ));
    }

    if asset.expires_at < Utc::now() {
        return Err(AppError::BadRequest(
            "asset upload slot has expired".to_string(),
        ));
    }

    if payload.prompt.trim().is_empty() {
        return Err(AppError::BadRequest("prompt is required".to_string()));
    }

    if payload.response_format.trim().is_empty() || payload.locale.trim().is_empty() {
        return Err(AppError::BadRequest(format!(
            "responseFormat and locale are required"
        )));
    }

    let job_id = format!("job_{}", short_id());

    let now = Utc::now();
    let record = DrawingJobRecord {
        job_id: job_id.clone(),
        owner_user_id: auth.user.user_id.clone(),
        asset_id: payload.asset_id.clone(),
        prompt: payload.prompt.clone(),
        canvas_mode: payload.canvas_mode.clone(),
        response_format: payload.response_format.clone(),
        locale: payload.locale.clone(),
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

    upsert_job_record(&state, &record).await?;

    if let Err(error) = state
        .model_task_dispatcher
        .enqueue(job_id.clone(), payload.clone())
    {
        let failed_snapshot = {
            let mut store = state.store.write().await;
            if let Some(job) = store.jobs.get_mut(&job_id) {
                job.status = JobStatus::Failed;
                job.scene_summary = error.to_string();
                job.updated_at = Utc::now();
                Some(job.clone())
            } else {
                None
            }
        };

        if let (Some(mongo_store), Some(job_snapshot)) =
            (&state.mongo_store, failed_snapshot.as_ref())
        {
            let _ = mongo_store.upsert_job(job_snapshot).await;
        }

        return Err(error);
    }

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

async fn upload_asset(
    path: String,
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let asset_id = path.trim_start_matches("/api/v1/uploads/");
    if asset_id.is_empty() {
        return Err(AppError::BadRequest("asset id is required".to_string()));
    }

    let asset = find_asset_record(asset_id, &state)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_owner(&asset.owner_user_id, &auth.user.user_id, "asset")?;
    if asset.expires_at < Utc::now() {
        return Err(AppError::BadRequest("upload slot expired".to_string()));
    }

    let content_type = request
        .headers()
        .get(http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string);
    let bytes = read_bytes(request).await?;
    let persisted_content_type = content_type.unwrap_or(asset.mime_type.clone());
    let uploaded_at = Utc::now();
    let uploaded_bytes = bytes.len() as u64;

    let mut record_snapshot = asset;
    if record_snapshot.size != uploaded_bytes {
        return Err(AppError::BadRequest(format!(
            "uploaded size mismatch: expected {}, got {}",
            record_snapshot.size, uploaded_bytes
        )));
    }

    state.asset_file_store.save(asset_id, &bytes).await?;
    record_snapshot.mime_type = persisted_content_type.clone();
    record_snapshot.uploaded = true;
    record_snapshot.uploaded_bytes = uploaded_bytes;
    record_snapshot.uploaded_at = Some(uploaded_at);

    upsert_asset_record(&state, &record_snapshot).await?;
    cache_asset_payload(
        &state,
        asset_id,
        UploadedAsset {
            content_type: persisted_content_type.clone(),
            bytes: bytes.clone(),
        },
    )
    .await;
    state.metrics.record_upload_size(uploaded_bytes);

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "ASSET_UPLOADED",
            "asset uploaded",
            request_id(),
            Some(json!({
                "assetId": record_snapshot.asset_id,
                "fileUrl": record_snapshot.file_url,
                "uploadedBytes": uploaded_bytes,
                "uploadedAt": uploaded_at,
            })),
            None,
        ),
    ))
}

async fn get_drawing_job(
    path: String,
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let job_id = path.trim_start_matches("/api/v1/ai/drawing-jobs/");
    let job = find_job_record(job_id, &state)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_owner(&job.owner_user_id, &auth.user.user_id, "drawing job")?;

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
        envelope(
            true,
            "JOB_COMPLETED",
            "drawing job completed",
            request_id(),
            Some(json!(response)),
            None,
        ),
    ))
}

async fn get_asset(path: String, state: AppState) -> Result<Response<Full<Bytes>>, AppError> {
    let asset_id = path.trim_start_matches("/assets/");
    let asset = find_asset_payload(asset_id, &state)
        .await?
        .ok_or(AppError::NotFound)?;

    let mut response = Response::new(Full::new(asset.bytes.clone()));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        http::header::CONTENT_TYPE,
        HeaderValue::from_str(&asset.content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        http::header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    if let Ok(value) = HeaderValue::from_str(&asset.bytes.len().to_string()) {
        response
            .headers_mut()
            .insert(http::header::CONTENT_LENGTH, value);
    }
    Ok(response)
}

async fn get_demo_job(state: AppState) -> Result<Response<Full<Bytes>>, AppError> {
    let job = find_any_job_record(&state)
        .await?
        .ok_or(AppError::NotFound)?;
    let response = DrawingJobResultResponse {
        job_id: job.job_id.clone(),
        status: "completed".to_string(),
        scene_summary: if job.scene_summary.is_empty() {
            "demo drawing job".to_string()
        } else {
            job.scene_summary.clone()
        },
        canvas_mode: job.canvas_mode.clone(),
        commands: if job.commands.is_empty() {
            fallback_commands()
        } else {
            job.commands.clone()
        },
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
        envelope(
            true,
            "JOB_COMPLETED",
            "drawing job completed",
            request_id(),
            Some(json!(response)),
            None,
        ),
    ))
}

async fn create_share(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let body = read_json(request).await?;
    let payload: ShareCreateRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid share body: {err}")))?;

    let cover_asset = find_asset_record(&payload.cover_asset_id, &state)
        .await?
        .ok_or_else(|| {
            AppError::BadRequest(format!("cover asset not found: {}", payload.cover_asset_id))
        })?;
    ensure_owner(&cover_asset.owner_user_id, &auth.user.user_id, "asset")?;
    if !cover_asset.uploaded {
        return Err(AppError::BadRequest(
            "cover asset upload is not completed yet".to_string(),
        ));
    }

    let share_id = format!("share_{}", short_id());
    let slug = format!("{}-{}", slugify(&payload.title), short_id_suffix());
    let base = state.config.api_base_url.trim_end_matches('/');
    let share_url = format!("{base}/api/v1/shares/{slug}");
    let embed_url = share_url.clone();
    let poster_url = cover_asset.file_url.clone();

    let record = ShareRecord {
        share_id: share_id.clone(),
        owner_user_id: auth.user.user_id.clone(),
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

    upsert_share_record(&state, &record).await?;

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

async fn get_share(path: String, state: AppState) -> Result<Response<Full<Bytes>>, AppError> {
    let slug = path.trim_start_matches("/api/v1/shares/");
    let share = find_share_by_slug(slug, &state)
        .await?
        .ok_or(AppError::NotFound)?;

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "SHARE_FOUND",
            "share loaded",
            request_id(),
            Some(json!(share)),
            None,
        ),
    ))
}

fn ensure_owner(owner_user_id: &str, current_user_id: &str, resource: &str) -> Result<(), AppError> {
    if owner_user_id.is_empty() || owner_user_id != current_user_id {
        return Err(AppError::Unauthorized(format!(
            "you do not have access to this {resource}"
        )));
    }

    Ok(())
}

async fn read_json(request: Request<Incoming>) -> Result<Value, AppError> {
    let body = request
        .into_body()
        .collect()
        .await
        .map_err(|err| AppError::BadRequest(format!("unable to read body: {err}")))?;

    let bytes = body.to_bytes();
    serde_json::from_slice(&bytes)
        .map_err(|err| AppError::BadRequest(format!("invalid JSON: {err}")))
}

async fn read_bytes(request: Request<Incoming>) -> Result<Bytes, AppError> {
    request
        .into_body()
        .collect()
        .await
        .map(|body| body.to_bytes())
        .map_err(|err| AppError::BadRequest(format!("unable to read body: {err}")))
}
