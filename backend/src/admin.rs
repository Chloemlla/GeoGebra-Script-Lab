use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::state::{AppState, ModelTaskDispatcherSnapshot};
use crate::types::{AssetRecord, DrawingJobRecord, JobStatus, ShareRecord};

const RECENT_ITEMS_LIMIT: usize = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminDashboardSnapshot {
    pub generated_at: DateTime<Utc>,
    pub runtime: RuntimeOverview,
    pub model: ModelOverview,
    pub dispatcher: ModelTaskDispatcherSnapshot,
    pub cache: CacheOverview,
    pub metrics: crate::metrics::MetricsSnapshot,
    pub recent_jobs: Vec<RecentJobView>,
    pub recent_assets: Vec<RecentAssetView>,
    pub recent_shares: Vec<RecentShareView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeOverview {
    pub started_at: DateTime<Utc>,
    pub uptime_seconds: u64,
    pub bind_addr: String,
    pub api_base_url: String,
    pub frontend_assets_loaded: usize,
    pub frontend_dist_enabled: bool,
    pub mongodb_enabled: bool,
    pub mongodb_database: String,
    pub model_worker_concurrency: usize,
    pub model_job_queue_capacity: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOverview {
    pub base_url: String,
    pub model_name: String,
    pub api_key_set: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheOverview {
    pub assets_total: usize,
    pub uploaded_assets_total: usize,
    pub asset_payloads_total: usize,
    pub jobs_total: usize,
    pub queued_jobs_total: usize,
    pub processing_jobs_total: usize,
    pub completed_jobs_total: usize,
    pub failed_jobs_total: usize,
    pub shares_total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentJobView {
    pub job_id: String,
    pub status: String,
    pub asset_id: String,
    pub prompt: String,
    pub scene_summary: String,
    pub command_count: usize,
    pub confidence: f32,
    pub human_review_recommended: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentAssetView {
    pub asset_id: String,
    pub filename: String,
    pub mime_type: String,
    pub purpose: String,
    pub canvas_mode: String,
    pub uploaded: bool,
    pub uploaded_bytes: u64,
    pub uploaded_at: Option<DateTime<Utc>>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentShareView {
    pub share_id: String,
    pub slug: String,
    pub title: String,
    pub visibility: String,
    pub allow_fork: bool,
    pub command_count: usize,
    pub share_url: String,
    pub created_at: DateTime<Utc>,
}

pub async fn build_admin_dashboard(state: &AppState) -> AdminDashboardSnapshot {
    let store = state.store.read().await;
    let metrics = state.metrics.snapshot();
    let model_view = state.model_client.view();
    let dispatcher = state.model_task_dispatcher.snapshot();

    let assets = store.assets.values().cloned().collect::<Vec<_>>();
    let jobs = store.jobs.values().cloned().collect::<Vec<_>>();
    let shares = store.shares.values().cloned().collect::<Vec<_>>();

    let uploaded_assets_total = assets.iter().filter(|asset| asset.uploaded).count();
    let queued_jobs_total = jobs
        .iter()
        .filter(|job| job.status == JobStatus::Queued)
        .count();
    let processing_jobs_total = jobs
        .iter()
        .filter(|job| job.status == JobStatus::Processing)
        .count();
    let completed_jobs_total = jobs
        .iter()
        .filter(|job| job.status == JobStatus::Completed)
        .count();
    let failed_jobs_total = jobs
        .iter()
        .filter(|job| job.status == JobStatus::Failed)
        .count();

    AdminDashboardSnapshot {
        generated_at: Utc::now(),
        runtime: RuntimeOverview {
            started_at: state.started_at_wall_clock,
            uptime_seconds: state.started_at.elapsed().as_secs(),
            bind_addr: state.config.bind_addr.to_string(),
            api_base_url: state.config.api_base_url.clone(),
            frontend_assets_loaded: state.frontend_assets.files.len(),
            frontend_dist_enabled: state.config.frontend_dist_dir.is_some(),
            mongodb_enabled: state.mongo_store.is_some(),
            mongodb_database: state.config.mongodb_database.clone(),
            model_worker_concurrency: state.config.model_worker_concurrency.max(1),
            model_job_queue_capacity: state.config.model_job_queue_capacity.max(1),
        },
        model: ModelOverview {
            base_url: model_view.base_url,
            model_name: model_view.model_name,
            api_key_set: model_view.api_key_set,
        },
        dispatcher,
        cache: CacheOverview {
            assets_total: assets.len(),
            uploaded_assets_total,
            asset_payloads_total: store.asset_payloads.len(),
            jobs_total: jobs.len(),
            queued_jobs_total,
            processing_jobs_total,
            completed_jobs_total,
            failed_jobs_total,
            shares_total: shares.len(),
        },
        metrics,
        recent_jobs: build_recent_jobs(jobs),
        recent_assets: build_recent_assets(assets),
        recent_shares: build_recent_shares(shares),
    }
}

fn build_recent_jobs(mut jobs: Vec<DrawingJobRecord>) -> Vec<RecentJobView> {
    jobs.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    jobs.into_iter()
        .take(RECENT_ITEMS_LIMIT)
        .map(|job| RecentJobView {
            job_id: job.job_id,
            status: format_job_status(job.status),
            asset_id: job.asset_id,
            prompt: job.prompt,
            scene_summary: job.scene_summary,
            command_count: job.commands.len(),
            confidence: job.diagnostics.confidence,
            human_review_recommended: job.diagnostics.human_review_recommended,
            created_at: job.created_at,
            updated_at: job.updated_at,
        })
        .collect()
}

fn build_recent_assets(mut assets: Vec<AssetRecord>) -> Vec<RecentAssetView> {
    assets.sort_by(|left, right| right.expires_at.cmp(&left.expires_at));
    assets
        .into_iter()
        .take(RECENT_ITEMS_LIMIT)
        .map(|asset| RecentAssetView {
            asset_id: asset.asset_id,
            filename: asset.filename,
            mime_type: asset.mime_type,
            purpose: asset.purpose,
            canvas_mode: asset.canvas_mode,
            uploaded: asset.uploaded,
            uploaded_bytes: asset.uploaded_bytes,
            uploaded_at: asset.uploaded_at,
            expires_at: asset.expires_at,
        })
        .collect()
}

fn build_recent_shares(mut shares: Vec<ShareRecord>) -> Vec<RecentShareView> {
    shares.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    shares
        .into_iter()
        .take(RECENT_ITEMS_LIMIT)
        .map(|share| RecentShareView {
            share_id: share.share_id,
            slug: share.slug,
            title: share.title,
            visibility: share.visibility,
            allow_fork: share.allow_fork,
            command_count: share.commands.len(),
            share_url: share.share_url,
            created_at: share.created_at,
        })
        .collect()
}

fn format_job_status(status: JobStatus) -> String {
    match status {
        JobStatus::Queued => "queued",
        JobStatus::Processing => "processing",
        JobStatus::Completed => "completed",
        JobStatus::Failed => "failed",
    }
    .to_string()
}
