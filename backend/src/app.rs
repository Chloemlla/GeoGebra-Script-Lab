use hyper::service::service_fn;
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto::Builder as AutoBuilder;
use tokio::net::TcpListener;

use crate::config::AppConfig;
use crate::http::handlers::handle_request;
use crate::state::build_state;

pub async fn run() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = AppConfig::from_env();
    let state = build_state(config).await?;

    let listener = TcpListener::bind(state.config.bind_addr).await?;
    println!(
        "geograba-backend listening on http://{}",
        state.config.bind_addr
    );
    println!(
        "model task dispatcher is enabled with concurrency {} and queue capacity {}",
        state.config.model_worker_concurrency.max(1),
        state.config.model_job_queue_capacity.max(1)
    );
    println!(
        "export task dispatcher is enabled with concurrency {} and queue capacity {}",
        state.config.export_worker_concurrency.max(1),
        state.config.export_job_queue_capacity.max(1)
    );
    if state.frontend_assets.files.is_empty() {
        println!("frontend asset hosting is disabled");
    } else {
        println!(
            "frontend asset hosting is enabled with {} preloaded files",
            state.frontend_assets.files.len()
        );
    }
    if state.mongo_store.is_some() {
        println!(
            "MongoDB persistence is enabled for database {}",
            state.config.mongodb_database
        );
    } else {
        println!("MongoDB persistence is disabled; runtime will fallback to in-memory data only");
    }
    let ip_threat_config = state.ip_threat_client.view();
    if ip_threat_config.configured {
        println!(
            "IP threat lookup is enabled via {}",
            ip_threat_config.base_url
        );
    } else {
        println!(
            "IP threat lookup is disabled; set IP_THREAT_USERNAME and IP_THREAT_API_KEY to enable it"
        );
    }

    loop {
        let (stream, _) = listener.accept().await?;
        if let Err(error) = stream.set_nodelay(true) {
            eprintln!("unable to enable TCP_NODELAY: {error}");
        }
        let state = state.clone();

        tokio::spawn(async move {
            let service = service_fn(move |request| handle_request(request, state.clone()));
            if let Err(error) = AutoBuilder::new(TokioExecutor::new())
                .serve_connection(TokioIo::new(stream), service)
                .await
            {
                eprintln!("connection error: {error}");
            }
        });
    }
}
