use base64::Engine;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use tokio::sync::{mpsc, RwLock, Semaphore};

use crate::config::AppConfig;
use crate::error::AppError;
use crate::frontend::FrontendAssets;
use crate::metrics::MetricsRegistry;
use crate::model::{ModelClient, ModelDrawingResponse};
use crate::storage::{build_media_export, build_pdf_export, build_svg_export};
use crate::store::{MemoryStore, MongoStore};
use crate::threat_intel::IpThreatClient;
use crate::types::{
    Diagnostics, DrawingJobCreateRequest, ExportJobCreateRequest, ExportJobStatus, JobStatus,
};
use crate::utils::fallback_commands;

#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub store: Arc<RwLock<MemoryStore>>,
    pub model_client: Arc<ModelClient>,
    pub ip_threat_client: Arc<IpThreatClient>,
    pub model_task_dispatcher: Arc<ModelTaskDispatcher>,
    pub export_task_dispatcher: Arc<ExportTaskDispatcher>,
    pub frontend_assets: Arc<FrontendAssets>,
    pub metrics: Arc<MetricsRegistry>,
    pub mongo_store: Option<Arc<MongoStore>>,
    pub started_at: Instant,
    pub started_at_wall_clock: chrono::DateTime<Utc>,
}

#[derive(Clone)]
pub struct ModelTaskDispatcher {
    sender: mpsc::Sender<ModelTask>,
    stats: Arc<TaskDispatcherStats>,
}

#[derive(Clone)]
struct ModelTask {
    job_id: String,
    request: DrawingJobCreateRequest,
}

#[derive(Clone)]
pub struct ExportTaskDispatcher {
    sender: mpsc::Sender<ExportTask>,
    stats: Arc<TaskDispatcherStats>,
}

#[derive(Clone)]
struct ExportTask {
    export_job_id: String,
    request: ExportJobCreateRequest,
}

