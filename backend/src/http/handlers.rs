use base64::Engine;
use bytes::Bytes;
use chrono::Utc;
use http::{HeaderMap, HeaderValue, Method, StatusCode};
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::{Request, Response};
use serde_json::{json, Value};
use std::convert::Infallible;
use std::time::Instant;

use crate::admin::build_admin_dashboard;
use crate::auth::{
    build_auth_session_response, build_current_session_response, build_session,
    ensure_admin_compatibility, hash_password, normalize_display_name, normalize_email,
    normalize_username, require_auth, validate_email, validate_password, validate_username,
    verify_password,
};
use crate::error::AppError;
use crate::frontend::serve_frontend_asset;
use crate::http::responses::{
    bytes_response, cors_preflight_response, envelope, error_response, json_response,
    text_response, with_cors,
};
use crate::metrics::endpoint_label;
use crate::model::ModelClient;
use crate::state::AppState;
use crate::store::{
    cache_asset_payload, count_users, find_any_job_record, find_asset_payload, find_asset_record,
    find_export_job_record, find_job_record, find_project_record, find_project_versions_by_project,
    find_review_comment_record, find_share_by_slug, find_team_record, find_user_by_email,
    find_user_by_id, find_user_by_username, list_projects_by_team, list_projects_by_user,
    list_projects_by_workspace, list_review_comments_by_project, list_team_memberships_by_team,
    list_teams_by_user, revoke_session_by_token, upsert_asset_record, upsert_export_job_record,
    upsert_job_record, upsert_project_record, upsert_project_version_record,
    upsert_review_comment_record, upsert_session_record, upsert_share_record,
    upsert_team_membership_record, upsert_team_record, upsert_user_record,
};
use crate::types::{
    AnnotationJobRequest, Diagnostics, DrawingJobCreateRequest, DrawingJobRecord,
    DrawingJobResultResponse, ExportJobCreateRequest, ExportJobRecord, ExportJobStatus, JobStatus,
    LoginRequest, ModelConfigUpdateRequest, ObjectExplanationRequest, ProjectCreateRequest,
    ProjectRecord, ProjectUpdateRequest, ProjectVersionCreateRequest, ProjectVersionRecord,
    ProjectVersionSummary, RegisterRequest, RenderHints, ReviewCommentCreateRequest,
    ReviewCommentRecord, ReviewCommentUpdateRequest, ScriptInsightsRequest, ShareCreateRequest,
    ShareRecord, TeamCreateRequest, TeamMemberCreateRequest, TeamMembershipRecord, TeamRecord,
    TeamRole, UploadCreateRequest, UploadedAsset, UserRecord, Viewport,
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
    let is_project_get = method == Method::GET
        && path.starts_with("/api/v1/projects/")
        && !path.ends_with("/versions");
    let is_project_patch = method == Method::PATCH
        && path.starts_with("/api/v1/projects/")
        && !path.ends_with("/versions");
    let is_project_versions_get = method == Method::GET
        && path.starts_with("/api/v1/projects/")
        && path.ends_with("/versions");
    let is_project_versions_post = method == Method::POST
        && path.starts_with("/api/v1/projects/")
        && path.ends_with("/versions");
    let is_team_members_get =
        method == Method::GET && path.starts_with("/api/v1/teams/") && path.ends_with("/members");
    let is_team_members_post =
        method == Method::POST && path.starts_with("/api/v1/teams/") && path.ends_with("/members");
    let is_review_comment_patch =
        method == Method::PATCH && path.starts_with("/api/v1/review-comments/");
    let is_export_get = method == Method::GET
        && path.starts_with("/api/v1/exports/")
        && !path.ends_with("/download");
    let is_export_download = method == Method::GET
        && path.starts_with("/api/v1/exports/")
        && path.ends_with("/download");
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
        (Method::GET, "/api/v1/projects") => list_projects(request, state).await,
        (Method::POST, "/api/v1/projects") => create_project(request, state).await,
        (Method::GET, "/api/v1/teams") => list_teams(request, state).await,
        (Method::POST, "/api/v1/teams") => create_team(request, state).await,
        (Method::GET, "/api/v1/review-comments") => list_review_comments(request, state).await,
        (Method::POST, "/api/v1/review-comments") => create_review_comment(request, state).await,
        (Method::POST, "/api/v1/assets/uploads") => create_upload(request, state).await,
        (Method::POST, "/api/v1/ai/drawing-jobs") => create_drawing_job(request, state).await,
        (Method::POST, "/api/v1/ai/script-insights") => {
            create_script_insights(request, state).await
        }
        (Method::POST, "/api/v1/ai/annotation-jobs") => create_annotation_job(request, state).await,
        (Method::POST, "/api/v1/ai/object-explanations") => {
            create_object_explanations(request, state).await
        }
        (Method::POST, "/api/v1/exports") => create_export_job(request, state).await,
        (Method::GET, "/api/v1/ai/drawing-jobs/demo") => get_demo_job(state).await,
        (Method::POST, "/api/v1/shares") => create_share(request, state).await,
        _ if is_upload_put => upload_asset(path, request, state).await,
        _ if is_asset_get => get_asset(path, state).await,
        _ if is_share_get => get_share(path, state).await,
        _ if is_project_versions_get => list_project_versions(path, request, state).await,
        _ if is_project_versions_post => create_project_version(path, request, state).await,
        _ if is_team_members_get => list_team_members(path, request, state).await,
        _ if is_team_members_post => create_team_member(path, request, state).await,
        _ if is_review_comment_patch => update_review_comment(path, request, state).await,
        _ if is_project_get => get_project(path, request, state).await,
        _ if is_project_patch => update_project(path, request, state).await,
        _ if is_drawing_job_get => get_drawing_job(path, request, state).await,
        _ if is_export_download => download_export_job(path, request, state).await,
        _ if is_export_get => get_export_job(path, request, state).await,
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
        return Err(AppError::Conflict(
            "email is already registered".to_string(),
        ));
    }

    if find_user_by_username(&username, &state).await?.is_some() {
        return Err(AppError::Conflict("username is already taken".to_string()));
    }

    let is_first_registered_user = count_users(&state).await? == 0;

    let user = UserRecord {
        user_id: format!("user_{}", short_id()),
        email,
        username: username.clone(),
        display_name: normalize_display_name(payload.display_name.as_deref(), &username),
        is_admin: is_first_registered_user,
        password_hash: hash_password(&payload.password)?,
        created_at: Utc::now(),
        last_login_at: Some(Utc::now()),
    };
    let session = build_session(&user.user_id);
    upsert_user_record(&state, &user).await?;
    upsert_session_record(&state, &session).await?;
    let user = ensure_admin_compatibility(user, &state).await?;
    let response =
        build_auth_session_response(session.token.clone(), session.expires_at.to_owned(), &user);

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
    upsert_user_record(&state, &user).await?;
    upsert_session_record(&state, &session).await?;
    let user = ensure_admin_compatibility(user, &state).await?;
    let response =
        build_auth_session_response(session.token.clone(), session.expires_at.to_owned(), &user);

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

