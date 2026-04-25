import React, { Suspense, lazy, memo } from 'react';
import './CodeEditor.css';

const MonacoCodeEditor = lazy(() => import('./MonacoCodeEditor'));

const toCssSize = (value) => (typeof value === 'number' ? `${value}px` : value);

const EditorFallback = ({ width, height, readOnly }) => (
  <div
    className="code-editor-shell"
    style={{
      width: toCssSize(width),
      height: toCssSize(height),
    }}
  >
    <div className="code-editor-topbar">
      <div className="code-editor-window-controls" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>

      <div className="code-editor-badges">
        <span className="code-editor-badge">Geo Script</span>
        <span className="code-editor-badge">UTF-8</span>
        <span className="code-editor-badge">{readOnly ? '只读' : '可编辑'}</span>
      </div>
    </div>

    <div
      className="code-editor-surface"
      style={{
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        color: 'rgba(255, 255, 255, 0.72)',
      }}
    >
      正在按需加载编辑器核心...
    </div>
  </div>
);

const CodeEditor = (props) => (
  <Suspense
    fallback={
      <EditorFallback
        width={props.width}
        height={props.height}
        readOnly={props.readOnly}
      />
    }
  >
    <MonacoCodeEditor {...props} />
  </Suspense>
);

export default memo(CodeEditor);
