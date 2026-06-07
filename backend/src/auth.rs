use chrono::{Duration, Utc};
use http::header::AUTHORIZATION;
use http::HeaderMap;
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::error::AppError;
use crate::state::AppState;
use crate::types::{AuthContext, AuthSessionResponse, CurrentSessionResponse, UserProfile};

#[derive(Debug, Clone, Deserialize)]
struct SynapseTokenResponse {
    access_token: String,
    token_type: Option<String>,
    expires_in: Option<i64>,
    refresh_token: Option<String>,
    refresh_expires_in: Option<i64>,
    scope: Option<String>,
}

#[derive(Debug, Clone)]
struct SynapseUserInfo {
    sub: Option<String>,
    id: Option<String>,
    username: Option<String>,
    name: Option<String>,
    email: Option<String>,
    avatar_url: Option<String>,
    role: Option<String>,
    roles: Option<Vec<String>>,
    is_admin: Option<bool>,
    is_admin_snake: Option<bool>,
    synapse_admin: Option<bool>,
    synapse_admin_snake: Option<bool>,
    admin: Option<bool>,
    is_trusted: Option<bool>,
    is_trusted_snake: Option<bool>,
    created_at: Option<chrono::DateTime<Utc>>,
    account_status: Option<String>,
}

pub fn extract_bearer_token(headers: &HeaderMap) -> Result<String, AppError> {
    let header_value = headers
        .get(AUTHORIZATION)
        .ok_or_else(|| AppError::Unauthorized("missing bearer token".to_string()))?
        .to_str()
        .map_err(|_| AppError::Unauthorized("authorization header is invalid".to_string()))?;

    header_value
        .strip_prefix("Bearer ")
        .or_else(|| header_value.strip_prefix("bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| AppError::Unauthorized("missing bearer token".to_string()))
}

pub fn ensure_synapse_oauth_config(state: &AppState) -> Result<(), AppError> {
    if state.config.synapse_oauth_client_id.trim().is_empty() {
        return Err(AppError::Unavailable(
            "SYNAPSE_OAUTH_CLIENT_ID is not configured".to_string(),
        ));
    }

    if state.config.synapse_oauth_client_secret.trim().is_empty() {
        return Err(AppError::Unavailable(
            "SYNAPSE_OAUTH_CLIENT_SECRET is not configured".to_string(),
        ));
    }

    Ok(())
}

pub fn build_synapse_authorization_url(
    state: &AppState,
    oauth_state: &str,
) -> Result<String, AppError> {
    ensure_synapse_oauth_config(state)?;

    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    serializer
        .append_pair("response_type", "code")
        .append_pair("client_id", &state.config.synapse_oauth_client_id)
        .append_pair("redirect_uri", &state.config.synapse_oauth_redirect_uri)
        .append_pair("scope", &state.config.synapse_oauth_scope)
        .append_pair("state", oauth_state);
    let query = serializer.finish();

    Ok(format!(
        "{}/oauth/authorize?{}",
        state.config.synapse_base_url.trim_end_matches('/'),
        query
    ))
}

pub async fn exchange_synapse_authorization_code(
    state: &AppState,
    code: &str,
) -> Result<AuthSessionResponse, AppError> {
    ensure_synapse_oauth_config(state)?;

    let token_response = post_synapse_token(
        state,
        &[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &state.config.synapse_oauth_redirect_uri),
        ],
    )
    .await?;

    build_auth_session_from_token_response(state, token_response).await
}

pub async fn refresh_synapse_token(
    state: &AppState,
    refresh_token: &str,
) -> Result<AuthSessionResponse, AppError> {
    ensure_synapse_oauth_config(state)?;

    let token_response = post_synapse_token(
        state,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ],
    )
    .await?;

    build_auth_session_from_token_response(state, token_response).await
}

pub async fn require_auth(headers: &HeaderMap, state: &AppState) -> Result<AuthContext, AppError> {
    let token = extract_bearer_token(headers)?;
    let user = fetch_synapse_userinfo(state, &token).await?;

    Ok(AuthContext {
        user,
        scope: state.config.synapse_oauth_scope.clone(),
    })
}

pub async fn require_admin(headers: &HeaderMap, state: &AppState) -> Result<AuthContext, AppError> {
    let auth = require_auth(headers, state).await?;
    if !auth.user.is_admin {
        return Err(AppError::Unauthorized(
            "Synapse administrator access is required".to_string(),
        ));
    }

    Ok(auth)
}

pub fn build_current_session_response(auth: &AuthContext) -> CurrentSessionResponse {
    CurrentSessionResponse {
        expires_at: None,
        scope: auth.scope.clone(),
        user: auth.user.clone(),
    }
}

