use chrono::Utc;
use serde_json::Value;
use std::net::IpAddr;
use std::str::FromStr;
use std::time::Duration;
use url::Url;

use crate::error::AppError;
use crate::types::{
    IpThreatConfigUpdateRequest, IpThreatConfigView, IpThreatLookupResponse,
    IpThreatProviderConfigRecord, IpThreatSummary,
};

pub const DEFAULT_SCAMALYTICS_BASE_URL: &str = "https://api13.scamalytics.com/v3";
pub const SCAMALYTICS_PROVIDER: &str = "scamalytics";
pub const SCAMALYTICS_SETTING_ID: &str = "ip_threat_provider:scamalytics";

#[derive(Clone)]
pub struct IpThreatClient {
    http: reqwest::Client,
}

impl IpThreatClient {
    pub fn new() -> Result<Self, AppError> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .pool_idle_timeout(Duration::from_secs(90))
            .pool_max_idle_per_host(8)
            .tcp_keepalive(Duration::from_secs(30))
            .build()
            .map_err(|err| AppError::Internal(format!("unable to build IP threat client: {err}")))?;

        Ok(Self { http })
    }

    pub fn view(&self, config: Option<&IpThreatProviderConfigRecord>) -> IpThreatConfigView {
        let base_url = config
            .map(|record| record.base_url.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or(DEFAULT_SCAMALYTICS_BASE_URL)
            .to_string();
        let username = config
            .map(|record| record.username.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or_default()
            .to_string();
        let api_key_set = config
            .map(|record| !record.api_key.trim().is_empty())
            .unwrap_or(false);

        IpThreatConfigView {
            configured: !username.is_empty() && api_key_set,
            base_url,
            username: username.clone(),
            username_set: !username.is_empty(),
            api_key_set,
            updated_at: config.map(|record| record.updated_at),
            updated_by_user_id: config.map(|record| record.updated_by_user_id.clone()),
        }
    }

    pub async fn lookup_ip(
        &self,
        ip: &str,
        test_mode: bool,
        provider_config: &IpThreatProviderConfigRecord,
    ) -> Result<IpThreatLookupResponse, AppError> {
        let ip = IpAddr::from_str(ip.trim())
            .map_err(|_| AppError::BadRequest("ip must be a valid IPv4 or IPv6 address".to_string()))?;
        let base_url = normalize_base_url(&provider_config.base_url)?;
        let username = normalize_required_field(&provider_config.username, "IP threat provider username")?;
        let api_key = normalize_required_field(&provider_config.api_key, "IP threat provider API key")?;

        let mut endpoint = base_url
            .join(&format!("{username}/"))
            .map_err(|err| AppError::Internal(format!("invalid IP threat endpoint: {err}")))?;
        {
            let mut query = endpoint.query_pairs_mut();
            query.append_pair("key", api_key);
            query.append_pair("ip", &ip.to_string());
            if test_mode {
                query.append_pair("test", "1");
            }
        }

        let response = self
            .http
            .get(endpoint)
            .send()
            .await
            .map_err(|err| AppError::Unavailable(format!("IP threat provider request failed: {err}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let detail = body.trim();
            let message = if detail.is_empty() {
                format!("IP threat provider returned {status}")
            } else {
                format!(
                    "IP threat provider returned {status}: {}",
                    truncate(detail, 180)
                )
            };
            return Err(AppError::Unavailable(message));
        }

        let raw: Value = response
            .json()
            .await
            .map_err(|err| AppError::Internal(format!("invalid IP threat response: {err}")))?;

        let provider_status = extract_summary_source(&raw)
            .and_then(|value| get_string(value, "status"))
            .unwrap_or_else(|| "unknown".to_string());
        if matches!(
            provider_status.to_ascii_lowercase().as_str(),
            "error" | "failed" | "denied"
        ) {
            let message = extract_summary_source(&raw)
                .and_then(|value| {
                    get_string(value, "message")
                        .or_else(|| get_string(value, "error"))
                        .or_else(|| get_string(value, "detail"))
                })
                .unwrap_or_else(|| "IP threat provider rejected the lookup request".to_string());
            return Err(AppError::Unavailable(message));
        }

        Ok(build_lookup_response(
            ip.to_string(),
            test_mode,
            base_url.as_str().trim_end_matches('/').to_string(),
            raw,
        ))
    }
}

pub fn build_ip_threat_provider_config(
    existing: Option<&IpThreatProviderConfigRecord>,
    payload: IpThreatConfigUpdateRequest,
    updated_by_user_id: &str,
) -> Result<IpThreatProviderConfigRecord, AppError> {
    let base_url_input = payload
        .base_url
        .unwrap_or_else(|| existing.map(|record| record.base_url.clone()).unwrap_or_else(|| DEFAULT_SCAMALYTICS_BASE_URL.to_string()));
    let username_input = payload
        .username
        .unwrap_or_else(|| existing.map(|record| record.username.clone()).unwrap_or_default());
    let api_key_input = payload
        .api_key
        .unwrap_or_else(|| existing.map(|record| record.api_key.clone()).unwrap_or_default());

    let base_url = normalize_base_url(&base_url_input)?
        .as_str()
        .trim_end_matches('/')
        .to_string();
    let username = normalize_required_field(&username_input, "IP threat provider username")?.to_string();
    let api_key = normalize_required_field(&api_key_input, "IP threat provider API key")?.to_string();

    Ok(IpThreatProviderConfigRecord {
        setting_id: SCAMALYTICS_SETTING_ID.to_string(),
        provider: SCAMALYTICS_PROVIDER.to_string(),
        base_url,
        username,
        api_key,
        updated_at: Utc::now(),
        updated_by_user_id: updated_by_user_id.to_string(),
    })
}

fn build_lookup_response(
    ip: String,
    test_mode: bool,
    provider_base_url: String,
    raw: Value,
) -> IpThreatLookupResponse {
    let scamalytics = raw.get("scamalytics").cloned();
    let external_datasources = raw
        .get("external_datasources")
        .cloned()
        .or_else(|| raw.get("externalDatasources").cloned());
    let summary_source = extract_summary_source(&raw).unwrap_or(&raw);

    let summary = IpThreatSummary {
        status: get_string(summary_source, "status").unwrap_or_else(|| "unknown".to_string()),
        score: get_i64(summary_source, "score"),
        risk: get_string(summary_source, "risk"),
        isp_score: get_i64(summary_source, "isp_score")
            .or_else(|| get_i64(summary_source, "ispScore")),
        isp_risk: get_string(summary_source, "isp_risk")
            .or_else(|| get_string(summary_source, "ispRisk")),
        is_proxy: get_bool(summary_source, "is_proxy")
            .or_else(|| get_bool(summary_source, "isProxy")),
        is_vpn: get_bool(summary_source, "is_vpn").or_else(|| get_bool(summary_source, "isVpn")),
        is_tor: get_bool(summary_source, "is_tor").or_else(|| get_bool(summary_source, "isTor")),
        is_datacenter: get_bool(summary_source, "is_datacenter")
            .or_else(|| get_bool(summary_source, "isDatacenter")),
        is_public_proxy: get_bool(summary_source, "is_public_proxy")
            .or_else(|| get_bool(summary_source, "isPublicProxy")),
        is_web_proxy: get_bool(summary_source, "is_web_proxy")
            .or_else(|| get_bool(summary_source, "isWebProxy")),
        is_anonymous: get_bool(summary_source, "is_anonymous")
            .or_else(|| get_bool(summary_source, "isAnonymous")),
        is_blacklisted: get_bool(summary_source, "is_blacklisted")
            .or_else(|| get_bool(summary_source, "blacklisted")),
        report_url: get_string(summary_source, "report_url")
            .or_else(|| get_string(summary_source, "reportUrl"))
            .or_else(|| get_string(summary_source, "url")),
    };

    IpThreatLookupResponse {
        provider: SCAMALYTICS_PROVIDER.to_string(),
        ip,
        test_mode,
        provider_base_url,
        summary,
        scamalytics,
        external_datasources,
        credits: raw.get("credits").cloned(),
        raw,
    }
}

fn normalize_base_url(value: &str) -> Result<Url, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "IP threat provider base URL is required".to_string(),
        ));
    }

    Url::parse(trimmed)
        .map_err(|err| AppError::BadRequest(format!("invalid IP threat base URL: {err}")))
}

fn normalize_required_field<'a>(value: &'a str, field_label: &str) -> Result<&'a str, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(format!("{field_label} is required")));
    }

    Ok(trimmed)
}

fn extract_summary_source<'a>(raw: &'a Value) -> Option<&'a Value> {
    raw.get("scamalytics").or_else(|| raw.get("summary"))
}

fn get_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|item| match item {
            Value::String(text) => Some(text.trim().to_string()).filter(|text| !text.is_empty()),
            Value::Number(number) => Some(number.to_string()),
            Value::Bool(flag) => Some(flag.to_string()),
            _ => None,
        })
}

fn get_i64(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(|item| match item {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    })
}

fn get_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(|item| match item {
        Value::Bool(flag) => Some(*flag),
        Value::Number(number) => number.as_i64().map(|value| value != 0),
        Value::String(text) => match text.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "y" => Some(true),
            "0" | "false" | "no" | "n" => Some(false),
            _ => None,
        },
        _ => None,
    })
}

fn truncate(value: &str, max_chars: usize) -> String {
    let mut truncated = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        truncated.push_str("...");
    }
    truncated
}
