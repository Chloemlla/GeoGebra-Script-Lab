import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import './CodeEditor.css';

const toCssSize = (value) => (typeof value === 'number' ? `${value}px` : value);
const DEFAULT_EDITOR_VALUE = '// 在这里输入 GeoGebra 指令\n';

let isMonacoConfigured = false;

const resolveMonacoWorkerUrl = (label) => {
  if (label === 'json') {
    return 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/language/json/json.worker.js';
  }
  if (label === 'css' || label === 'scss' || label === 'less') {
    return 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/language/css/css.worker.js';
  }
  if (label === 'html' || label === 'handlebars' || label === 'razor') {
    return 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/language/html/html.worker.js';
  }
  if (label === 'typescript' || label === 'javascript') {
    return 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/language/typescript/ts.worker.js';
  }

  return 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/editor/editor.worker.js';
};

const createMonacoWorker = (label) => {
  const workerUrl = resolveMonacoWorkerUrl(label);
  const blob = new Blob(
    [`importScripts(${JSON.stringify(workerUrl)});`],
    { type: 'application/javascript' }
  );
  const blobUrl = URL.createObjectURL(blob);
  const worker = new Worker(blobUrl, { name: `monaco-${label || 'editor'}` });

  // Worker 已经拿到 blob 内容后即可释放 URL，避免不断创建临时对象 URL。
  setTimeout(() => URL.revokeObjectURL(blobUrl), 0);

  return worker;
};

const ensureMonacoConfiguration = () => {
  if (isMonacoConfigured) {
    return;
  }

  monaco.languages.register({ id: 'geogebra' });
  monaco.languages.setMonarchTokensProvider('geogebra', {
    defaultToken: '',
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
        [/\b\d+(\.\d+)?\b/, 'number'],
        [
          /\b(Polygon|Circle|Segment|Line|Ray|Midpoint|Text|Point|Translate|Rotate|Tangent|Intersect|PerpendicularLine|ParallelLine|Angle|Area)\b/,
          'keyword',
        ],
        [/[A-Za-z_]\w*(?=\s*\()/, 'type.identifier'],
        [/[A-Za-z_]\w*(?=\s*=)/, 'variable'],
        [/[=+\-*/^]/, 'operator'],
        [/[()[\]{}]/, '@brackets'],
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape.invalid'],
        [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
      ],
    },
  });

  monaco.editor.defineTheme('geogebra-workbench', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8C8C91' },
      { token: 'string', foreground: 'F4D58A' },
      { token: 'number', foreground: '7FC4FF' },
      { token: 'keyword', foreground: '5AB2FF', fontStyle: 'bold' },
      { token: 'variable', foreground: 'F5F5F7' },
      { token: 'type.identifier', foreground: '9AD0FF' },
      { token: 'operator', foreground: 'F5F5F7' },
    ],
    colors: {
      'editor.background': '#161617',
      'editor.foreground': '#F5F5F7',
      'editor.lineHighlightBackground': '#232326',
      'editorLineNumber.foreground': '#6E6E73',
      'editorLineNumber.activeForeground': '#F5F5F7',
      'editor.selectionBackground': '#0071E344',
      'editor.inactiveSelectionBackground': '#0071E322',
      'editorCursor.foreground': '#FFFFFF',
      'editorIndentGuide.background1': '#2A2A2C',
      'editorIndentGuide.activeBackground1': '#424245',
      'editorBracketMatch.background': '#2997FF22',
      'editorBracketMatch.border': '#2997FF55',
      'editorWidget.background': '#1F1F21',
      'editorWidget.border': '#424245',
      'editorGutter.background': '#161617',
    },
  });

  isMonacoConfigured = true;
};

const CodeEditor = ({
  value,
  onChange,
  width = 400,
  height = 600,
  language = 'geogebra',
  theme = 'geogebra-workbench',
  readOnly = false,
}) => {
  const containerRef = useRef(null);
  const editorInstanceRef = useRef(null);
  const changeHandlerRef = useRef(onChange);

  useEffect(() => {
    changeHandlerRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (typeof window !== 'undefined' && !window.MonacoEnvironment) {
      window.MonacoEnvironment = {
        getWorker: (_moduleId, label) => createMonacoWorker(label),
      };
    }

    ensureMonacoConfiguration();
    monaco.editor.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!containerRef.current || editorInstanceRef.current) {
      return undefined;
    }

    const editor = monaco.editor.create(containerRef.current, {
      value: value || DEFAULT_EDITOR_VALUE,
      language,
      theme,
      readOnly,
      fontSize: 15,
      fontFamily: '"SF Mono", "Cascadia Mono", "JetBrains Mono", "Fira Code", monospace',
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      minimap: { enabled: false },
      folding: true,
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      insertSpaces: true,
      smoothScrolling: true,
      cursorBlinking: 'phase',
      cursorSmoothCaretAnimation: 'on',
      renderLineHighlight: 'all',
      roundedSelection: true,
      bracketPairColorization: { enabled: true },
      suggest: {
        showKeywords: false,
      },
      padding: {
        top: 18,
        bottom: 18,
      },
      scrollbar: {
        vertical: 'visible',
        horizontal: 'visible',
        verticalScrollbarSize: 12,
        horizontalScrollbarSize: 12,
      },
      overviewRulerBorder: false,
    });

    editorInstanceRef.current = editor;

    const subscription = editor.onDidChangeModelContent(() => {
      if (changeHandlerRef.current) {
        changeHandlerRef.current(editor.getValue());
      }
    });

    return () => {
      subscription.dispose();
      editor.dispose();
      editorInstanceRef.current = null;
    };
  }, [language, readOnly, theme, value]);

  useEffect(() => {
    const editor = editorInstanceRef.current;
    if (!editor) {
      return;
    }

    monaco.editor.setTheme(theme);
    editor.updateOptions({ readOnly });

    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, language);
      const nextValue = value || DEFAULT_EDITOR_VALUE;
      if (nextValue !== model.getValue()) {
        model.setValue(nextValue);
      }
    }
  }, [language, readOnly, theme, value]);

  return (
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

      <div ref={containerRef} className="code-editor-surface" />
    </div>
  );
};

export default CodeEditor;
