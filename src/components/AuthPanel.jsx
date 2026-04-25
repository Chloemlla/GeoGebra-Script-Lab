import React from 'react';
import './AuthPanel.css';

const STATUS_META = {
  checking: {
    title: '会话检查中',
    tone: 'neutral',
  },
  authenticated: {
    title: '已登录',
    tone: 'success',
  },
  guest: {
    title: '未登录',
    tone: 'neutral',
  },
  error: {
    title: '认证异常',
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
  authMode,
  authForm,
  isSubmitting,
  currentUser,
  sessionExpiresAt,
  isAuthenticated,
  onModeChange,
  onFieldChange,
  onSubmit,
  onLogout,
}) => {
  const statusMeta = STATUS_META[authState?.state] ?? STATUS_META.guest;

  return (
    <section className="auth-panel">
      <div className="auth-panel-copy">
        <span className="section-kicker">Account Access</span>
        <h2>登录与注册</h2>
        <p>
          认证成功后，上传、AI 生成、分享发布这三类后端操作都会自动携带 Bearer token。
          前端会在本地保存会话，并在刷新后自动恢复。
        </p>
      </div>

      <div className="auth-panel-shell">
        <article className="auth-card">
          <div className={`auth-status auth-status-${statusMeta.tone}`}>
            <strong>{statusMeta.title}</strong>
            <span>{authState?.message || '登录后即可使用受保护接口'}</span>
          </div>

          {isAuthenticated && currentUser ? (
            <div className="auth-summary">
              <div className="auth-summary-grid">
                <div className="auth-summary-item">
                  <span>显示名</span>
                  <strong>{currentUser.displayName || currentUser.username}</strong>
                </div>
                <div className="auth-summary-item">
                  <span>用户名</span>
                  <strong>@{currentUser.username}</strong>
                </div>
                <div className="auth-summary-item">
                  <span>邮箱</span>
                  <strong>{currentUser.email}</strong>
                </div>
                <div className="auth-summary-item">
                  <span>会话有效期</span>
                  <strong>{formatDateTime(sessionExpiresAt)}</strong>
                </div>
              </div>

              <p className="auth-note">
                当前会话有效时，Backend Bridge 中的上传、生成和分享按钮会直接调用受保护接口。
              </p>

              <div className="auth-actions">
                <button
                  type="button"
                  className="auth-btn auth-btn-secondary"
                  onClick={onLogout}
                  disabled={isSubmitting}
                >
                  退出登录
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="auth-tabs" role="tablist" aria-label="认证模式切换">
                <button
                  type="button"
                  className={`auth-tab ${authMode === 'login' ? 'active' : ''}`}
                  onClick={() => onModeChange('login')}
                >
                  登录
                </button>
                <button
                  type="button"
                  className={`auth-tab ${authMode === 'register' ? 'active' : ''}`}
                  onClick={() => onModeChange('register')}
                >
                  注册
                </button>
              </div>

              <form
                className="auth-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSubmit();
                }}
              >
                {authMode === 'register' ? (
                  <div className="auth-form-grid">
                    <label className="auth-field">
                      <span>显示名</span>
                      <input
                        type="text"
                        value={authForm.displayName}
                        onChange={(event) => onFieldChange('displayName', event.target.value)}
                        placeholder="例如：几何实验室管理员"
                        autoComplete="name"
                      />
                    </label>

                    <label className="auth-field">
                      <span>用户名</span>
                      <input
                        type="text"
                        value={authForm.username}
                        onChange={(event) => onFieldChange('username', event.target.value)}
                        placeholder="仅限字母、数字、_、-"
                        autoComplete="username"
                      />
                    </label>

                    <label className="auth-field auth-field-full">
                      <span>邮箱</span>
                      <input
                        type="email"
                        value={authForm.email}
                        onChange={(event) => onFieldChange('email', event.target.value)}
                        placeholder="name@example.com"
                        autoComplete="email"
                      />
                    </label>

                    <label className="auth-field">
                      <span>密码</span>
                      <input
                        type="password"
                        value={authForm.password}
                        onChange={(event) => onFieldChange('password', event.target.value)}
                        placeholder="至少 8 位"
                        autoComplete="new-password"
                      />
                    </label>

                    <label className="auth-field">
                      <span>确认密码</span>
                      <input
                        type="password"
                        value={authForm.confirmPassword}
                        onChange={(event) => onFieldChange('confirmPassword', event.target.value)}
                        placeholder="再次输入密码"
                        autoComplete="new-password"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="auth-form-grid auth-form-grid-login">
                    <label className="auth-field auth-field-full">
                      <span>邮箱或用户名</span>
                      <input
                        type="text"
                        value={authForm.account}
                        onChange={(event) => onFieldChange('account', event.target.value)}
                        placeholder="输入邮箱或用户名"
                        autoComplete="username"
                      />
                    </label>

                    <label className="auth-field auth-field-full">
                      <span>密码</span>
                      <input
                        type="password"
                        value={authForm.password}
                        onChange={(event) => onFieldChange('password', event.target.value)}
                        placeholder="输入密码"
                        autoComplete="current-password"
                      />
                    </label>
                  </div>
                )}

                <div className="auth-actions">
                  <button
                    type="submit"
                    className="auth-btn auth-btn-primary"
                    disabled={isSubmitting}
                  >
                    {isSubmitting
                      ? '提交中...'
                      : authMode === 'register'
                      ? '注册并登录'
                      : '登录并恢复会话'}
                  </button>
                </div>
              </form>
            </>
          )}
        </article>

        <article className="auth-card auth-side-card">
          <span className="auth-card-label">Session Rules</span>
          <ul className="auth-checklist">
            <li>注册成功后会立即签发登录态，无需再次登录。</li>
            <li>前端自动把 token 附加到上传、生成和分享请求。</li>
            <li>如果会话失效，受保护操作会提示重新登录。</li>
            <li>PowerShell 调试命令建议固定为 UTF-8 JSON 输出。</li>
          </ul>
        </article>
      </div>
    </section>
  );
};

export default AuthPanel;