async fn list_projects(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let workspace_key = require_workspace_key(request.headers())?;
    let query = request.uri().query().unwrap_or_default();
    let params = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect::<std::collections::HashMap<String, String>>();
    let favorite_filter = params
        .get("favorite")
        .map(|value| value.eq_ignore_ascii_case("true"));
    let folder_filter = params.get("folder").cloned();

    let mut projects_by_id = list_projects_by_user(&auth.user.user_id, &state)
        .await?
        .into_iter()
        .map(|project| (project.project_id.clone(), project))
        .collect::<std::collections::HashMap<_, _>>();

    for mut project in list_projects_by_workspace(&workspace_key, &state).await? {
        if project.owner_user_id.is_empty() {
            project.owner_user_id = auth.user.user_id.clone();
            upsert_project_record(&state, &project).await?;
        }

        projects_by_id.insert(project.project_id.clone(), project);
    }

    for team in list_teams_by_user(&auth.user.user_id, &state).await? {
        for project in list_projects_by_team(&team.team_id, &state).await? {
            projects_by_id.insert(project.project_id.clone(), project);
        }
    }

    let mut projects = projects_by_id.into_values().collect::<Vec<_>>();
    projects.retain(|project| project.deleted_at.is_none());

    if let Some(expected_favorite) = favorite_filter {
        projects.retain(|project| project.is_favorite == expected_favorite);
    }

    if let Some(folder) = folder_filter {
        projects.retain(|project| project.folder == folder);
    }

    projects.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "PROJECTS_LISTED",
            "projects listed",
            request_id(),
            Some(json!(projects)),
            None,
        ),
    ))
}