async fn post_synapse_token(
    state: &AppState,
    params: &[(&str, &str)],
) -> Result<SynapseTokenResponse, AppError> {
    let endpoint = format!(
        "{}/api/oauth/token",
        state.config.synapse_base_url.trim_end_matches('/')
    );
    let client = reqwest::Client::new();
    let response = client
        .post(endpoint)
        .basic_auth(
            state.config.synapse_oauth_client_id.trim(),
            Some(state.config.synapse_oauth_client_secret.trim()),
        )
        .form(params)
        .send()
        .await
        .map_err(|err| {
            AppError::Unavailable(format!("unable to reach Synapse token API: {err}"))
        })?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| AppError::Unavailable(format!("unable to read Synapse token API: {err}")))?;

    if !status.is_success() {
        return Err(AppError::Unauthorized(format!(
            "Synapse token exchange failed: {body}"
        )));
    }

    serde_json::from_str(&body)
        .map_err(|err| AppError::Internal(format!("invalid Synapse token response: {err}")))
}

async fn build_auth_session_from_token_response(
    state: &AppState,
    token_response: SynapseTokenResponse,
) -> Result<AuthSessionResponse, AppError> {
    let user = fetch_synapse_userinfo(state, &token_response.access_token).await?;
    let now = Utc::now();

    Ok(AuthSessionResponse {
        token: token_response.access_token,
        token_type: token_response
            .token_type
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "Bearer".to_string()),
        expires_at: token_response
            .expires_in
            .map(|seconds| now + Duration::seconds(seconds)),
        refresh_token: token_response.refresh_token,
        refresh_expires_at: token_response
            .refresh_expires_in
            .map(|seconds| now + Duration::seconds(seconds)),
        scope: token_response
            .scope
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| state.config.synapse_oauth_scope.clone()),
        user,
    })
}

async fn fetch_synapse_userinfo(
    state: &AppState,
    access_token: &str,
) -> Result<UserProfile, AppError> {
    let endpoint = format!(
        "{}/api/oauth/userinfo",
        state.config.synapse_base_url.trim_end_matches('/')
    );
    let client = reqwest::Client::new();
    let response = client
        .get(endpoint)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|err| AppError::Unavailable(format!("unable to reach Synapse userinfo: {err}")))?;
    let status = response.status();
    let body = response.text().await.map_err(|err| {
        AppError::Unavailable(format!("unable to read Synapse userinfo response: {err}"))
    })?;

    if !status.is_success() {
        return Err(AppError::Unauthorized(format!(
            "Synapse token is invalid: {body}"
        )));
    }

    let user_info = parse_synapse_userinfo(&body)
        .map_err(|err| AppError::Internal(format!("invalid Synapse userinfo response: {err}")))?;

    normalize_synapse_user(user_info)
}

fn parse_synapse_userinfo(body: &str) -> Result<SynapseUserInfo, String> {
    let value: Value = serde_json::from_str(body).map_err(|err| err.to_string())?;
    let object = value
        .as_object()
        .ok_or_else(|| "expected JSON object".to_string())?;

    Ok(SynapseUserInfo {
        sub: optional_string_field(object, "sub")?,
        id: optional_string_field(object, "id")?,
        username: optional_string_field(object, "username")?,
        name: optional_string_field(object, "name")?,
        email: optional_string_field(object, "email")?,
        avatar_url: optional_string_any(object, &["avatarUrl", "avatar_url"])?,
        role: optional_string_field(object, "role")?,
        roles: optional_string_array_field(object, "roles")?,
        is_admin: optional_bool_field(object, "isAdmin")?,
        is_admin_snake: optional_bool_field(object, "is_admin")?,
        synapse_admin: optional_bool_field(object, "synapseAdmin")?,
        synapse_admin_snake: optional_bool_field(object, "synapse_admin")?,
        admin: optional_bool_field(object, "admin")?,
        is_trusted: optional_bool_field(object, "isTrusted")?,
        is_trusted_snake: optional_bool_field(object, "is_trusted")?,
        created_at: optional_datetime_any(object, &["createdAt", "created_at"])?,
        account_status: optional_string_any(object, &["accountStatus", "account_status"])?,
    })
}

fn optional_string_field(
    object: &Map<String, Value>,
    field: &'static str,
) -> Result<Option<String>, String> {
    optional_string_any(object, &[field])
}

