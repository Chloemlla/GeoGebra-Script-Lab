use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub bind_addr: SocketAddr,
    pub api_base_url: String,
    pub model_base_url: String,
    pub model_name: String,
    pub api_key: String,
    pub ip_threat_base_url: String,
    pub ip_threat_username: String,
    pub ip_threat_api_key: String,
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
            env::var("API_BASE_URL").unwrap_or_else(|_| "http://127.0.0.1:3001".to_string());
        let model_base_url =
            env::var("MODEL_BASE_URL").unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
        let model_name = env::var("MODEL_NAME").unwrap_or_else(|_| "gpt-4.1-mini".to_string());
        let api_key = env::var("API_KEY").unwrap_or_default();
        let ip_threat_base_url = env::var("IP_THREAT_BASE_URL")
            .unwrap_or_else(|_| "https://api13.scamalytics.com/v3".to_string());
        let ip_threat_username = env::var("IP_THREAT_USERNAME").unwrap_or_default();
        let ip_threat_api_key = env::var("IP_THREAT_API_KEY").unwrap_or_default();
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
        let frontend_dist_dir = env::var("FRONTEND_DIST_DIR").ok().map(PathBuf::from);
        let mongodb_uri = env::var("MONGODB_URI")
            .ok()
            .filter(|value| !value.trim().is_empty());
        let mongodb_database =
            env::var("MONGODB_DATABASE").unwrap_or_else(|_| "geograba".to_string());

        Self {
            bind_addr,
            api_base_url,
            model_base_url,
            model_name,
            api_key,
            ip_threat_base_url,
            ip_threat_username,
            ip_threat_api_key,
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