async fn create_project(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let workspace_key = require_workspace_key(request.headers())?;
    let body = read_json(request).await?;
    let payload: ProjectCreateRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid project body: {err}")))?;
    if let Some(team_id) = normalize_team_id(payload.team_id.clone()) {
        let team = find_team_record(&team_id, &state)
            .await?
            .ok_or(AppError::NotFound)?;
        let memberships = list_team_memberships_by_team(&team_id, &state).await?;
        ensure_team_access(&team, &memberships, &auth.user.user_id, TeamRole::Editor)?;
    }

    let now = Utc::now();
    let project = ProjectRecord {
        project_id: payload
            .project_id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("proj_{}", short_id())),
        owner_user_id: auth.user.user_id.clone(),
        owner_workspace_key: workspace_key,
        title: normalize_title(&payload.title),
        folder: normalize_folder(&payload.folder),
        tags: normalize_tags(payload.tags),
        is_favorite: payload.is_favorite,
        team_id: normalize_team_id(payload.team_id),
        canvas_mode: normalize_canvas_mode(&payload.canvas_mode),
        latest_code: payload.code,
        latest_version_id: None,
        created_at: now,
        updated_at: payload.updated_at.unwrap_or(now),
        last_opened_at: payload.last_opened_at.unwrap_or(now),
        deleted_at: None,
    };

    upsert_project_record(&state, &project).await?;

    Ok(json_response(
        StatusCode::CREATED,
        envelope(
            true,
            "PROJECT_CREATED",
            "project created",
            request_id(),
            Some(json!(project)),
            None,
        ),
    ))
}

async fn get_project(
    path: String,
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let workspace_key = require_workspace_key(request.headers())?;
    let project_id = path.trim_start_matches("/api/v1/projects/");
    let mut project = find_project_record(project_id, &state)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_project_access(
        &mut project,
        &auth.user.user_id,
        &workspace_key,
        TeamRole::Viewer,
        &state,
    )
    .await?;

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "PROJECT_FOUND",
            "project loaded",
            request_id(),
            Some(json!(project)),
            None,
        ),
    ))
}

async fn update_project(
    path: String,
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let workspace_key = require_workspace_key(request.headers())?;
    let project_id = path.trim_start_matches("/api/v1/projects/");
    let body = read_json(request).await?;
    let payload: ProjectUpdateRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid project update body: {err}")))?;
    let mut project = find_project_record(project_id, &state)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_project_access(
        &mut project,
        &auth.user.user_id,
        &workspace_key,
        TeamRole::Editor,
        &state,
    )
    .await?;
    if let Some(team_id) = normalize_team_id(payload.team_id.clone()) {
        let team = find_team_record(&team_id, &state)
            .await?
            .ok_or(AppError::NotFound)?;
        let memberships = list_team_memberships_by_team(&team_id, &state).await?;
        ensure_team_access(&team, &memberships, &auth.user.user_id, TeamRole::Editor)?;
    }

    if let Some(title) = payload.title {
        project.title = normalize_title(&title);
    }
    if let Some(folder) = payload.folder {
        project.folder = normalize_folder(&folder);
    }
    if let Some(tags) = payload.tags {
        project.tags = normalize_tags(tags);
    }
    if let Some(is_favorite) = payload.is_favorite {
        project.is_favorite = is_favorite;
    }
    if payload.team_id.is_some() {
        project.team_id = normalize_team_id(payload.team_id);
    }
    if let Some(canvas_mode) = payload.canvas_mode {
        project.canvas_mode = normalize_canvas_mode(&canvas_mode);
    }
    if let Some(code) = payload.code {
        project.latest_code = code;
    }
    if let Some(latest_version_id) = payload.latest_version_id {
        project.latest_version_id = Some(latest_version_id);
    }
    if let Some(last_opened_at) = payload.last_opened_at {
        project.last_opened_at = last_opened_at;
    }
    project.updated_at = payload.updated_at.unwrap_or_else(Utc::now);

    upsert_project_record(&state, &project).await?;

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "PROJECT_UPDATED",
            "project updated",
            request_id(),
            Some(json!(project)),
            None,
        ),
    ))
}

async fn list_project_versions(
    path: String,
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let workspace_key = require_workspace_key(request.headers())?;
    let project_id = extract_project_id_from_versions_path(&path)?;
    let mut project = find_project_record(project_id, &state)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_project_access(
        &mut project,
        &auth.user.user_id,
        &workspace_key,
        TeamRole::Viewer,
        &state,
    )
    .await?;
    let mut versions = find_project_versions_by_project(project_id, &state).await?;
    versions.sort_by(|left, right| right.created_at.cmp(&left.created_at));

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "PROJECT_VERSIONS_LISTED",
            "project versions listed",
            request_id(),
            Some(json!(versions)),
            None,
        ),
    ))
}

