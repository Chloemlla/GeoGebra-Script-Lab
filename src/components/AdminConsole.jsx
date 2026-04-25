import React from 'react';
import './AdminConsole.css';

const EMPTY_METRICS = [];

const formatDateTime = (value) => {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  return date.toLocaleString('zh-CN');
};

const formatDurationSeconds = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    return '--';
  }

  if (value < 60) {
    return `${value}s`;
  }

  if (value < 3600) {
    return `${Math.floor(value / 60)}m ${value % 60}s`;
  }

  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
};

const formatLatency = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--';
  }

  return `${value.toFixed(value >= 100 ? 0 : 1)} ms`;
};

const formatNumber = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--';
  }

  return new Intl.NumberFormat('zh-CN').format(value);
};

const formatBytes = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    return '--';
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }

  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  }

  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
};

const getToneByStatus = (value) => {
  switch (value) {
    case 'completed':
    case 'connected':
      return 'success';
    case 'processing':
    case 'queued':
      return 'warning';
    case 'failed':
    case 'error':
      return 'danger';
    default:
      return 'neutral';
  }
};

const MetricTable = ({ title, rows = EMPTY_METRICS, emptyMessage = '暂无指标数据' }) => (
  <article className="admin-console-card admin-console-table-card">
    <div className="admin-console-card-head">
      <div>
        <span className="admin-console-eyebrow">Metrics</span>
        <strong>{title}</strong>
      </div>
      <span className="admin-console-mini-pill">{rows.length} 项</span>
    </div>

    {rows.length === 0 ? (
      <p className="admin-console-empty">{emptyMessage}</p>
    ) : (
      <div className="admin-console-table-wrap">
        <table className="admin-console-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>次数</th>
              <th>P95</th>
              <th>P99</th>
              <th>均值</th>
              <th>峰值</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{formatNumber(row.count)}</td>
                <td>{formatLatency(row.p95Ms)}</td>
                <td>{formatLatency(row.p99Ms)}</td>
                <td>{formatLatency(row.averageMs)}</td>
                <td>{formatLatency(row.maxMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </article>
);

const AdminConsole = ({
  backendStatus,
  adminDashboard,
  adminState,
  onRefresh,
  autoRefresh,
  onToggleAutoRefresh,
}) => {
  const runtime = adminDashboard?.runtime;
  const model = adminDashboard?.model;
  const dispatcher = adminDashboard?.dispatcher;
  const cache = adminDashboard?.cache;
  const metrics = adminDashboard?.metrics;
  const recentJobs = adminDashboard?.recentJobs ?? [];
  const recentAssets = adminDashboard?.recentAssets ?? [];
  const recentShares = adminDashboard?.recentShares ?? [];

  return (
    <section className="admin-console">
      <div className="admin-console-head">
        <div className="admin-console-copy">
          <span className="admin-console-eyebrow">Admin Control</span>
          <h3>超级后台</h3>
          <p>
            聚合后端健康、模型配置、任务队列、缓存状态、Mongo 依赖耗时与上传分布，管理员可以直接掌握系统运行细节。
          </p>
        </div>

        <div className="admin-console-actions">
          <div className={`admin-console-status admin-console-status-${getToneByStatus(adminState.state)}`}>
            <strong>
              {adminState.state === 'ready'
                ? '后台视图已同步'
                : adminState.state === 'error'
                ? '后台视图异常'
                : '后台视图拉取中'}
            </strong>
            <span>{adminState.message}</span>
          </div>

          <div className="admin-console-toolbar">
            <label className="admin-console-toggle">
              <input type="checkbox" checked={autoRefresh} onChange={onToggleAutoRefresh} />
              <span>自动刷新</span>
            </label>

            <button
              type="button"
              className="admin-console-button"
              onClick={onRefresh}
              disabled={adminState.isRefreshing}
            >
              {adminState.isRefreshing ? '刷新中...' : '立即刷新'}
            </button>
          </div>
        </div>
      </div>

      <div className="admin-console-summary-grid">
        <article className="admin-console-summary-card">
          <span>服务状态</span>
          <strong>{backendStatus?.state === 'connected' ? '在线' : '异常'}</strong>
          <small>{backendStatus?.message || '--'}</small>
        </article>
        <article className="admin-console-summary-card">
          <span>系统运行</span>
          <strong>{formatDurationSeconds(runtime?.uptimeSeconds)}</strong>
          <small>启动于 {formatDateTime(runtime?.startedAt)}</small>
        </article>
        <article className="admin-console-summary-card">
          <span>队列堆积</span>
          <strong>{formatNumber(dispatcher?.queuedJobs)}</strong>
          <small>
            活跃 worker {formatNumber(dispatcher?.activeWorkers)} / {formatNumber(dispatcher?.workerConcurrency)}
          </small>
        </article>
        <article className="admin-console-summary-card">
          <span>任务总量</span>
          <strong>{formatNumber(cache?.jobsTotal)}</strong>
          <small>
            完成 {formatNumber(cache?.completedJobsTotal)} / 失败 {formatNumber(cache?.failedJobsTotal)}
          </small>
        </article>
        <article className="admin-console-summary-card">
          <span>上传分布</span>
          <strong>{formatNumber(metrics?.uploadSizes?.count)}</strong>
          <small>平均 {formatBytes(metrics?.uploadSizes?.averageBytes)}</small>
        </article>
        <article className="admin-console-summary-card">
          <span>最近快照</span>
          <strong>{formatDateTime(adminDashboard?.generatedAt)}</strong>
          <small>{autoRefresh ? '自动刷新已开启' : '手动刷新模式'}</small>
        </article>
      </div>

      <div className="admin-console-grid">
        <article className="admin-console-card">
          <div className="admin-console-card-head">
            <div>
              <span className="admin-console-eyebrow">Runtime</span>
              <strong>运行参数</strong>
            </div>
          </div>

          <div className="admin-console-definition-grid">
            <div>
              <span>Bind 地址</span>
              <strong>{runtime?.bindAddr || '--'}</strong>
            </div>
            <div>
              <span>API Base</span>
              <strong>{runtime?.apiBaseUrl || '--'}</strong>
            </div>
            <div>
              <span>MongoDB</span>
              <strong>{runtime?.mongodbEnabled ? runtime?.mongodbDatabase : 'disabled'}</strong>
            </div>
            <div>
              <span>静态资源</span>
              <strong>{formatNumber(runtime?.frontendAssetsLoaded)}</strong>
            </div>
            <div>
              <span>Worker 并发</span>
              <strong>{formatNumber(runtime?.modelWorkerConcurrency)}</strong>
            </div>
            <div>
              <span>队列容量</span>
              <strong>{formatNumber(runtime?.modelJobQueueCapacity)}</strong>
            </div>
          </div>
        </article>

        <article className="admin-console-card">
          <div className="admin-console-card-head">
            <div>
              <span className="admin-console-eyebrow">Model</span>
              <strong>模型配置</strong>
            </div>
          </div>

          <div className="admin-console-definition-grid">
            <div>
              <span>模型名</span>
              <strong>{model?.modelName || '--'}</strong>
            </div>
            <div>
              <span>Provider</span>
              <strong>{model?.baseUrl || '--'}</strong>
            </div>
            <div>
              <span>API Key</span>
              <strong>{model?.apiKeySet ? '已配置' : '未配置'}</strong>
            </div>
            <div>
              <span>后端状态</span>
              <strong>{backendStatus?.state || '--'}</strong>
            </div>
          </div>
        </article>

        <article className="admin-console-card">
          <div className="admin-console-card-head">
            <div>
              <span className="admin-console-eyebrow">Dispatcher</span>
              <strong>模型队列</strong>
            </div>
          </div>

          <div className="admin-console-definition-grid">
            <div>
              <span>累计入队</span>
              <strong>{formatNumber(dispatcher?.enqueuedTotal)}</strong>
            </div>
            <div>
              <span>累计完成</span>
              <strong>{formatNumber(dispatcher?.completedTotal)}</strong>
            </div>
            <div>
              <span>拒绝入队</span>
              <strong>{formatNumber(dispatcher?.failedEnqueueTotal)}</strong>
            </div>
            <div>
              <span>当前活跃</span>
              <strong>{formatNumber(dispatcher?.activeWorkers)}</strong>
            </div>
          </div>
        </article>

        <article className="admin-console-card">
          <div className="admin-console-card-head">
            <div>
              <span className="admin-console-eyebrow">Cache</span>
              <strong>缓存与资源</strong>
            </div>
          </div>

          <div className="admin-console-definition-grid">
            <div>
              <span>Assets</span>
              <strong>{formatNumber(cache?.assetsTotal)}</strong>
            </div>
            <div>
              <span>已上传资产</span>
              <strong>{formatNumber(cache?.uploadedAssetsTotal)}</strong>
            </div>
            <div>
              <span>Payload 缓存</span>
              <strong>{formatNumber(cache?.assetPayloadsTotal)}</strong>
            </div>
            <div>
              <span>Shares</span>
              <strong>{formatNumber(cache?.sharesTotal)}</strong>
            </div>
          </div>
        </article>
      </div>

      <div className="admin-console-grid admin-console-grid-metrics">
        <MetricTable title="接口延迟" rows={metrics?.endpoints || EMPTY_METRICS} />
        <MetricTable title="Mongo 查询耗时" rows={metrics?.mongoQueries || EMPTY_METRICS} />
        <MetricTable title="模型调用耗时" rows={metrics?.modelCalls || EMPTY_METRICS} />

        <article className="admin-console-card admin-console-table-card">
          <div className="admin-console-card-head">
            <div>
              <span className="admin-console-eyebrow">Distribution</span>
              <strong>上传大小分布</strong>
            </div>
            <span className="admin-console-mini-pill">{formatNumber(metrics?.uploadSizes?.count)} 次</span>
          </div>

          <div className="admin-console-definition-grid admin-console-definition-grid-compact">
            <div>
              <span>P50</span>
              <strong>{formatBytes(metrics?.uploadSizes?.p50Bytes)}</strong>
            </div>
            <div>
              <span>P95</span>
              <strong>{formatBytes(metrics?.uploadSizes?.p95Bytes)}</strong>
            </div>
            <div>
              <span>P99</span>
              <strong>{formatBytes(metrics?.uploadSizes?.p99Bytes)}</strong>
            </div>
            <div>
              <span>最大值</span>
              <strong>{formatBytes(metrics?.uploadSizes?.maxBytes)}</strong>
            </div>
          </div>

          <div className="admin-console-bucket-list">
            {(metrics?.uploadSizes?.buckets || []).map((bucket) => (
              <div key={bucket.label} className="admin-console-bucket-item">
                <span>{bucket.label}</span>
                <strong>{formatNumber(bucket.count)}</strong>
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className="admin-console-grid admin-console-grid-activity">
        <article className="admin-console-card admin-console-table-card">
          <div className="admin-console-card-head">
            <div>
              <span className="admin-console-eyebrow">Jobs</span>
              <strong>最近任务</strong>
            </div>
          </div>

          {recentJobs.length === 0 ? (
            <p className="admin-console-empty">当前没有任务记录。</p>
          ) : (
            <div className="admin-console-table-wrap">
              <table className="admin-console-table">
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>状态</th>
                    <th>命令数</th>
                    <th>置信度</th>
                    <th>更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {recentJobs.map((job) => (
                    <tr key={job.jobId}>
                      <td>
                        <strong>{job.jobId}</strong>
                        <small>{job.prompt}</small>
                      </td>
                      <td>
                        <span className={`admin-console-chip admin-console-chip-${getToneByStatus(job.status)}`}>
                          {job.status}
                        </span>
                      </td>
                      <td>{formatNumber(job.commandCount)}</td>
                      <td>{Math.round((job.confidence || 0) * 100)}%</td>
                      <td>{formatDateTime(job.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="admin-console-card admin-console-table-card">
          <div className="admin-console-card-head">
            <div>
              <span className="admin-console-eyebrow">Assets</span>
              <strong>最近资产</strong>
            </div>
          </div>

          {recentAssets.length === 0 ? (
            <p className="admin-console-empty">当前没有资产记录。</p>
          ) : (
            <div className="admin-console-table-wrap">
              <table className="admin-console-table">
                <thead>
                  <tr>
                    <th>资产</th>
                    <th>用途</th>
                    <th>上传</th>
                    <th>大小</th>
                    <th>过期</th>
                  </tr>
                </thead>
                <tbody>
                  {recentAssets.map((asset) => (
                    <tr key={asset.assetId}>
                      <td>
                        <strong>{asset.filename}</strong>
                        <small>{asset.assetId}</small>
                      </td>
                      <td>{asset.purpose}</td>
                      <td>
                        <span className={`admin-console-chip admin-console-chip-${asset.uploaded ? 'success' : 'neutral'}`}>
                          {asset.uploaded ? 'uploaded' : 'reserved'}
                        </span>
                      </td>
                      <td>{formatBytes(asset.uploadedBytes)}</td>
                      <td>{formatDateTime(asset.expiresAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="admin-console-card admin-console-table-card">
          <div className="admin-console-card-head">
            <div>
              <span className="admin-console-eyebrow">Shares</span>
              <strong>最近分享</strong>
            </div>
          </div>

          {recentShares.length === 0 ? (
            <p className="admin-console-empty">当前没有分享记录。</p>
          ) : (
            <div className="admin-console-table-wrap">
              <table className="admin-console-table">
                <thead>
                  <tr>
                    <th>标题</th>
                    <th>权限</th>
                    <th>命令数</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {recentShares.map((share) => (
                    <tr key={share.shareId}>
                      <td>
                        <strong>{share.title}</strong>
                        <small>{share.slug}</small>
                      </td>
                      <td>{share.visibility}</td>
                      <td>{formatNumber(share.commandCount)}</td>
                      <td>{formatDateTime(share.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>
    </section>
  );
};

export default AdminConsole;