fn optional_string_any(
    object: &Map<String, Value>,
    fields: &[&'static str],
) -> Result<Option<String>, String> {
    for field in fields {
        let Some(value) = object.get(*field) else {
            continue;
        };
        if value.is_null() {
            continue;
        }
        return match value {
            Value::String(value) => Ok(Some(value.clone())),
            _ => Err(format!("field `{field}` must be a string")),
        };
    }

    Ok(None)
}

fn optional_bool_field(
    object: &Map<String, Value>,
    field: &'static str,
) -> Result<Option<bool>, String> {
    let Some(value) = object.get(field) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }

    match value {
        Value::Bool(value) => Ok(Some(*value)),
        _ => Err(format!("field `{field}` must be a boolean")),
    }
}

fn optional_string_array_field(
    object: &Map<String, Value>,
    field: &'static str,
) -> Result<Option<Vec<String>>, String> {
    let Some(value) = object.get(field) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }

    let Value::Array(values) = value else {
        return Err(format!("field `{field}` must be an array of strings"));
    };

    values
        .iter()
        .map(|value| match value {
            Value::String(value) => Ok(value.clone()),
            _ => Err(format!("field `{field}` must be an array of strings")),
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
}

fn optional_datetime_any(
    object: &Map<String, Value>,
    fields: &[&'static str],
) -> Result<Option<chrono::DateTime<Utc>>, String> {
    for field in fields {
        let Some(value) = object.get(*field) else {
            continue;
        };
        if value.is_null() {
            continue;
        }
        let Value::String(value) = value else {
            return Err(format!("field `{field}` must be an RFC 3339 timestamp"));
        };
        let parsed = chrono::DateTime::parse_from_rfc3339(value)
            .map_err(|err| format!("field `{field}` must be an RFC 3339 timestamp: {err}"))?;
        return Ok(Some(parsed.with_timezone(&Utc)));
    }

    Ok(None)
}

fn normalize_synapse_user(user_info: SynapseUserInfo) -> Result<UserProfile, AppError> {
    let user_id = user_info
        .sub
        .or(user_info.id)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Unauthorized("Synapse user id is missing".to_string()))?;
    let username = user_info
        .username
        .or_else(|| user_info.name.clone())
        .unwrap_or_else(|| user_id.clone())
        .trim()
        .to_string();
    let display_name = user_info
        .name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| username.clone());
    let role = user_info
        .role
        .or_else(|| {
            user_info
                .roles
                .as_ref()
                .and_then(|roles| roles.first().cloned())
        })
        .unwrap_or_else(|| "unknown".to_string())
        .trim()
        .to_ascii_lowercase();
    let is_admin = user_info.is_admin.unwrap_or(false)
        || user_info.is_admin_snake.unwrap_or(false)
        || user_info.synapse_admin.unwrap_or(false)
        || user_info.synapse_admin_snake.unwrap_or(false)
        || user_info.admin.unwrap_or(false)
        || role == "admin";
    let is_trusted = user_info.is_trusted.unwrap_or(false)
        || user_info.is_trusted_snake.unwrap_or(false)
        || role == "trusted";
    let account_status = user_info
        .account_status
        .unwrap_or_else(|| "active".to_string())
        .trim()
        .to_ascii_lowercase();

    if account_status != "active" {
        return Err(AppError::Unauthorized(
            "Synapse account is not active".to_string(),
        ));
    }

    if !is_admin && !is_trusted {
        return Err(AppError::Unauthorized(
            "Synapse admin or trusted user is required".to_string(),
        ));
    }

    Ok(UserProfile {
        user_id,
        email: user_info.email.unwrap_or_default(),
        username,
        display_name,
        is_admin,
        is_trusted,
        role,
        account_status,
        avatar_url: user_info.avatar_url,
        created_at: user_info.created_at,
        last_login_at: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_synapse_userinfo_with_compatibility_identity_fields() {
        let body = r#"{
            "sub": "admin-user-id",
            "id": "admin-user-id",
            "username": "admin",
            "name": "Administrator",
            "avatarUrl": "https://cdn.example.com/avatar.png",
            "role": "admin",
            "roles": ["admin"],
            "isAdmin": true,
            "is_admin": true,
            "admin": true,
            "synapseAdmin": true,
            "synapse_admin": true,
            "isTrusted": false,
            "is_trusted": false,
            "createdAt": "2026-01-01T00:00:00.000Z",
            "accountStatus": "active",
            "email": "admin@example.com"
        }"#;

        let user_info = parse_synapse_userinfo(body).expect("userinfo should parse");
        let user = normalize_synapse_user(user_info).expect("admin user should normalize");

        assert_eq!(user.user_id, "admin-user-id");
        assert_eq!(user.username, "admin");
        assert!(user.is_admin);
        assert!(!user.is_trusted);
        assert_eq!(
            user.avatar_url.as_deref(),
            Some("https://cdn.example.com/avatar.png")
        );
        assert!(user.created_at.is_some());
    }
}