async fn create_project_version(
    path: String,
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let workspace_key = require_workspace_key(request.headers())?;
    let project_id = extract_project_id_from_versions_path(&path)?;
    let body = read_json(request).await?;
    let payload: ProjectVersionCreateRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid project version body: {err}")))?;
    let mut project = find_project_record(project_id, &state)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_project_access(
        &mut project,
        &auth.user.user_id,
        &workspace_key,
        TeamRole::Editor,
        &state,
    )
    .await?;

    let version = ProjectVersionRecord {
        version_id: payload
            .version_id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("ver_{}", short_id())),
        project_id: project_id.to_string(),
        owner_user_id: auth.user.user_id.clone(),
        owner_workspace_key: workspace_key.clone(),
        label: if payload.label.trim().is_empty() {
            "手动快照".to_string()
        } else {
            payload.label
        },
        trigger: if payload.trigger.trim().is_empty() {
            "manual".to_string()
        } else {
            payload.trigger
        },
        canvas_mode: normalize_canvas_mode(&payload.canvas_mode),
        code: payload.code.clone(),
        summary: payload
            .summary
            .unwrap_or_else(|| build_version_summary(&project.latest_code, &payload.code)),
        created_at: Utc::now(),
    };

    project.latest_version_id = Some(version.version_id.clone());
    project.latest_code = payload.code;
    project.updated_at = Utc::now();

    upsert_project_version_record(&state, &version).await?;
    upsert_project_record(&state, &project).await?;

    Ok(json_response(
        StatusCode::CREATED,
        envelope(
            true,
            "PROJECT_VERSION_CREATED",
            "project version created",
            request_id(),
            Some(json!(version)),
            None,
        ),
    ))
}

async fn list_teams(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let teams = list_teams_by_user(&auth.user.user_id, &state).await?;

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "TEAMS_LISTED",
            "teams listed",
            request_id(),
            Some(json!(teams)),
            None,
        ),
    ))
}

async fn create_team(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let body = read_json(request).await?;
    let payload: TeamCreateRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid team body: {err}")))?;
    let now = Utc::now();
    let team = TeamRecord {
        team_id: format!("team_{}", short_id()),
        owner_user_id: auth.user.user_id.clone(),
        slug: format!("{}-{}", slugify(&payload.name), short_id_suffix()),
        name: normalize_title(&payload.name),
        description: payload.description.unwrap_or_default(),
        created_at: now,
        updated_at: now,
    };
    let owner_membership = TeamMembershipRecord {
        membership_id: format!("tm_{}", short_id()),
        team_id: team.team_id.clone(),
        user_id: auth.user.user_id.clone(),
        role: TeamRole::Owner,
        created_at: now,
    };

    upsert_team_record(&state, &team).await?;
    upsert_team_membership_record(&state, &owner_membership).await?;

    Ok(json_response(
        StatusCode::CREATED,
        envelope(
            true,
            "TEAM_CREATED",
            "team created",
            request_id(),
            Some(json!({
                "team": team,
                "membership": owner_membership,
            })),
            None,
        ),
    ))
}

async fn list_team_members(
    path: String,
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let team_id = extract_team_id_from_members_path(&path)?;
    let team = find_team_record(team_id, &state)
        .await?
        .ok_or(AppError::NotFound)?;
    let memberships = list_team_memberships_by_team(team_id, &state).await?;
    ensure_team_access(&team, &memberships, &auth.user.user_id, TeamRole::Viewer)?;

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "TEAM_MEMBERS_LISTED",
            "team members listed",
            request_id(),
            Some(json!(memberships)),
            None,
        ),
    ))
}

async fn create_team_member(
    path: String,
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let team_id = extract_team_id_from_members_path(&path)?;
    let body = read_json(request).await?;
    let payload: TeamMemberCreateRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid team member body: {err}")))?;
    let team = find_team_record(team_id, &state)
        .await?
        .ok_or(AppError::NotFound)?;
    let memberships = list_team_memberships_by_team(team_id, &state).await?;
    ensure_team_access(&team, &memberships, &auth.user.user_id, TeamRole::Admin)?;
    if find_user_by_id(&payload.user_id, &state).await?.is_none() {
        return Err(AppError::BadRequest(
            "target user does not exist".to_string(),
        ));
    }

    let membership = TeamMembershipRecord {
        membership_id: format!("tm_{}", short_id()),
        team_id: team_id.to_string(),
        user_id: payload.user_id,
        role: payload.role,
        created_at: Utc::now(),
    };
    upsert_team_membership_record(&state, &membership).await?;

    Ok(json_response(
        StatusCode::CREATED,
        envelope(
            true,
            "TEAM_MEMBER_CREATED",
            "team member created",
            request_id(),
            Some(json!(membership)),
            None,
        ),
    ))
}

