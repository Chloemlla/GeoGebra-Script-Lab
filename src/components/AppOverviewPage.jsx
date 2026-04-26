import React from 'react';

const AppOverviewPage = ({
  selectedCanvasMode,
  recentRunStatus,
  recentRunTone,
  isExecuting,
  executionStats,
  canvasDrift,
  changedPointCount,
  isCanvasLocked,
  formatDuration,
  successRate,
  handleRun,
  handleLoadSnippet,
  starterSnippets,
  workflowSteps,
  overviewMetrics,
  commercializationPriorities,
  commercializationFlow,
}) => (
  <>
    <section className="chapter chapter-dark">
      <header className="hero-panel">
        <div className="hero-copy">
          <span className="hero-eyebrow">Scripted Geometry</span>
          <h1>几何脚本与画布联动工作台</h1>
          <p className="hero-description">
            用代码描述几何关系，在右侧即时验证图形，再把拖拽后的自由点同步回脚本。
            整个界面按展示区与工作区两段组织，保留原有运行、导出、切换画布和日志能力。
          </p>

          <div className="hero-actions">
            <button
              type="button"
              className="hero-btn hero-btn-primary"
              onClick={handleRun}
              disabled={isExecuting}
            >
              {isExecuting ? '正在执行...' : '运行当前脚本'}
            </button>
            <button
              type="button"
              className="hero-btn hero-btn-secondary"
              onClick={() => handleLoadSnippet(starterSnippets[0])}
            >
              载入基础示例
            </button>
          </div>

          <div className="hero-tags">
            <span className="hero-tag">Monaco 编辑器</span>
            <span className="hero-tag">{selectedCanvasMode.label}</span>
            <span className="hero-tag">自由点同步回写</span>
            <span className="hero-tag">UTF-8 中文支持</span>
          </div>
        </div>

        <div className="hero-side">
          <article className="hero-status-card">
            <span className="card-kicker">运行状态</span>
            <strong>{recentRunStatus}</strong>
            <p>{selectedCanvasMode.stageTip}</p>
            <div className="hero-status-row">
              <span className={`status-chip status-chip-${recentRunTone}`}>
                {isExecuting
                  ? '执行中'
                  : executionStats
                  ? executionStats.success
                    ? '运行成功'
                    : '运行异常'
                  : '等待运行'}
              </span>
              <span className="status-chip status-chip-neutral">
                {canvasDrift.isDirty ? '待同步' : isCanvasLocked ? '拖拽锁定' : '可拖拽'}
              </span>
            </div>
          </article>

          <article className="hero-status-card hero-checklist-card">
            <span className="card-kicker">推荐工作流</span>
            <ul className="workflow-list">
              {workflowSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </article>

          <article className="hero-status-card hero-brief-card">
            <span className="card-kicker">会话概览</span>
            <div className="hero-brief-grid">
              <div className="hero-brief-item">
                <span>画布</span>
                <strong>{selectedCanvasMode.label}</strong>
                <small>{selectedCanvasMode.shortHint}</small>
              </div>
              <div className="hero-brief-item">
                <span>同步</span>
                <strong>{canvasDrift.isDirty ? `${changedPointCount} 点待同步` : '代码一致'}</strong>
                <small>{isCanvasLocked ? '当前锁定拖拽' : '当前支持自由拖拽'}</small>
              </div>
              <div className="hero-brief-item">
                <span>运行耗时</span>
                <strong>{formatDuration(executionStats?.executionTime)}</strong>
                <small>{successRate} 成功率</small>
              </div>
            </div>
          </article>
        </div>
      </header>
    </section>

    <section className="chapter chapter-light">
      <div className="chapter-header">
        <div>
          <span className="section-kicker">Overview</span>
          <h2>展示区与工作区分离</h2>
        </div>
      </div>

      <div className="metric-grid">
        {overviewMetrics.map((metric) => (
          <article key={metric.label} className="metric-card">
            <span className="metric-label">{metric.label}</span>
            <strong className="metric-value">{metric.value}</strong>
            <p className="metric-caption">{metric.caption}</p>
          </article>
        ))}
      </div>
    </section>

    <section className="chapter chapter-white starter-section">
      <div className="starter-intro">
        <div>
          <span className="section-kicker">Starter Scenes</span>
          <h2>示例模板</h2>
        </div>
      </div>

      <div className="starter-grid">
        {starterSnippets.map((snippet) => (
          <button
            key={snippet.id}
            type="button"
            className="starter-card"
            onClick={() => handleLoadSnippet(snippet)}
          >
            <span className="starter-eyebrow">{snippet.eyebrow}</span>
            <strong>{snippet.title}</strong>
            <p>{snippet.description}</p>
            <span className="starter-action">载入这个示例</span>
          </button>
        ))}
      </div>
    </section>

    <section className="chapter chapter-light strategy-section">
      <div className="chapter-header">
        <div>
          <span className="section-kicker">Commercial Plan</span>
          <h2>商业化功能优先级</h2>
          <p>
            真正能带来收入的不是单纯多几个按钮，而是把“上传图片 {'->'} AI 生成命令
            {' -> '}前端渲染 {'->'} 分享传播”这条链路打成一个可复用工作流。
          </p>
        </div>

        <article className="strategy-note-card">
          <span className="card-kicker">优先原则</span>
          <strong>先做高频出图，再做传播，再做团队资产化</strong>
          <p>
            如果一开始就堆协作、评审、组织架构，用户不会马上付费。先把 AI
            生图到脚本这件事做到稳定，才有商业价值。
          </p>
        </article>
      </div>

      <div className="strategy-grid">
        {commercializationPriorities.map((item) => (
          <article key={item.id} className="strategy-card">
            <div className="strategy-card-top">
              <span className="strategy-stage">{item.stage}</span>
              <span className="strategy-title">{item.title}</span>
            </div>
            <p className="strategy-value">{item.value}</p>
            <div className="strategy-copy">
              <strong>实现方式</strong>
              <p>{item.implementation}</p>
            </div>
            <div className="strategy-copy">
              <strong>收费方式</strong>
              <p>{item.monetization}</p>
            </div>
            <div className="strategy-copy">
              <strong>核心指标</strong>
              <p>{item.kpi}</p>
            </div>
          </article>
        ))}
      </div>

      <article className="strategy-flow-card">
        <div>
          <span className="card-kicker">Growth Loop</span>
          <strong>推荐先落地的最小商业闭环</strong>
        </div>
        <ol className="strategy-flow-list">
          {commercializationFlow.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </article>
    </section>
  </>
);

export default AppOverviewPage;
