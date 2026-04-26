import React from 'react';
import AuthPanel from './AuthPanel';

const AppAuthPage = ({
  panelRef,
  authState,
  authMode,
  authForm,
  authValidation,
  isSubmittingAuth,
  currentUser,
  authSession,
  isAuthenticated,
  handleAuthModeChange,
  handleAuthFieldChange,
  handleAuthSubmit,
  handleLogout,
}) => (
  <section className="chapter chapter-light auth-page-section">
    <div ref={panelRef}>
      <AuthPanel
        authState={authState}
        authMode={authMode}
        authForm={authForm}
        validation={authValidation}
        isSubmitting={isSubmittingAuth}
        currentUser={currentUser}
        sessionExpiresAt={authSession?.expiresAt ?? null}
        isAuthenticated={isAuthenticated}
        onModeChange={handleAuthModeChange}
        onFieldChange={handleAuthFieldChange}
        onSubmit={handleAuthSubmit}
        onLogout={handleLogout}
      />
    </div>
  </section>
);

export default AppAuthPage;
