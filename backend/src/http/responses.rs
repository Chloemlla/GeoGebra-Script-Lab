use bytes::Bytes;
use chrono::Utc;
use http::{HeaderValue, StatusCode};
use http_body_util::Full;
use hyper::Response;
use serde::Serialize;
use serde_json::Value;

use crate::error::AppError;
use crate::types::{ApiEnvelope, ApiErrorBody, ApiMeta};
use crate::utils::request_id;

pub fn json_response<T: Serialize>(
    status: StatusCode,
    envelope: ApiEnvelope<T>,
) -> Response<Full<Bytes>> {
    let body = serde_json::to_vec(&envelope).unwrap_or_else(|_| b"{}".to_vec());
    bytes_response(status, Bytes::from(body), "application/json; charset=utf-8")
}

pub fn text_response(
    status: StatusCode,
    body: &str,
    content_type: &'static str,
) -> Response<Full<Bytes>> {
    bytes_response(
        status,
        Bytes::copy_from_slice(body.as_bytes()),
        content_type,
    )
}

pub fn bytes_response(
    status: StatusCode,
    body: Bytes,
    content_type: &'static str,
) -> Response<Full<Bytes>> {
    let len = body.len();
    let mut response = Response::new(Full::new(body));
    *response.status_mut() = status;
    response.headers_mut().insert(
        http::header::CONTENT_TYPE,
        HeaderValue::from_static(content_type),
    );
    if let Ok(value) = HeaderValue::from_str(&len.to_string()) {
        response
            .headers_mut()
            .insert(http::header::CONTENT_LENGTH, value);
    }
    response
}

pub fn cors_preflight_response() -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::new()));
    *response.status_mut() = StatusCode::NO_CONTENT;
    response
}

pub fn with_cors(mut response: Response<Full<Bytes>>) -> Response<Full<Bytes>> {
    response.headers_mut().insert(
        http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response.headers_mut().insert(
        http::header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, PUT, OPTIONS"),
    );
    response.headers_mut().insert(
        http::header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type, Authorization"),
    );
    response.headers_mut().insert(
        http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Type"),
    );
    response
}

pub fn error_response(error: AppError) -> Response<Full<Bytes>> {
    match error {
        AppError::NotFound => json_response(
            StatusCode::NOT_FOUND,
            envelope::<Value>(
                false,
                "NOT_FOUND",
                "resource not found",
                request_id(),
                None,
                Some(ApiErrorBody {
                    message: "not found".to_string(),
                    details: None,
                }),
            ),
        ),
        AppError::BadRequest(message) => json_response(StatusCode::BAD_REQUEST, {
            let response_message = message.clone();
            envelope::<Value>(
                false,
                "BAD_REQUEST",
                &response_message,
                request_id(),
                None,
                Some(ApiErrorBody {
                    message,
                    details: None,
                }),
            )
        }),
        AppError::Unauthorized(message) => json_response(StatusCode::UNAUTHORIZED, {
            let response_message = message.clone();
            envelope::<Value>(
                false,
                "UNAUTHORIZED",
                &response_message,
                request_id(),
                None,
                Some(ApiErrorBody {
                    message,
                    details: None,
                }),
            )
        }),
        AppError::Conflict(message) => json_response(StatusCode::CONFLICT, {
            let response_message = message.clone();
            envelope::<Value>(
                false,
                "CONFLICT",
                &response_message,
                request_id(),
                None,
                Some(ApiErrorBody {
                    message,
                    details: None,
                }),
            )
        }),
        AppError::Unavailable(message) => json_response(StatusCode::SERVICE_UNAVAILABLE, {
            let response_message = message.clone();
            envelope::<Value>(
                false,
                "SERVICE_UNAVAILABLE",
                &response_message,
                request_id(),
                None,
                Some(ApiErrorBody {
                    message,
                    details: None,
                }),
            )
        }),
        AppError::Internal(message) => json_response(StatusCode::INTERNAL_SERVER_ERROR, {
            let response_message = message.clone();
            envelope::<Value>(
                false,
                "INTERNAL_ERROR",
                &response_message,
                request_id(),
                None,
                Some(ApiErrorBody {
                    message,
                    details: None,
                }),
            )
        }),
    }
}

pub fn envelope<T: Serialize>(
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