#[derive(Debug)]
struct TaskDispatcherStats {
    worker_concurrency: usize,
    queue_capacity: usize,
    queued_jobs: AtomicUsize,
    active_workers: AtomicUsize,
    enqueued_total: AtomicU64,
    completed_total: AtomicU64,
    failed_enqueue_total: AtomicU64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTaskDispatcherSnapshot {
    pub worker_concurrency: usize,
    pub queue_capacity: usize,
    pub queued_jobs: usize,
    pub active_workers: usize,
    pub enqueued_total: u64,
    pub completed_total: u64,
    pub failed_enqueue_total: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTaskDispatcherSnapshot {
    pub worker_concurrency: usize,
    pub queue_capacity: usize,
    pub queued_jobs: usize,
    pub active_workers: usize,
    pub enqueued_total: u64,
    pub completed_total: u64,
    pub failed_enqueue_total: u64,
}

impl ModelTaskDispatcher {
    pub fn new(
        config: &AppConfig,
        model_client: Arc<ModelClient>,
        store: Arc<RwLock<MemoryStore>>,
        metrics: Arc<MetricsRegistry>,
        mongo_store: Option<Arc<MongoStore>>,
    ) -> Self {
        let worker_concurrency = config.model_worker_concurrency.max(1);
        let queue_capacity = config.model_job_queue_capacity.max(1);
        let (sender, mut receiver) = mpsc::channel(queue_capacity);
        let semaphore = Arc::new(Semaphore::new(worker_concurrency));
        let stats = Arc::new(TaskDispatcherStats {
            worker_concurrency,
            queue_capacity,
            queued_jobs: AtomicUsize::new(0),
            active_workers: AtomicUsize::new(0),
            enqueued_total: AtomicU64::new(0),
            completed_total: AtomicU64::new(0),
            failed_enqueue_total: AtomicU64::new(0),
        });
        let worker_stats = stats.clone();

        tokio::spawn(async move {
            while let Some(task) = receiver.recv().await {
                worker_stats.queued_jobs.fetch_sub(1, Ordering::Relaxed);
                let permit = match semaphore.clone().acquire_owned().await {
                    Ok(permit) => permit,
                    Err(_) => break,
                };
                let model_client = model_client.clone();
                let store = store.clone();
                let metrics = metrics.clone();
                let mongo_store = mongo_store.clone();
                let task_stats = worker_stats.clone();

                tokio::spawn(async move {
                    task_stats.active_workers.fetch_add(1, Ordering::Relaxed);
                    process_model_task(task, model_client, store, metrics, mongo_store).await;
                    task_stats.active_workers.fetch_sub(1, Ordering::Relaxed);
                    task_stats.completed_total.fetch_add(1, Ordering::Relaxed);
                    drop(permit);
                });
            }
        });

        Self { sender, stats }
    }

    pub fn enqueue(
        &self,
        job_id: String,
        request: DrawingJobCreateRequest,
    ) -> Result<(), AppError> {
        self.sender
            .try_send(ModelTask { job_id, request })
            .map(|_| {
                self.stats.enqueued_total.fetch_add(1, Ordering::Relaxed);
                self.stats.queued_jobs.fetch_add(1, Ordering::Relaxed);
            })
            .map_err(|error| {
                self.stats
                    .failed_enqueue_total
                    .fetch_add(1, Ordering::Relaxed);
                match error {
                    mpsc::error::TrySendError::Full(_) => {
                        AppError::Unavailable("model job queue is full".to_string())
                    }
                    mpsc::error::TrySendError::Closed(_) => {
                        AppError::Internal("model task dispatcher is unavailable".to_string())
                    }
                }
            })
    }

    pub fn snapshot(&self) -> ModelTaskDispatcherSnapshot {
        ModelTaskDispatcherSnapshot {
            worker_concurrency: self.stats.worker_concurrency,
            queue_capacity: self.stats.queue_capacity,
            queued_jobs: self.stats.queued_jobs.load(Ordering::Relaxed),
            active_workers: self.stats.active_workers.load(Ordering::Relaxed),
            enqueued_total: self.stats.enqueued_total.load(Ordering::Relaxed),
            completed_total: self.stats.completed_total.load(Ordering::Relaxed),
            failed_enqueue_total: self.stats.failed_enqueue_total.load(Ordering::Relaxed),
        }
    }
}

impl ExportTaskDispatcher {
    pub fn new(
        worker_concurrency: usize,
        queue_capacity: usize,
        store: Arc<RwLock<MemoryStore>>,
        metrics: Arc<MetricsRegistry>,
        mongo_store: Option<Arc<MongoStore>>,
    ) -> Self {
        let (sender, mut receiver) = mpsc::channel(queue_capacity);
        let semaphore = Arc::new(Semaphore::new(worker_concurrency));
        let stats = Arc::new(TaskDispatcherStats {
            worker_concurrency,
            queue_capacity,
            queued_jobs: AtomicUsize::new(0),
            active_workers: AtomicUsize::new(0),
            enqueued_total: AtomicU64::new(0),
            completed_total: AtomicU64::new(0),
            failed_enqueue_total: AtomicU64::new(0),
        });
        let worker_stats = stats.clone();

        tokio::spawn(async move {
            while let Some(task) = receiver.recv().await {
                worker_stats.queued_jobs.fetch_sub(1, Ordering::Relaxed);
                let permit = match semaphore.clone().acquire_owned().await {
                    Ok(permit) => permit,
                    Err(_) => break,
                };
                let store = store.clone();
                let metrics = metrics.clone();
                let mongo_store = mongo_store.clone();
                let task_stats = worker_stats.clone();

                tokio::spawn(async move {
                    task_stats.active_workers.fetch_add(1, Ordering::Relaxed);
                    process_export_task(task, store, metrics, mongo_store).await;
                    task_stats.active_workers.fetch_sub(1, Ordering::Relaxed);
                    task_stats.completed_total.fetch_add(1, Ordering::Relaxed);
                    drop(permit);
                });
            }
        });

        Self { sender, stats }
    }

    pub fn enqueue(
        &self,
        export_job_id: String,
        request: ExportJobCreateRequest,
    ) -> Result<(), AppError> {
        self.sender
            .try_send(ExportTask {
                export_job_id,
                request,
            })
            .map(|_| {
                self.stats.enqueued_total.fetch_add(1, Ordering::Relaxed);
                self.stats.queued_jobs.fetch_add(1, Ordering::Relaxed);
            })
            .map_err(|error| {
                self.stats
                    .failed_enqueue_total
                    .fetch_add(1, Ordering::Relaxed);
                match error {
                    mpsc::error::TrySendError::Full(_) => {
                        AppError::Unavailable("export job queue is full".to_string())
                    }
                    mpsc::error::TrySendError::Closed(_) => {
                        AppError::Internal("export task dispatcher is unavailable".to_string())
                    }
                }
            })
    }

    pub fn snapshot(&self) -> ExportTaskDispatcherSnapshot {
        ExportTaskDispatcherSnapshot {
            worker_concurrency: self.stats.worker_concurrency,
            queue_capacity: self.stats.queue_capacity,
            queued_jobs: self.stats.queued_jobs.load(Ordering::Relaxed),
            active_workers: self.stats.active_workers.load(Ordering::Relaxed),
            enqueued_total: self.stats.enqueued_total.load(Ordering::Relaxed),
            completed_total: self.stats.completed_total.load(Ordering::Relaxed),
            failed_enqueue_total: self.stats.failed_enqueue_total.load(Ordering::Relaxed),
        }
    }
}

pub async fn build_state(config: AppConfig) -> Result<AppState, AppError> {
    let metrics = Arc::new(MetricsRegistry::default());
    let started_at = Instant::now();
    let started_at_wall_clock = Utc::now();
    let store = Arc::new(RwLock::new(MemoryStore::default()));
    let model_client = Arc::new(ModelClient::new(
        config.model_base_url.clone(),
        config.model_name.clone(),
        config.api_key.clone(),
    )?);
    let ip_threat_client = Arc::new(IpThreatClient::new(&config)?);
    let frontend_assets = Arc::new(FrontendAssets::load(config.frontend_dist_dir.as_deref()));
    let mongo_store = match &config.mongodb_uri {
        Some(uri) => Some(Arc::new(
            MongoStore::connect(uri, &config.mongodb_database, metrics.clone()).await?,
        )),
        None => None,
    };
    let model_task_dispatcher = Arc::new(ModelTaskDispatcher::new(
        &config,
        model_client.clone(),
        store.clone(),
        metrics.clone(),
        mongo_store.clone(),
    ));
    let export_task_dispatcher = Arc::new(ExportTaskDispatcher::new(
        config.export_worker_concurrency.max(1),
        config.export_job_queue_capacity.max(1),
        store.clone(),
        metrics.clone(),
        mongo_store.clone(),
    ));

    Ok(AppState {
        config,
        store,
        model_client,
        ip_threat_client,
        model_task_dispatcher,
        export_task_dispatcher,
        frontend_assets,
        metrics,
        mongo_store,
        started_at,
        started_at_wall_clock,
    })
}

async fn process_model_task(
    task: ModelTask,
    model_client: Arc<ModelClient>,
    store: Arc<RwLock<MemoryStore>>,
    metrics: Arc<MetricsRegistry>,
    mongo_store: Option<Arc<MongoStore>>,
) {
    let processing_snapshot = {
        let mut store = store.write().await;
        if let Some(job) = store.jobs.get_mut(&task.job_id) {
            job.status = JobStatus::Processing;
            job.updated_at = Utc::now();
            Some(job.clone())
        } else {
            None
        }
    };

    if let (Some(mongo_store), Some(job_snapshot)) = (&mongo_store, processing_snapshot.as_ref()) {
        let _ = mongo_store.upsert_job(job_snapshot).await;
    }

    let model_started_at = Instant::now();
    let mut result = model_client
        .generate_drawing_commands(&task.request)
        .await
        .unwrap_or_else(|_| ModelDrawingResponse::fallback());
    metrics.record_model_call("generate_drawing_commands", model_started_at.elapsed());

    if result.commands.is_empty() {
        result.commands = fallback_commands();
    }

    let ModelDrawingResponse {
        scene_summary,
        commands,
        confidence,
        human_review_recommended,
    } = result;

    let completed_snapshot = {
        let mut store = store.write().await;
        if let Some(job) = store.jobs.get_mut(&task.job_id) {
            job.status = JobStatus::Completed;
            job.commands = commands;
            job.scene_summary = scene_summary;
            job.updated_at = Utc::now();
            job.diagnostics = Diagnostics {
                confidence,
                human_review_recommended,
            };
            Some(job.clone())
        } else {
            None
        }
    };

    if let (Some(mongo_store), Some(job_snapshot)) = (&mongo_store, completed_snapshot.as_ref()) {
        let _ = mongo_store.upsert_job(job_snapshot).await;
    }
}

async fn process_export_task(
    task: ExportTask,
    store: Arc<RwLock<MemoryStore>>,
    metrics: Arc<MetricsRegistry>,
    mongo_store: Option<Arc<MongoStore>>,
) {
    let processing_snapshot = {
        let mut store = store.write().await;
        if let Some(job) = store.export_jobs.get_mut(&task.export_job_id) {
            job.status = ExportJobStatus::Processing;
            job.updated_at = Utc::now();
            Some(job.clone())
        } else {
            None
        }
    };

    if let (Some(mongo_store), Some(export_snapshot)) = (&mongo_store, processing_snapshot.as_ref())
    {
        let _ = mongo_store.upsert_export_job(export_snapshot).await;
    }

    let started_at = Instant::now();
    let export_job_id = task.export_job_id.clone();
    let store_for_task = store.clone();
    let result = tokio::task::spawn_blocking(move || {
        let cover_bytes = task.request.asset_id.as_deref().and_then(|asset_id| {
            store_for_task
                .try_read()
                .ok()
                .and_then(|store| store.asset_payloads.get(asset_id).cloned())
                .map(|payload| payload.bytes.to_vec())
        });

        let bytes = match task.request.format.as_str() {
            "svg" => build_svg_export(
                task.request.title.as_deref().unwrap_or("GeoGebra Export"),
                &task.request.canvas_mode,
                &task.request.commands,
            )
            .into_bytes(),
            "pdf" => build_pdf_export(
                task.request.title.as_deref().unwrap_or("GeoGebra Export"),
                &task.request.canvas_mode,
                &task.request.commands,
            ),
            "gif" | "mp4" => build_media_export(
                &task.request.format,
                task.request.title.as_deref().unwrap_or("GeoGebra Export"),
                &task.request.canvas_mode,
                &task.request.commands,
                cover_bytes.as_deref(),
            )?,
            _ => serde_json::to_vec_pretty(&serde_json::json!({
                "title": task.request.title,
                "canvasMode": task.request.canvas_mode,
                "format": task.request.format,
                "options": task.request.options,
                "commands": task.request.commands,
            }))
            .map_err(|err| {
                AppError::Internal(format!("unable to serialize export payload: {err}"))
            })?,
        };

        Ok::<Vec<u8>, AppError>(bytes)
    })
    .await;
    metrics.record_model_call("process_export_task", started_at.elapsed());

    let completed_snapshot = {
        let mut store = store.write().await;
        if let Some(job) = store.export_jobs.get_mut(&export_job_id) {
            match result {
                Ok(Ok(bytes)) => {
                    job.status = ExportJobStatus::Completed;
                    job.asset_base64 =
                        Some(base64::engine::general_purpose::STANDARD.encode(bytes));
                    job.error_message = None;
                }
                Ok(Err(error)) => {
                    job.status = ExportJobStatus::Failed;
                    job.error_message = Some(error.to_string());
                }
                Err(error) => {
                    job.status = ExportJobStatus::Failed;
                    job.error_message = Some(format!("export task join error: {error}"));
                }
            }
            job.updated_at = Utc::now();
            Some(job.clone())
        } else {
            None
        }
    };

    if let (Some(mongo_store), Some(export_snapshot)) = (&mongo_store, completed_snapshot.as_ref())
    {
        let _ = mongo_store.upsert_export_job(export_snapshot).await;
    }
}