async fn list_review_comments(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let query = request.uri().query().unwrap_or_default();
    let params = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect::<std::collections::HashMap<String, String>>();
    let project_id = params
        .get("projectId")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::BadRequest("projectId is required".to_string()))?;
    let project = find_project_record(project_id, &state)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_project_comment_access(&project, &auth.user.user_id, &state).await?;
    let mut comments = list_review_comments_by_project(project_id, &state).await?;

    if let Some(version_id) = params.get("versionId") {
        comments.retain(|comment| comment.version_id.as_deref() == Some(version_id.as_str()));
    }
    if let Some(object_name) = params.get("objectName") {
        comments.retain(|comment| comment.object_name.as_deref() == Some(object_name.as_str()));
    }
    comments.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "REVIEW_COMMENTS_LISTED",
            "review comments listed",
            request_id(),
            Some(json!(comments)),
            None,
        ),
    ))
}

async fn create_review_comment(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let body = read_json(request).await?;
    let payload: ReviewCommentCreateRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid review comment body: {err}")))?;
    if payload.body.trim().is_empty() {
        return Err(AppError::BadRequest("comment body is required".to_string()));
    }
    if payload.version_id.is_none() && payload.object_name.is_none() {
        return Err(AppError::BadRequest(
            "comment must bind to a project version or object".to_string(),
        ));
    }

    let project = find_project_record(&payload.project_id, &state)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_project_comment_access(&project, &auth.user.user_id, &state).await?;

    let comment = ReviewCommentRecord {
        comment_id: format!("cmt_{}", short_id()),
        team_id: project.team_id.clone().or(payload.team_id),
        project_id: payload.project_id,
        version_id: payload.version_id,
        object_name: payload.object_name,
        author_user_id: auth.user.user_id.clone(),
        status: "open".to_string(),
        body: payload.body,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    upsert_review_comment_record(&state, &comment).await?;

    Ok(json_response(
        StatusCode::CREATED,
        envelope(
            true,
            "REVIEW_COMMENT_CREATED",
            "review comment created",
            request_id(),
            Some(json!(comment)),
            None,
        ),
    ))
}

async fn update_review_comment(
    path: String,
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let comment_id = path.trim_start_matches("/api/v1/review-comments/");
    let body = read_json(request).await?;
    let payload: ReviewCommentUpdateRequest = serde_json::from_value(body).map_err(|err| {
        AppError::BadRequest(format!("invalid review comment update body: {err}"))
    })?;
    let mut comment = find_review_comment_record(comment_id, &state)
        .await?
        .ok_or(AppError::NotFound)?;
    let project = find_project_record(&comment.project_id, &state)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_project_comment_access(&project, &auth.user.user_id, &state).await?;

    if let Some(body) = payload.body {
        if !body.trim().is_empty() {
            comment.body = body;
        }
    }
    if let Some(status) = payload.status {
        comment.status = status;
    }
    comment.updated_at = Utc::now();
    upsert_review_comment_record(&state, &comment).await?;

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "REVIEW_COMMENT_UPDATED",
            "review comment updated",
            request_id(),
            Some(json!(comment)),
            None,
        ),
    ))
}

async fn create_script_insights(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let body = read_json(request).await?;
    let payload: ScriptInsightsRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid script insights body: {err}")))?;

    if payload.commands.is_empty() {
        return Err(AppError::BadRequest("commands are required".to_string()));
    }

    let response = state
        .model_client
        .generate_script_insights(&payload)
        .await?;
    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "SCRIPT_INSIGHTS_READY",
            "script insights generated",
            request_id(),
            Some(json!(response)),
            None,
        ),
    ))
}

async fn create_annotation_job(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let body = read_json(request).await?;
    let payload: AnnotationJobRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid annotation job body: {err}")))?;

    if payload.commands.is_empty() {
        return Err(AppError::BadRequest("commands are required".to_string()));
    }

    let response = state.model_client.generate_annotation_job(&payload).await?;
    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "ANNOTATION_JOB_READY",
            "annotation suggestions generated",
            request_id(),
            Some(json!(response)),
            None,
        ),
    ))
}

