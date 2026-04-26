use chrono::{DateTime, Utc};
use http::Method;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::RwLock;
use std::time::Duration;

const MAX_SAMPLES: usize = 4096;
const UPLOAD_BUCKETS: [u64; 5] = [
    64 * 1024,
    256 * 1024,
    1024 * 1024,
    4 * 1024 * 1024,
    16 * 1024 * 1024,
];
const UPLOAD_BUCKET_LABELS: [&str; 6] = [
    "<=64KiB", "<=256KiB", "<=1MiB", "<=4MiB", "<=16MiB", ">16MiB",
];

#[derive(Default)]
pub struct MetricsRegistry {
    inner: RwLock<MetricsInner>,
}

#[derive(Default)]
struct MetricsInner {
    endpoints: HashMap<String, SampleWindow>,
    mongo_queries: HashMap<String, SampleWindow>,
    model_calls: HashMap<String, SampleWindow>,
    upload_sizes: SizeDistribution,
}

#[derive(Default)]
struct SampleWindow {
    count: u64,
    total_micros: u128,
    max_micros: u64,
    samples: VecDeque<u64>,
}

#[derive(Default)]
struct SizeDistribution {
    count: u64,
    total_bytes: u128,
    min_bytes: Option<u64>,
    max_bytes: u64,
    samples: VecDeque<u64>,
    bucket_counts: [u64; 6],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSnapshot {
    collected_at: DateTime<Utc>,
    endpoints: Vec<LatencySnapshot>,
    mongo_queries: Vec<LatencySnapshot>,
    model_calls: Vec<LatencySnapshot>,
    upload_sizes: UploadSizeSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencySnapshot {
    name: String,
    count: u64,
    average_ms: f64,
    p50_ms: f64,
    p95_ms: f64,
    p99_ms: f64,
    max_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadSizeSnapshot {
    count: u64,
    average_bytes: f64,
    min_bytes: u64,
    p50_bytes: u64,
    p95_bytes: u64,
    p99_bytes: u64,
    max_bytes: u64,
    buckets: Vec<UploadSizeBucket>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadSizeBucket {
    label: &'static str,
    count: u64,
}

impl MetricsRegistry {
    pub fn record_request(&self, endpoint: &str, duration: Duration) {
        let mut inner = self.inner.write().expect("metrics lock poisoned");
        inner
            .endpoints
            .entry(endpoint.to_string())
            .or_default()
            .record_duration(duration);
    }

    pub fn record_mongo_query(&self, operation: &str, duration: Duration) {
        let mut inner = self.inner.write().expect("metrics lock poisoned");
        inner
            .mongo_queries
            .entry(operation.to_string())
            .or_default()
            .record_duration(duration);
    }

    pub fn record_model_call(&self, operation: &str, duration: Duration) {
        let mut inner = self.inner.write().expect("metrics lock poisoned");
        inner
            .model_calls
            .entry(operation.to_string())
            .or_default()
            .record_duration(duration);
    }

    pub fn record_upload_size(&self, size_bytes: u64) {
        let mut inner = self.inner.write().expect("metrics lock poisoned");
        inner.upload_sizes.record(size_bytes);
    }

    pub fn snapshot(&self) -> MetricsSnapshot {
        let inner = self.inner.read().expect("metrics lock poisoned");
        MetricsSnapshot {
            collected_at: Utc::now(),
            endpoints: sorted_latency_snapshots(&inner.endpoints),
            mongo_queries: sorted_latency_snapshots(&inner.mongo_queries),
            model_calls: sorted_latency_snapshots(&inner.model_calls),
            upload_sizes: inner.upload_sizes.snapshot(),
        }
    }
}

impl SampleWindow {
    fn record_duration(&mut self, duration: Duration) {
        let micros = duration.as_micros().min(u128::from(u64::MAX)) as u64;
        self.count += 1;
        self.total_micros += u128::from(micros);
        self.max_micros = self.max_micros.max(micros);
        self.samples.push_back(micros);
        if self.samples.len() > MAX_SAMPLES {
            self.samples.pop_front();
        }
    }

    fn snapshot(&self, name: String) -> LatencySnapshot {
        let samples = self.samples.iter().copied().collect::<Vec<_>>();
        LatencySnapshot {
            name,
            count: self.count,
            average_ms: micros_to_ms(if self.count == 0 {
                0
            } else {
                (self.total_micros / u128::from(self.count)) as u64
            }),
            p50_ms: micros_to_ms(percentile(samples.clone(), 0.50)),
            p95_ms: micros_to_ms(percentile(samples.clone(), 0.95)),
            p99_ms: micros_to_ms(percentile(samples, 0.99)),
            max_ms: micros_to_ms(self.max_micros),
        }
    }
}

impl SizeDistribution {
    fn record(&mut self, size_bytes: u64) {
        self.count += 1;
        self.total_bytes += u128::from(size_bytes);
        self.min_bytes = Some(
            self.min_bytes
                .map_or(size_bytes, |current| current.min(size_bytes)),
        );
        self.max_bytes = self.max_bytes.max(size_bytes);
        self.samples.push_back(size_bytes);
        if self.samples.len() > MAX_SAMPLES {
            self.samples.pop_front();
        }

        let bucket_index = UPLOAD_BUCKETS
            .iter()
            .position(|threshold| size_bytes <= *threshold)
            .unwrap_or(UPLOAD_BUCKET_LABELS.len() - 1);
        self.bucket_counts[bucket_index] += 1;
    }

    fn snapshot(&self) -> UploadSizeSnapshot {
        let samples = self.samples.iter().copied().collect::<Vec<_>>();
        let buckets = UPLOAD_BUCKET_LABELS
            .iter()
            .enumerate()
            .map(|(index, label)| UploadSizeBucket {
                label: *label,
                count: self.bucket_counts[index],
            })
            .collect();

        UploadSizeSnapshot {
            count: self.count,
            average_bytes: if self.count == 0 {
                0.0
            } else {
                self.total_bytes as f64 / self.count as f64
            },
            min_bytes: self.min_bytes.unwrap_or(0),
            p50_bytes: percentile(samples.clone(), 0.50),
            p95_bytes: percentile(samples.clone(), 0.95),
            p99_bytes: percentile(samples, 0.99),
            max_bytes: self.max_bytes,
            buckets,
        }
    }
}

pub fn endpoint_label(method: &Method, path: &str) -> String {
    let normalized = match (method.as_str(), path) {
        ("OPTIONS", _) => "OPTIONS *",
        ("GET", "/health") => "GET /health",
        ("GET", "/healthz") => "GET /healthz",
        ("GET", "/api/v1/admin/dashboard") => "GET /api/v1/admin/dashboard",
        ("GET", "/metrics") => "GET /metrics",
        ("GET", "/api/v1/metrics") => "GET /api/v1/metrics",
        ("GET", "/api/v1/model/config") => "GET /api/v1/model/config",
        ("PUT", "/api/v1/model/config") => "PUT /api/v1/model/config",
        ("GET", "/api/v1/ip-threat/config") => "GET /api/v1/ip-threat/config",
        ("PUT", "/api/v1/ip-threat/config") => "PUT /api/v1/ip-threat/config",
        ("GET", "/api/v1/ip-threat/lookup") => "GET /api/v1/ip-threat/lookup",
        ("POST", "/api/v1/assets/uploads") => "POST /api/v1/assets/uploads",
        ("PUT", path) if path.starts_with("/api/v1/uploads/") => "PUT /api/v1/uploads/{assetId}",
        ("GET", path) if path.starts_with("/assets/") => "GET /assets/{assetId}",
        ("POST", "/api/v1/ai/drawing-jobs") => "POST /api/v1/ai/drawing-jobs",
        ("GET", "/api/v1/ai/drawing-jobs/demo") => "GET /api/v1/ai/drawing-jobs/demo",
        ("GET", path) if path.starts_with("/api/v1/ai/drawing-jobs/") => {
            "GET /api/v1/ai/drawing-jobs/{jobId}"
        }
        ("POST", "/api/v1/shares") => "POST /api/v1/shares",
        ("GET", path) if path.starts_with("/api/v1/shares/") => "GET /api/v1/shares/{slug}",
        ("GET", path) if path.contains('.') => "GET /frontend-static",
        ("GET", _) => "GET /frontend-route",
        _ => "UNMATCHED",
    };

    normalized.to_string()
}

fn sorted_latency_snapshots(metrics: &HashMap<String, SampleWindow>) -> Vec<LatencySnapshot> {
    let mut snapshots = metrics
        .iter()
        .map(|(name, window)| window.snapshot(name.clone()))
        .collect::<Vec<_>>();
    snapshots.sort_by(|left, right| left.name.cmp(&right.name));
    snapshots
}

fn percentile(mut values: Vec<u64>, p: f64) -> u64 {
    if values.is_empty() {
        return 0;
    }

    values.sort_unstable();
    let rank = ((values.len() as f64) * p).ceil() as usize;
    let index = rank.saturating_sub(1).min(values.len() - 1);
    values[index]
}

fn micros_to_ms(value: u64) -> f64 {
    value as f64 / 1000.0
}
