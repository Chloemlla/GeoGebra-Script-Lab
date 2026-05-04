import React, { memo } from 'react';
import AppIcon from './AppIcon';
import './ControlPanel.css';

const formatDuration = (duration) => {
  if (typeof duration !== 'number' || Number.isNaN(duration)) {
    return '--';
  }

  if (duration < 1000) {
    return `${duration} ms`;
  }

  if (duration < 10000) {
    return `${(duration / 1000).toFixed(2)} s`;
  }

  return `${(duration / 1000).toFixed(1)} s`;
};

const ControlPanel = ({
  onRun,
  onClear,
  onExport,
  onExportGGB,
  onReset,
  canvasModes = [],
  selectedCanvasModeId = '',
  onCanvasModeChange,
  isExecuting = false,
  executionStats = null,
}) => {
  const activeCanvasMode = canvasModes.find((mode) => mode.id === selectedCanvasModeId) ?? null;
  const runStatus = isExecuting
    ? {
        label: '正在执行',
        description: '当前会按顺序清空旧画布并执行全部指令。',
        tone: 'accent',
      }
    : executionStats
    ? executionStats.success
      ? {
          label: '运行成功',
          description: '本次指令已执行完成，可以继续拖拽或导出图像。',
          tone: 'success',
        }
      : {
          label: '运行有错误',
          description: '请在下方日志中定位错误行并修正脚本。',
          tone: 'danger',
        }
    : {
        label: '等待运行',
        description: '输入或载入示例后，点击运行即可生成图形。',
        tone: 'neutral',
      };

  const statItems = [
    {
      label: '成功指令',
      value: executionStats ? executionStats.successCount : '--',
      tone: 'success',
    },
    {
      label: '错误数量',
      value: executionStats ? executionStats.errorCount : '--',
      tone: executionStats?.errorCount ? 'danger' : 'neutral',
    },
    {
      label: '日志条数',
      value: executionStats ? executionStats.totalLog : '--',
      tone: 'neutral',
    },
    {
      label: '执行耗时',
      value: executionStats ? formatDuration(executionStats.executionTime) : '--',
      tone: 'accent',
    },
  ];

  const handleClear = () => {
    if (onClear && window.confirm('确定要清空画板吗？')) {
      onClear();
    }
  };

  const handleReset = () => {
    if (onReset && window.confirm('确定要重置所有设置吗？')) {
      onReset();
    }
  };

  return (
    <section className="control-panel">
      <div className="control-head">
        <div className="control-head-copy">
          <span className="panel-kicker">运行与配置</span>
          <h3>运行控制</h3>
          <p>运行前会自动重置画布，减少旧对象残留影响结果判断。</p>
        </div>
        <div className={`run-status run-status-${runStatus.tone}`}>
          <strong>{runStatus.label}</strong>
          <span>{runStatus.description}</span>
        </div>
      </div>

      {canvasModes.length > 0 && (
        <div className="canvas-mode-panel">
          <div className="canvas-mode-copy">
            <span className="panel-kicker">画布模式</span>
            <strong>{activeCanvasMode?.label ?? '未选择画布'}</strong>
            <p>{activeCanvasMode?.description ?? '切换不同 GeoGebra applet，匹配平面、立体或函数场景。'}</p>
          </div>

          <div className="canvas-mode-options" role="tablist" aria-label="画布类型切换">
            {canvasModes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`canvas-mode-chip ${mode.id === selectedCanvasModeId ? 'active' : ''}`}
                onClick={() => onCanvasModeChange?.(mode.id)}
                disabled={isExecuting || mode.id === selectedCanvasModeId}
              >
                <span className="canvas-mode-chip-label">{mode.label}</span>
                <span className="canvas-mode-chip-meta">{mode.shortHint}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="control-buttons">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onRun}
          disabled={isExecuting}
          title="执行代码 (Ctrl+Enter)"
        >
          <span className="btn-icon" aria-hidden="true">
            <AppIcon className="btn-icon-image" decorative />
          </span>
          {isExecuting ? '执行中...' : '运行脚本'}
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleClear}
          disabled={isExecuting}
          title="清空画板"
        >
          <span className="btn-icon" aria-hidden="true">
            <AppIcon className="btn-icon-image" decorative />
          </span>
          清空画板
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={onExport}
          disabled={isExecuting}
          title="导出为图片"
        >
          <span className="btn-icon" aria-hidden="true">
            <AppIcon className="btn-icon-image" decorative />
          </span>
          导出图片
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={onExportGGB}
          disabled={isExecuting}
          title="导出为 GGB 文件"
        >
          <span className="btn-icon" aria-hidden="true">
            <AppIcon className="btn-icon-image" decorative />
          </span>
          导出 GGB
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleReset}
          disabled={isExecuting}
          title="重置工作台"
        >
          <span className="btn-icon" aria-hidden="true">
            <AppIcon className="btn-icon-image" decorative />
          </span>
          重置工作台
        </button>
      </div>

      <div className="control-summary-grid">
        {statItems.map((item) => (
          <article key={item.label} className={`summary-card summary-card-${item.tone}`}>
            <span className="summary-label">{item.label}</span>
            <strong className="summary-value">{item.value}</strong>
          </article>
        ))}
      </div>
    </section>
  );
};

export default memo(ControlPanel);
