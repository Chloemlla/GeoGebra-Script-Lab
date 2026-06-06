import React from 'react';
import './AuthPanel.css';

const STATUS_META = {
  checking: {
    title: 'Synapse 校验中',
    tone: 'neutral',
  },
  authenticated: {
    title: 'Synapse 已连接',
    tone: 'success',
  },
  guest: {
    title: '未连接 Synapse',
    tone: 'neutral',
  },
  error: {
    title: 'Synapse 认证异常',
    tone: 'danger',
  },
};

const formatDateTime = (value) => {
  if (!value) {
    return '--';
  }

  try {
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch (_error) {
    return value;
  }
};

const AuthPanel = ({
  authState,
  validation,
  isSubmitting,
  currentUser,
  sessionExpiresAt,
  isAuthenticated,
  onSubmit,
  onLogout,
}) => {
  const statusMeta = STATUS_META[authState?.state] ?? STATUS_META.guest;

  return (
    <section className="auth-panel">
      <div className="auth-panel-copy">
        <span className="section-kicker">Synapse OAuth</span>
        <h2>Synapse 授权登录</h2>
        <p>
          当前应用只接受 Synapse OAuth access token；本地注册、密码登录和本地 session 已移除。
        </p>
      </div>

      <div className="auth-panel-shell">
        <article className="auth-card">
          <div className={`auth-status auth-status-${statusMeta.tone}`}>
            <strong>{statusMeta.title}</strong>
            <span>{authState?.message || '使用 Synapse 授权后即可使用受保护接口'}</span>
          </div>

          {isAuthenticated && currentUser ? (
            <div className="auth-summary">
              <div className="auth-summary-grid">
                <div className="auth-summary-item">
                  <span>显示名</span>
                  <strong>{currentUser.displayName || currentUser.username}</strong>
                </div>
                <div className="auth-summary-item">
                  <span>Synapse ID</span>
                  <strong>{currentUser.userId}</strong>
                </div>
                <div className="auth-summary-item">
                  <span>角色</span>
                  <strong>{currentUser.role || (currentUser.isAdmin ? 'admin' : 'trusted')}</strong>
                </div>
                <div className="auth-summary-item">
                  <span>邮箱</span>
                  <strong>{currentUser.email || '--'}</strong>
                </div>
                <div className="auth-summary-item">
                  <span>账号状态</span>
                  <strong>{currentUser.accountStatus || 'active'}</strong>
                </div>
                <div className="auth-summary-item">
                  <span>Token 有效期</span>
                  <strong>{formatDateTime(sessionExpiresAt)}</strong>
                </div>
              </div>

              <p className="auth-note">
                后端会在受保护请求中通过 Synapse userinfo 实时校验当前 Bearer token。
              </p>

              <div className="auth-actions">
                <button
                  type="button"
                  className="auth-btn auth-btn-secondary"
                  onClick={onLogout}
                  disabled={isSubmitting}
                >
                  清除本地凭证
                </button>
              </div>
            </div>
          ) : (
            <div className="auth-form">
              <p className="auth-inline-note auth-inline-note-success">
                {validation?.formMessage || '将跳转到 Synapse 授权页。'}
              </p>

              <div className="auth-actions">
                <button
                  type="button"
                  className="auth-btn auth-btn-primary"
                  onClick={onSubmit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? '正在跳转...' : '使用 Synapse 授权'}
                </button>
              </div>
            </div>
          )}
        </article>
      </div>
    </section>
  );
};

export default AuthPanel;
