import React from 'react';
import AuthPanel from './AuthPanel';

const AppAuthPage = ({
  panelRef,
  authState,
  authValidation,
  isSubmittingAuth,
  currentUser,
  authSession,
  isAuthenticated,
  handleAuthSubmit,
  handleLogout,
}) => (
  <section className="chapter chapter-light auth-page-section">
    <div ref={panelRef}>
      <AuthPanel
        authState={authState}
        validation={authValidation}
        isSubmitting={isSubmittingAuth}
        currentUser={currentUser}
        sessionExpiresAt={authSession?.expiresAt ?? null}
        isAuthenticated={isAuthenticated}
        onSubmit={handleAuthSubmit}
        onLogout={handleLogout}
      />
    </div>
  </section>
);

export default AppAuthPage;
