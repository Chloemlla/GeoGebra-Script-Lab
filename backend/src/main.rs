mod admin;
mod app;
mod auth;
mod config;
mod error;
mod frontend;
mod http;
mod metrics;
mod model;
mod state;
mod storage;
mod store;
mod types;
mod utils;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    app::run().await
}