async fn create_object_explanations(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let body = read_json(request).await?;
    let payload: ObjectExplanationRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid object explanation body: {err}")))?;

    if payload.commands.is_empty() {
        return Err(AppError::BadRequest("commands are required".to_string()));
    }

    let response = state
        .model_client
        .generate_object_explanations(&payload)
        .await?;
    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "OBJECT_EXPLANATIONS_READY",
            "object explanations generated",
            request_id(),
            Some(json!(response)),
            None,
        ),
    ))
}

async fn create_export_job(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let workspace_key = require_workspace_key(request.headers())?;
    let body = read_json(request).await?;
    let payload: ExportJobCreateRequest = serde_json::from_value(body)
        .map_err(|err| AppError::BadRequest(format!("invalid export job body: {err}")))?;

    if payload.commands.is_empty() {
        return Err(AppError::BadRequest("commands are required".to_string()));
    }

    let now = Utc::now();
    let export_request = payload.clone();
    let export_job = build_export_job_record(&auth.user.user_id, &workspace_key, payload, now)?;
    upsert_export_job_record(&state, &export_job).await?;
    if let Err(error) = state
        .export_task_dispatcher
        .enqueue(export_job.export_job_id.clone(), export_request)
    {
        let mut failed_job = export_job.clone();
        failed_job.status = ExportJobStatus::Failed;
        failed_job.error_message = Some(error.to_string());
        upsert_export_job_record(&state, &failed_job).await?;
        return Err(error);
    }

    Ok(json_response(
        StatusCode::CREATED,
        envelope(
            true,
            "EXPORT_JOB_CREATED",
            "export job created",
            request_id(),
            Some(json!(export_job)),
            None,
        ),
    ))
}

async fn get_export_job(
    path: String,
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let workspace_key = require_workspace_key(request.headers())?;
    let export_job_id = path.trim_start_matches("/api/v1/exports/");
    let mut export_job = find_export_job_record(export_job_id, &state)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_actor_owns_resource(
        &export_job.owner_user_id,
        &auth.user.user_id,
        &export_job.owner_workspace_key,
        &workspace_key,
        "export job",
    )?;
    claim_export_job_owner_if_needed(&mut export_job, &auth.user.user_id, &workspace_key, &state)
        .await?;

    Ok(json_response(
        StatusCode::OK,
        envelope(
            true,
            "EXPORT_JOB_FOUND",
            "export job loaded",
            request_id(),
            Some(json!(export_job)),
            None,
        ),
    ))
}

