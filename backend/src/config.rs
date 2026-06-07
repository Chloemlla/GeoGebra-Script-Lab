use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub bind_addr: SocketAddr,
    pub api_base_url: String,
    pub frontend_base_url: String,
    pub model_base_url: String,
    pub model_name: String,
    pub api_key: String,
    pub synapse_base_url: String,
    pub synapse_oauth_client_id: String,
    pub synapse_oauth_client_secret: String,
    pub synapse_oauth_redirect_uri: String,
    pub synapse_oauth_scope: String,
    pub model_worker_concurrency: usize,
    pub model_job_queue_capacity: usize,
    pub export_worker_concurrency: usize,
    pub export_job_queue_capacity: usize,
    pub frontend_dist_dir: Option<PathBuf>,
    pub mongodb_uri: Option<String>,
    pub mongodb_database: String,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let bind_addr = env::var("BIND_ADDR")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or_else(|| SocketAddr::from(([127, 0, 0, 1], 3001)));

        let api_base_url =
            env_string("API_BASE_URL").unwrap_or_else(|| "http://127.0.0.1:3001".to_string());
        let frontend_base_url =
            env_string("FRONTEND_BASE_URL").unwrap_or_else(|| api_base_url.clone());
        let model_base_url =
            env_string("MODEL_BASE_URL").unwrap_or_else(|| "https://api.openai.com/v1".to_string());
        let model_name = env_string("MODEL_NAME").unwrap_or_else(|| "gpt-4.1-mini".to_string());
        let api_key = env_string("API_KEY").unwrap_or_default();
        let synapse_base_url = env_string("SYNAPSE_BASE_URL")
            .unwrap_or_else(|| "https://tts.chloemlla.com".to_string())
            .trim_end_matches('/')
            .to_string();
        let synapse_oauth_client_id = env_string("SYNAPSE_OAUTH_CLIENT_ID").unwrap_or_default();
        let synapse_oauth_client_secret =
            env_string("SYNAPSE_OAUTH_CLIENT_SECRET").unwrap_or_default();
        let synapse_oauth_redirect_uri =
            env_string("SYNAPSE_OAUTH_REDIRECT_URI").unwrap_or_else(|| {
                format!(
                    "{}/api/v1/auth/oauth/callback",
                    api_base_url.trim_end_matches('/')
                )
            });
        let synapse_oauth_scope = env_string("SYNAPSE_OAUTH_SCOPE")
            .unwrap_or_else(|| "openid profile email admin:identity".to_string());
        let model_worker_concurrency = env::var("MODEL_WORKER_CONCURRENCY")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(4)
            .max(1);
        let model_job_queue_capacity = env::var("MODEL_JOB_QUEUE_CAPACITY")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(64)
            .max(1);
        let export_worker_concurrency = env::var("EXPORT_WORKER_CONCURRENCY")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(2)
            .max(1);
        let export_job_queue_capacity = env::var("EXPORT_JOB_QUEUE_CAPACITY")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(16)
            .max(1);
        let frontend_dist_dir = env_string("FRONTEND_DIST_DIR").map(PathBuf::from);
        let mongodb_uri = env_string("MONGODB_URI");
        let mongodb_database =
            env_string("MONGODB_DATABASE").unwrap_or_else(|| "geograba".to_string());

        Self {
            bind_addr,
            api_base_url,
            frontend_base_url,
            model_base_url,
            model_name,
            api_key,
            synapse_base_url,
            synapse_oauth_client_id,
            synapse_oauth_client_secret,
            synapse_oauth_redirect_uri,
            synapse_oauth_scope,
            model_worker_concurrency,
            model_job_queue_capacity,
            export_worker_concurrency,
            export_job_queue_capacity,
            frontend_dist_dir,
            mongodb_uri,
            mongodb_database,
        }
    }
}

fn env_string(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
