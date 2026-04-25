use bytes::Bytes;
use http::{HeaderValue, StatusCode};
use http_body_util::Full;
use hyper::Response;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::error::AppError;

#[derive(Debug, Clone)]
pub struct StaticAsset {
    pub body: Bytes,
    pub content_type: &'static str,
    pub cache_control: &'static str,
}

#[derive(Debug, Default)]
pub struct FrontendAssets {
    pub files: HashMap<String, StaticAsset>,
    pub index: Option<StaticAsset>,
}

impl FrontendAssets {
    pub fn load(root: Option<&Path>) -> Self {
        let Some(root) = root else {
            return Self::default();
        };

        if !root.exists() || !root.is_dir() {
            eprintln!("frontend dist directory is unavailable: {}", root.display());
            return Self::default();
        }

        let mut files = HashMap::new();
        if let Err(error) = load_frontend_dir(root, root, &mut files) {
            eprintln!(
                "unable to preload frontend assets from {}: {error}",
                root.display()
            );
            return Self::default();
        }

        let index = files.get("/index.html").cloned();
        if let Some(index_asset) = index.clone() {
            files.insert("/".to_string(), index_asset);
        }

        Self { files, index }
    }
}

pub fn serve_frontend_asset(
    path: String,
    frontend_assets: &FrontendAssets,
) -> Result<Response<Full<Bytes>>, AppError> {
    if let Some(asset) = frontend_assets.files.get(&path) {
        return Ok(static_asset_response(asset.clone()));
    }

    if is_spa_route(&path) {
        if let Some(asset) = &frontend_assets.index {
            return Ok(static_asset_response(asset.clone()));
        }
    }

    Err(AppError::NotFound)
}

fn static_asset_response(asset: StaticAsset) -> Response<Full<Bytes>> {
    let len = asset.body.len();
    let mut response = Response::new(Full::new(asset.body));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        http::header::CONTENT_TYPE,
        HeaderValue::from_static(asset.content_type),
    );
    response.headers_mut().insert(
        http::header::CACHE_CONTROL,
        HeaderValue::from_static(asset.cache_control),
    );
    if let Ok(value) = HeaderValue::from_str(&len.to_string()) {
        response
            .headers_mut()
            .insert(http::header::CONTENT_LENGTH, value);
    }
    response
}

fn load_frontend_dir(
    root: &Path,
    current: &Path,
    files: &mut HashMap<String, StaticAsset>,
) -> Result<(), std::io::Error> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_dir() {
            load_frontend_dir(root, &path, files)?;
            continue;
        }

        if !path.is_file() {
            continue;
        }

        let relative = match path.strip_prefix(root) {
            Ok(relative) => relative,
            Err(_) => continue,
        };
        let route_path = format!("/{}", relative.to_string_lossy().replace('\\', "/"));
        let asset = StaticAsset {
            body: Bytes::from(fs::read(&path)?),
            content_type: content_type_for_path(&path),
            cache_control: cache_control_for_path(&route_path),
        };

        files.insert(route_path, asset);
    }

    Ok(())
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("ttf") => "font/ttf",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn cache_control_for_path(route_path: &str) -> &'static str {
    if route_path == "/" || route_path.ends_with(".html") {
        "no-cache"
    } else {
        "public, max-age=31536000, immutable"
    }
}

fn is_spa_route(path: &str) -> bool {
    let segment = path.rsplit('/').next().unwrap_or_default();
    !segment.contains('.')
}