async fn download_export_job(
    path: String,
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<Full<Bytes>>, AppError> {
    let auth = require_auth(request.headers(), &state).await?;
    let workspace_key = require_workspace_key(request.headers())?;
    let export_job_id = path
        .trim_start_matches("/api/v1/exports/")
        .trim_end_matches("/download");
    let mut export_job = find_export_job_record(export_job_id, &state)
        .await?
        .ok_or(AppError::NotFound)?;
    ensure_actor_owns_resource(
        &export_job.owner_user_id,
        &auth.user.user_id,
        &export_job.owner_workspace_key,
        &workspace_key,
        "export job",
    )?;
    claim_export_job_owner_if_needed(&mut export_job, &auth.user.user_id, &workspace_key, &state)
        .await?;

    if export_job.status != ExportJobStatus::Completed {
        return Err(AppError::Conflict(
            "export job is not completed yet".to_string(),
        ));
    }
    let bytes = export_job
        .asset_base64
        .as_deref()
        .ok_or_else(|| AppError::Conflict("export artifact is not ready".to_string()))
        .and_then(|value| {
            base64::engine::general_purpose::STANDARD
                .decode(value)
                .map_err(|err| AppError::Internal(format!("invalid export artifact: {err}")))
        })?;

    let mut response = bytes_response(StatusCode::OK, Bytes::from(bytes), &export_job.content_type);
    if let Ok(value) = HeaderValue::from_str(&format!(
        "attachment; filename=\"{}\"",
        export_job.download_name
    )) {
        response
            .headers_mut()
            .insert(http::header::CONTENT_DISPOSITION, value);
    }
    Ok(response)
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

    record_snapshot.mime_type = persisted_content_type.clone();
    record_snapshot.uploaded = true;
    record_snapshot.uploaded_bytes = uploaded_bytes;
    record_snapshot.uploaded_at = Some(uploaded_at);

    upsert_asset_record(&state, &record_snapshot).await?;
    if let Some(mongo_store) = &state.mongo_store {
        mongo_store
            .save_asset_payload(asset_id, &persisted_content_type, &bytes)
            .await?;
    }
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

fn require_workspace_key(headers: &HeaderMap) -> Result<String, AppError> {
    let value = headers
        .get("X-Workspace-Key")
        .or_else(|| headers.get("x-workspace-key"))
        .ok_or_else(|| AppError::BadRequest("missing X-Workspace-Key header".to_string()))?
        .to_str()
        .map_err(|_| AppError::BadRequest("workspace key header is invalid".to_string()))?
        .trim()
        .to_string();

    if value.len() < 8
        || value.len() > 128
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(AppError::BadRequest(
            "workspace key format is invalid".to_string(),
        ));
    }

    Ok(value)
}

fn extract_project_id_from_versions_path(path: &str) -> Result<&str, AppError> {
    path.trim_start_matches("/api/v1/projects/")
        .trim_end_matches("/versions")
        .strip_suffix('/')
        .or_else(|| {
            Some(
                path.trim_start_matches("/api/v1/projects/")
                    .trim_end_matches("/versions"),
            )
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::BadRequest("project id is required".to_string()))
}

fn extract_team_id_from_members_path(path: &str) -> Result<&str, AppError> {
    path.trim_start_matches("/api/v1/teams/")
        .trim_end_matches("/members")
        .strip_suffix('/')
        .or_else(|| {
            Some(
                path.trim_start_matches("/api/v1/teams/")
                    .trim_end_matches("/members"),
            )
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::BadRequest("team id is required".to_string()))
}

fn normalize_title(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "未命名项目".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

fn normalize_folder(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "个人空间".to_string()
    } else {
        trimmed.chars().take(120).collect()
    }
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for tag in tags {
        let trimmed = tag.trim();
        if !trimmed.is_empty() && !normalized.iter().any(|item: &String| item == trimmed) {
            normalized.push(trimmed.chars().take(24).collect());
        }
    }

    normalized
}

fn normalize_team_id(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "__none__")
}

fn normalize_canvas_mode(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "geometry".to_string()
    } else {
        trimmed.to_string()
    }
}

fn build_version_summary(previous_code: &str, next_code: &str) -> ProjectVersionSummary {
    let before_lines = previous_code.lines().collect::<Vec<_>>();
    let after_lines = next_code.lines().collect::<Vec<_>>();
    let max_length = before_lines.len().max(after_lines.len());
    let mut changed_lines = 0u32;
    let mut added_lines = 0u32;
    let mut removed_lines = 0u32;

    for index in 0..max_length {
        let before = before_lines.get(index).copied();
        let after = after_lines.get(index).copied();
        if before == after {
            continue;
        }

        match (before, after) {
            (None, Some(_)) => added_lines += 1,
            (Some(_), None) => removed_lines += 1,
            (Some(_), Some(_)) => changed_lines += 1,
            (None, None) => {}
        }
    }

    ProjectVersionSummary {
        changed_lines,
        added_lines,
        removed_lines,
    }
}

fn role_rank(role: &TeamRole) -> u8 {
    match role {
        TeamRole::Owner => 5,
        TeamRole::Admin => 4,
        TeamRole::Editor => 3,
        TeamRole::Reviewer => 2,
        TeamRole::Viewer => 1,
    }
}

fn has_required_role(current: &TeamRole, required: &TeamRole) -> bool {
    role_rank(current) >= role_rank(required)
}

fn ensure_team_access(
    team: &TeamRecord,
    memberships: &[TeamMembershipRecord],
    current_user_id: &str,
    required_role: TeamRole,
) -> Result<(), AppError> {
    if team.owner_user_id == current_user_id {
        return Ok(());
    }

    let membership = memberships
        .iter()
        .find(|membership| membership.user_id == current_user_id)
        .ok_or_else(|| AppError::Unauthorized("you are not a member of this team".to_string()))?;

    if !has_required_role(&membership.role, &required_role) {
        return Err(AppError::Unauthorized(
            "your team role does not allow this operation".to_string(),
        ));
    }

    Ok(())
}

async fn ensure_project_comment_access(
    project: &ProjectRecord,
    current_user_id: &str,
    state: &AppState,
) -> Result<(), AppError> {
    if project.owner_user_id == current_user_id {
        return Ok(());
    }

    if let Some(team_id) = &project.team_id {
        let team = find_team_record(team_id, state)
            .await?
            .ok_or(AppError::NotFound)?;
        let memberships = list_team_memberships_by_team(team_id, state).await?;
        return ensure_team_access(&team, &memberships, current_user_id, TeamRole::Reviewer);
    }

    Err(AppError::Unauthorized(
        "you do not have access to this project comments".to_string(),
    ))
}

async fn ensure_project_access(
    project: &mut ProjectRecord,
    current_user_id: &str,
    current_workspace_key: &str,
    required_role: TeamRole,
    state: &AppState,
) -> Result<(), AppError> {
    if let Some(team_id) = &project.team_id {
        let team = find_team_record(team_id, state)
            .await?
            .ok_or(AppError::NotFound)?;
        let memberships = list_team_memberships_by_team(team_id, state).await?;
        return ensure_team_access(&team, &memberships, current_user_id, required_role);
    }

    ensure_actor_owns_resource(
        &project.owner_user_id,
        current_user_id,
        &project.owner_workspace_key,
        current_workspace_key,
        "project",
    )?;
    claim_project_owner_if_needed(project, current_user_id, current_workspace_key, state).await
}

fn build_export_job_record(
    user_id: &str,
    workspace_key: &str,
    payload: ExportJobCreateRequest,
    now: chrono::DateTime<Utc>,
) -> Result<ExportJobRecord, AppError> {
    let format = payload.format.trim().to_ascii_lowercase();
    if format.is_empty() {
        return Err(AppError::BadRequest("format is required".to_string()));
    }

    let title = payload
        .title
        .as_deref()
        .map(normalize_title)
        .unwrap_or_else(|| "GeoGebra Export".to_string());
    let export_job_id = format!("exp_{}", short_id());
    let (content_type, extension): (String, String) = match format.as_str() {
        "svg" => (
            "image/svg+xml; charset=utf-8".to_string(),
            "svg".to_string(),
        ),
        "pdf" => ("application/pdf".to_string(), "pdf".to_string()),
        "gif" => ("image/gif".to_string(), "gif".to_string()),
        "mp4" => ("video/mp4".to_string(), "mp4".to_string()),
        "pptx" => (
            "application/vnd.openxmlformats-officedocument.presentationml.presentation".to_string(),
            "pptx.json".to_string(),
        ),
        "ggb" => (
            "application/json; charset=utf-8".to_string(),
            "ggb.json".to_string(),
        ),
        _ => ("text/plain; charset=utf-8".to_string(), "txt".to_string()),
    };

    Ok(ExportJobRecord {
        export_job_id,
        owner_user_id: user_id.to_string(),
        owner_workspace_key: workspace_key.to_string(),
        project_id: payload.project_id,
        asset_id: payload.asset_id,
        title: title.clone(),
        canvas_mode: payload.canvas_mode,
        format: format.clone(),
        status: ExportJobStatus::Queued,
        content_type,
        download_name: format!("{}-{}.{}", slugify(&title), short_id_suffix(), extension),
        asset_base64: None,
        error_message: None,
        created_at: now,
        updated_at: now,
    })
}

fn ensure_owner(
    owner_user_id: &str,
    current_user_id: &str,
    resource: &str,
) -> Result<(), AppError> {
    if owner_user_id.is_empty() || owner_user_id != current_user_id {
        return Err(AppError::Unauthorized(format!(
            "you do not have access to this {resource}"
        )));
    }

    Ok(())
}

fn ensure_actor_owns_resource(
    owner_user_id: &str,
    current_user_id: &str,
    owner_workspace_key: &str,
    current_workspace_key: &str,
    resource: &str,
) -> Result<(), AppError> {
    if !owner_user_id.is_empty() {
        return ensure_owner(owner_user_id, current_user_id, resource);
    }

    if owner_workspace_key.is_empty() || owner_workspace_key != current_workspace_key {
        return Err(AppError::Unauthorized(format!(
            "you do not have access to this {resource}"
        )));
    }

    Ok(())
}

async fn claim_project_owner_if_needed(
    project: &mut ProjectRecord,
    current_user_id: &str,
    current_workspace_key: &str,
    state: &AppState,
) -> Result<(), AppError> {
    if !project.owner_user_id.is_empty() || project.owner_workspace_key != current_workspace_key {
        return Ok(());
    }

    project.owner_user_id = current_user_id.to_string();
    upsert_project_record(state, project).await
}

async fn claim_export_job_owner_if_needed(
    export_job: &mut ExportJobRecord,
    current_user_id: &str,
    current_workspace_key: &str,
    state: &AppState,
) -> Result<(), AppError> {
    if !export_job.owner_user_id.is_empty()
        || export_job.owner_workspace_key != current_workspace_key
    {
        return Ok(());
    }

    export_job.owner_user_id = current_user_id.to_string();
    upsert_export_job_record(state, export_job).await
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
