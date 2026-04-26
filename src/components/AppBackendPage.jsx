import React from 'react';
import AdminConsole from './AdminConsole';
import BackendPanel from './BackendPanel';

const AppBackendPage = ({
  backendStatus,
  generationPrompt,
  setGenerationPrompt,
  referenceFile,
  handleReferenceFileChange,
  handleGenerateFromBackend,
  handlePublishShare,
  focusAuthentication,
  latestJobResult,
  latestShare,
  activeShareSlug,
  isAuthenticated,
  authUserLabel,
  canPublishShare,
  isGeneratingScript,
  isPublishingShare,
  adminDashboard,
  adminState,
  refreshAdminDashboard,
  isAdminAutoRefresh,
  setIsAdminAutoRefresh,
}) => (
  <section className="chapter chapter-light">
    <div className="chapter-header">
      <div>
        <span className="section-kicker">Backend Operations</span>
        <h2>后端能力与管理页面</h2>
      </div>
    </div>

    <div className="backend-page-stack">
      <BackendPanel
        backendStatus={backendStatus}
        prompt={generationPrompt}
        onPromptChange={setGenerationPrompt}
        selectedFile={referenceFile}
        onFileChange={handleReferenceFileChange}
        onGenerate={handleGenerateFromBackend}
        onPublish={handlePublishShare}
        onRequireAuth={() => focusAuthentication('登录后即可调用后端 Bridge 能力')}
        latestJobResult={latestJobResult}
        latestShare={latestShare}
        activeShareSlug={activeShareSlug}
        isAuthenticated={isAuthenticated}
        authUserLabel={authUserLabel}
        canPublish={canPublishShare}
        isGenerating={isGeneratingScript}
        isPublishing={isPublishingShare}
      />

      <AdminConsole
        backendStatus={backendStatus}
        adminDashboard={adminDashboard}
        adminState={adminState}
        onRefresh={() => {
          void refreshAdminDashboard();
        }}
        autoRefresh={isAdminAutoRefresh}
        onToggleAutoRefresh={() => setIsAdminAutoRefresh((prev) => !prev)}
      />
    </div>
  </section>
);

export default AppBackendPage;
