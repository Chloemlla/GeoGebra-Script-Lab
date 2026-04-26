import React, { memo } from 'react';
import './BackendPanel.css';

const STATUS_META = {
  checking: {
    title: 'Backend checking',
    tone: 'neutral',
  },
  connected: {
    title: 'Backend connected',
    tone: 'success',
  },
  error: {
    title: 'Backend unavailable',
    tone: 'danger',
  },
};

const formatValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return '--';
  }

  return `${value}`;
};

const formatFlag = (value) => {
  if (value === true) {
    return 'Yes';
  }

  if (value === false) {
    return 'No';
  }

  return '--';
};

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

const resolveThreatTone = (summary) => {
  const risk = `${summary?.risk || ''}`.trim().toLowerCase();
  const score = Number(summary?.score);

  if (risk.includes('high') || score >= 75) {
    return 'danger';
  }

  if (risk.includes('medium') || score >= 30) {
    return 'warning';
  }

  if (risk.includes('low') || (!Number.isNaN(score) && score >= 0)) {
    return 'success';
  }

  return 'neutral';
};

const BackendPanel = ({
  backendStatus,
  prompt,
  onPromptChange,
  selectedFile,
  onFileChange,
  ipThreatConfigDraft,
  onIpThreatConfigFieldChange,
  onSaveIpThreatConfig,
  ipThreatConfigState,
  isSavingIpThreatConfig,
  ipThreatDraft,
  onIpThreatDraftChange,
  onLookupIpThreat,
  ipThreatResult,
  isCheckingIpThreat,
  onGenerate,
  onPublish,
  onRequireAuth,
  latestJobResult,
  latestShare,
  activeShareSlug,
  isAuthenticated = false,
  authUserLabel = '',
  canPublish = false,
  isGenerating = false,
  isPublishing = false,
}) => {
  const statusMeta = STATUS_META[backendStatus?.state] ?? STATUS_META.checking;
  const ipThreatSummary = ipThreatResult?.summary ?? null;
  const ipThreatTone = resolveThreatTone(ipThreatSummary);

  return (
    <section className="backend-panel">
      <div className="backend-panel-head">
        <div className="backend-panel-copy">
          <span className="panel-kicker">Backend Bridge</span>
          <h3>页面对接</h3>
          <p>前端通过后端统一接入生成、分享和 IP 威胁查询，第三方密钥不会暴露在浏览器里。</p>
        </div>

        <div className={`backend-status backend-status-${statusMeta.tone}`}>
          <strong>{statusMeta.title}</strong>
          <span>{backendStatus?.message || 'Waiting for backend status'}</span>
        </div>
      </div>

      <div className="backend-panel-grid">
        <article className="backend-card">
          <span className="backend-card-label">AI Prompt</span>
          <textarea
            className="backend-prompt"
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="描述你希望后端生成的几何关系、图形结构或约束。"
            rows={5}
          />

          <div className="backend-file-row">
            <label className="backend-file-picker">
              <input
                type="file"
                accept="image/*"
                onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
              />
              <span>{selectedFile ? selectedFile.name : '选择参考图片（可选）'}</span>
            </label>

            {selectedFile && (
              <button
                type="button"
                className="backend-inline-btn"
                onClick={() => onFileChange(null)}
              >
                清除图片
              </button>
            )}
          </div>

          <div className="backend-actions">
            <button
              type="button"
              className="backend-btn backend-btn-primary"
              onClick={onGenerate}
              disabled={!isAuthenticated || isGenerating || isPublishing}
            >
              {isGenerating ? '生成中...' : '调用后端生成脚本'}
            </button>

            <button
              type="button"
              className="backend-btn backend-btn-secondary"
              onClick={onPublish}
              disabled={!isAuthenticated || !canPublish || isGenerating || isPublishing}
            >
              {isPublishing ? '发布中...' : '发布当前分享'}
            </button>

            {!isAuthenticated && (
              <button
                type="button"
                className="backend-btn backend-btn-secondary"
                onClick={onRequireAuth}
              >
                前往登录
              </button>
            )}
          </div>

          <p className="backend-auth-hint">
            {isAuthenticated
              ? `当前以后端身份 ${authUserLabel} 发起请求。`
              : '登录后才能调用上传、AI 生成、IP 威胁查询和分享接口。'}
          </p>
        </article>

        <article className="backend-card">
          <span className="backend-card-label">Connection</span>

          <div className="backend-metadata">
            <div className="backend-metric">
              <span>Model</span>
              <strong>{backendStatus?.modelName || '--'}</strong>
            </div>

            <div className="backend-metric">
              <span>Provider</span>
              <code>{backendStatus?.providerBaseUrl || '--'}</code>
            </div>

            <div className="backend-metric">
              <span>Threat API</span>
              <strong>{backendStatus?.ipThreatConfigured ? 'Configured' : 'Not configured'}</strong>
            </div>

            <div className="backend-metric">
              <span>Threat Base</span>
              <code>{backendStatus?.ipThreatBaseUrl || '--'}</code>
            </div>

            <div className="backend-metric">
              <span>Auth</span>
              <strong>{isAuthenticated ? authUserLabel : '未登录'}</strong>
            </div>

            <div className="backend-metric">
              <span>Last Scene</span>
              <strong>{latestJobResult?.sceneSummary || '--'}</strong>
            </div>

            <div className="backend-metric">
              <span>Share</span>
              {latestShare?.localShareUrl ? (
                <a
                  href={latestShare.localShareUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="backend-link"
                >
                  {latestShare.localShareUrl}
                </a>
              ) : (
                <strong>--</strong>
              )}
            </div>

            <div className="backend-metric">
              <span>Active Share</span>
              <strong>{activeShareSlug || '--'}</strong>
            </div>
          </div>

          {latestJobResult && (
            <div className="backend-result">
              <div className="backend-badges">
                <span className="backend-badge">
                  {latestJobResult.commands?.length ?? 0} commands
                </span>
                <span className="backend-badge">
                  confidence {Math.round((latestJobResult.diagnostics?.confidence ?? 0) * 100)}%
                </span>
                <span className="backend-badge">
                  {latestJobResult.diagnostics?.humanReviewRecommended ? 'need review' : 'auto ready'}
                </span>
              </div>
              <p>{latestJobResult.sceneSummary}</p>
            </div>
          )}
        </article>
      </div>

      <article className="backend-card backend-card-full">
        <div className="backend-card-head">
          <div className="backend-card-head-copy">
            <span className="backend-card-label">Provider Config</span>
            <strong className="backend-card-title">Scamalytics 后台配置</strong>
          </div>
          <span className={`backend-badge backend-badge-${ipThreatConfigState?.configured ? 'success' : 'neutral'}`}>
            {ipThreatConfigState?.configured ? 'configured' : 'pending'}
          </span>
        </div>

        <div className="backend-threat-form backend-threat-form-config">
          <label className="backend-field">
            <span>Base URL</span>
            <input
              type="text"
              className="backend-input"
              value={ipThreatConfigDraft?.baseUrl || ''}
              onChange={(event) => onIpThreatConfigFieldChange('baseUrl', event.target.value)}
              placeholder="https://api13.scamalytics.com/v3"
            />
          </label>

          <label className="backend-field">
            <span>Username</span>
            <input
              type="text"
              className="backend-input"
              value={ipThreatConfigDraft?.username || ''}
              onChange={(event) => onIpThreatConfigFieldChange('username', event.target.value)}
              placeholder="happyclovo"
            />
          </label>

          <label className="backend-field">
            <span>API Key</span>
            <input
              type="password"
              className="backend-input"
              value={ipThreatConfigDraft?.apiKey || ''}
              onChange={(event) => onIpThreatConfigFieldChange('apiKey', event.target.value)}
              placeholder={ipThreatConfigState?.apiKeySet ? '留空则沿用当前已保存密钥' : '输入新的 API Key'}
            />
          </label>

          <button
            type="button"
            className="backend-btn backend-btn-primary"
            onClick={onSaveIpThreatConfig}
            disabled={!isAuthenticated || isSavingIpThreatConfig}
          >
            {isSavingIpThreatConfig ? '保存中...' : '保存到数据库'}
          </button>
        </div>

        <div className="backend-metadata backend-metadata-config">
          <div className="backend-metric">
            <span>Config Status</span>
            <strong>{ipThreatConfigState?.configured ? '已启用' : '未完成'}</strong>
          </div>
          <div className="backend-metric">
            <span>API Key</span>
            <strong>{ipThreatConfigState?.apiKeySet ? '已保存' : '未保存'}</strong>
          </div>
          <div className="backend-metric">
            <span>Updated At</span>
            <strong>{formatDateTime(ipThreatConfigState?.updatedAt)}</strong>
          </div>
          <div className="backend-metric">
            <span>Updated By</span>
            <strong>{formatValue(ipThreatConfigState?.updatedByUserId)}</strong>
          </div>
        </div>
      </article>

      <article className="backend-card backend-card-full">
        <div className="backend-card-head">
          <div className="backend-card-head-copy">
            <span className="backend-card-label">IP Threat Intelligence</span>
            <strong className="backend-card-title">Scamalytics IP 风险查询</strong>
          </div>
          <span className={`backend-badge backend-badge-${backendStatus?.ipThreatConfigured ? 'success' : 'neutral'}`}>
            {backendStatus?.ipThreatConfigured ? 'configured' : 'not configured'}
          </span>
        </div>

        <div className="backend-threat-form">
          <label className="backend-field">
            <span>IP Address</span>
            <input
              type="text"
              className="backend-input"
              value={ipThreatDraft?.ip || ''}
              onChange={(event) => onIpThreatDraftChange('ip', event.target.value)}
              placeholder="8.8.8.8 或 2001:4860:4860::8888"
            />
          </label>

          <label className="backend-check">
            <input
              type="checkbox"
              checked={Boolean(ipThreatDraft?.testMode)}
              onChange={(event) => onIpThreatDraftChange('testMode', event.target.checked)}
            />
            <span>使用测试模式</span>
          </label>

          <button
            type="button"
            className="backend-btn backend-btn-primary"
            onClick={onLookupIpThreat}
            disabled={!backendStatus?.ipThreatConfigured || !isAuthenticated || isCheckingIpThreat}
          >
            {isCheckingIpThreat ? '查询中...' : '查询 IP 威胁'}
          </button>
        </div>

        <p className="backend-help">
          第三方请求由后端代理发起，基础地址和密钥来自数据库中的后台配置：
          <code>{backendStatus?.ipThreatBaseUrl || '--'}</code>
        </p>

        {ipThreatResult && (
          <div className="backend-threat-result">
            <div className="backend-badges">
              <span className={`backend-badge backend-badge-${ipThreatTone}`}>
                {ipThreatSummary?.risk || ipThreatSummary?.status || 'unknown'}
              </span>
              <span className="backend-badge">score {formatValue(ipThreatSummary?.score)}</span>
              <span className="backend-badge">
                {ipThreatResult.testMode ? 'test mode' : 'live mode'}
              </span>
            </div>

            <div className="backend-metadata backend-metadata-threat">
              <div className="backend-metric">
                <span>IP</span>
                <strong>{formatValue(ipThreatResult.ip)}</strong>
              </div>
              <div className="backend-metric">
                <span>Status</span>
                <strong>{formatValue(ipThreatSummary?.status)}</strong>
              </div>
              <div className="backend-metric">
                <span>ISP Score</span>
                <strong>{formatValue(ipThreatSummary?.ispScore)}</strong>
              </div>
              <div className="backend-metric">
                <span>ISP Risk</span>
                <strong>{formatValue(ipThreatSummary?.ispRisk)}</strong>
              </div>
              <div className="backend-metric">
                <span>VPN</span>
                <strong>{formatFlag(ipThreatSummary?.isVpn)}</strong>
              </div>
              <div className="backend-metric">
                <span>Tor</span>
                <strong>{formatFlag(ipThreatSummary?.isTor)}</strong>
              </div>
              <div className="backend-metric">
                <span>Datacenter</span>
                <strong>{formatFlag(ipThreatSummary?.isDatacenter)}</strong>
              </div>
              <div className="backend-metric">
                <span>Proxy</span>
                <strong>{formatFlag(ipThreatSummary?.isProxy)}</strong>
              </div>
            </div>

            {ipThreatSummary?.reportUrl && (
              <a
                href={ipThreatSummary.reportUrl}
                target="_blank"
                rel="noreferrer"
                className="backend-link"
              >
                打开 Scamalytics 报告
              </a>
            )}

            <details className="backend-raw">
              <summary>查看原始 JSON</summary>
              <pre>{JSON.stringify(ipThreatResult.raw, null, 2)}</pre>
            </details>
          </div>
        )}
      </article>
    </section>
  );
};

export default memo(BackendPanel);
