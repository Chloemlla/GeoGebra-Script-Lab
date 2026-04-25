import React, { memo, useEffect, useRef } from 'react';
import AppIcon from './AppIcon';
import './LogPanel.css';

const LEVEL_META = {
  success: { label: '成功' },
  error: { label: '错误' },
  warning: { label: '警告' },
  info: { label: '信息' },
};

const LogPanel = ({ logs = [], errors = [], isExecuting = false, executionStats = null }) => {
  const logContainerRef = useRef(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, errors]);

  const formatTimestamp = (date) => {
    if (!date) {
      return '';
    }

    const resolvedDate = new Date(date);
    return resolvedDate.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const headerStatus = isExecuting
    ? '执行中'
    : executionStats
    ? executionStats.success
      ? '运行成功'
      : '运行异常'
    : '等待运行';

  const totalLogItems = logs.length + errors.length;

  return (
    <section className="log-panel">
      <div className="log-header">
        <div className="log-header-copy">
          <span className="panel-kicker">运行控制台</span>
          <h3>执行日志</h3>
          <p>查看每条指令的运行结果，并直接定位错误行和出错指令。</p>
        </div>

        <div className="log-badges">
          <span className={`badge badge-status ${isExecuting ? 'badge-warning' : 'badge-info'}`}>
            {headerStatus}
          </span>
          <span className="badge badge-info">{totalLogItems} 条记录</span>
          {errors.length > 0 && (
            <span className="badge badge-error">{errors.length} 个错误</span>
          )}
        </div>
      </div>

      <div className="log-content" ref={logContainerRef}>
        {logs.length === 0 && errors.length === 0 ? (
          <div className="log-empty">
            <strong>还没有执行记录</strong>
            <p>先在左侧输入或载入示例，然后点击“运行脚本”生成图形。</p>
            <div className="log-empty-steps">
              <span>1. 编写或载入示例</span>
              <span>2. 运行并查看图形</span>
              <span>3. 必要时同步自由点回代码</span>
            </div>
          </div>
        ) : (
          <>
            {logs.map((log, index) => {
              const levelMeta = LEVEL_META[log.level] || LEVEL_META.info;
              return (
                <div
                  key={`log-${index}`}
                  className={`log-entry log-${log.level}`}
                  title={log.data ? JSON.stringify(log.data, null, 2) : ''}
                >
                  <span className="log-timestamp">{formatTimestamp(log.timestamp)}</span>
                  <span className={`log-icon log-icon-${log.level}`} aria-hidden="true">
                    <AppIcon className="log-icon-image" decorative />
                  </span>
                  <div className="log-body">
                    <div className="log-meta-row">
                      <span className="log-level-label">{levelMeta.label}</span>
                    </div>
                    <span className="log-message">{log.message}</span>
                  </div>
                </div>
              );
            })}

            {errors.length > 0 && (
              <div className="log-section">
                <div className="log-section-title">错误详情</div>
                {errors.map((error, index) => (
                  <div key={`error-${index}`} className="log-entry log-error">
                    <span className="log-timestamp">{formatTimestamp(error.timestamp)}</span>
                    <span className="log-icon log-icon-error" aria-hidden="true">
                      <AppIcon className="log-icon-image" decorative />
                    </span>
                    <div className="log-error-content">
                      <div className="log-error-line">
                        第 {error.lineNumber ?? error.line ?? '—'} 行
                      </div>
                      {error.command && (
                        <div className="log-error-command">{error.command}</div>
                      )}
                      <div className="log-error-message">{error.message}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};

export default memo(LogPanel);
