use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use chrono::{Duration, Utc};
use http::header::AUTHORIZATION;
use http::HeaderMap;
use rand_core::OsRng;

use crate::error::AppError;
use crate::state::AppState;
use crate::store::{find_session_by_token, find_user_by_id, revoke_session_by_token};
use crate::types::{
    AuthContext, AuthSessionResponse, CurrentSessionResponse, SessionRecord, UserProfile,
    UserRecord,
};
use crate::utils::short_id;

const SESSION_TTL_DAYS: i64 = 30;

pub fn normalize_email(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

pub fn normalize_username(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

pub fn validate_email(email: &str) -> Result<(), AppError> {
    let trimmed = normalize_email(email);
    let Some((local, domain)) = trimmed.split_once('@') else {
        return Err(AppError::BadRequest("email format is invalid".to_string()));
    };

    if local.is_empty() || domain.len() < 3 || !domain.contains('.') {
        return Err(AppError::BadRequest("email format is invalid".to_string()));
    }

    Ok(())
}

pub fn validate_username(username: &str) -> Result<(), AppError> {
    let normalized = normalize_username(username);
    let length = normalized.chars().count();

    if !(3..=24).contains(&length) {
        return Err(AppError::BadRequest(
            "username must be between 3 and 24 characters".to_string(),
        ));
    }

    if !normalized
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Err(AppError::BadRequest(
            "username may only contain letters, numbers, hyphens, and underscores".to_string(),
        ));
    }

    Ok(())
}

pub fn validate_password(password: &str) -> Result<(), AppError> {
    if password.chars().count() < 8 {
        return Err(AppError::BadRequest(
            "password must be at least 8 characters long".to_string(),
        ));
    }

    Ok(())
}

pub fn normalize_display_name(display_name: Option<&str>, username: &str) -> String {
    let candidate = display_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(username)
        .trim();

    candidate.chars().take(40).collect()
}

pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|err| AppError::Internal(format!("unable to hash password: {err}")))
}

pub fn verify_password(password: &str, password_hash: &str) -> Result<bool, AppError> {
    let parsed = PasswordHash::new(password_hash)
        .map_err(|err| AppError::Internal(format!("stored password hash is invalid: {err}")))?;

    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

pub fn build_user_profile(user: &UserRecord) -> UserProfile {
    UserProfile {
        user_id: user.user_id.clone(),
        email: user.email.clone(),
        username: user.username.clone(),
        display_name: user.display_name.clone(),
        created_at: user.created_at.to_owned(),
        last_login_at: user.last_login_at.to_owned(),
    }
}

pub fn build_auth_session_response(
    token: String,
    expires_at: chrono::DateTime<Utc>,
    user: &UserRecord,
) -> AuthSessionResponse {
    AuthSessionResponse {
        token,
        token_type: "Bearer",
        expires_at,
        user: build_user_profile(user),
    }
}

pub fn build_current_session_response(
    session: &SessionRecord,
    user: &UserRecord,
) -> CurrentSessionResponse {
    CurrentSessionResponse {
        expires_at: session.expires_at.to_owned(),
        user: build_user_profile(user),
    }
}

pub fn build_session(user_id: &str) -> SessionRecord {
    let now = Utc::now();

    SessionRecord {
        session_id: format!("sess_{}", short_id()),
        user_id: user_id.to_string(),
        token: format!("gtk_{}", short_id()),
        created_at: now,
        expires_at: now + Duration::days(SESSION_TTL_DAYS),
        last_seen_at: now,
    }
}

pub async fn require_auth(headers: &HeaderMap, state: &AppState) -> Result<AuthContext, AppError> {
    let header_value = headers
        .get(AUTHORIZATION)
        .ok_or_else(|| AppError::Unauthorized("missing bearer token".to_string()))?
        .to_str()
        .map_err(|_| AppError::Unauthorized("authorization header is invalid".to_string()))?;
    let token = header_value
        .strip_prefix("Bearer ")
        .or_else(|| header_value.strip_prefix("bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Unauthorized("missing bearer token".to_string()))?;

    let session = find_session_by_token(token, state)
        .await?
        .ok_or_else(|| AppError::Unauthorized("session not found".to_string()))?;

    if session.expires_at <= Utc::now() {
        let _ = revoke_session_by_token(token, state).await;
        return Err(AppError::Unauthorized("session expired".to_string()));
    }

    let user = find_user_by_id(&session.user_id, state)
        .await?
        .ok_or_else(|| AppError::Unauthorized("session user not found".to_string()))?;

    Ok(AuthContext { user, session })
}
