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

const BackendPanel = ({
  backendStatus,
  prompt,
  onPromptChange,
  selectedFile,
  onFileChange,
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

  return (
    <section className="backend-panel">
      <div className="backend-panel-head">
        <div className="backend-panel-copy">
          <span className="panel-kicker">Backend Bridge</span>
          <h3>页面对接</h3>
          <p>前端直接调用上传、绘图任务和分享接口，结果会回填编辑器并渲染到当前画布。</p>
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
              : '登录后才能调用上传、AI 生成和分享接口。'}
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
    </section>
  );
};

export default memo(BackendPanel);
