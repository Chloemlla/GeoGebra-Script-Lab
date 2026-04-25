import React, {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import GeoGebraContainer from './GeoGebraContainer';
import CodeEditor from './CodeEditor';
import ControlPanel from './ControlPanel';
import AdminConsole from './AdminConsole';
import AuthPanel from './AuthPanel';
import BackendPanel from './BackendPanel';
import LogPanel from './LogPanel';
import AppIcon from './AppIcon';
import GeoGebraEngine from '../engine/GeoGebraEngine';
import Preprocessor from '../engine/Preprocessor';
import Dispatcher from '../engine/Dispatcher';
import {
  clearAuthToken,
  createDrawingJob,
  createScriptInsights,
  createShare,
  fetchAdminDashboard,
  fetchHealth,
  fetchCurrentUser,
  fetchModelConfig,
  fetchShare,
  loginUser,
  logoutUser,
  pollDrawingJob,
  reserveUpload,
  registerUser,
  setAuthToken,
  uploadAsset,
} from '../api/backend';
import {
  clearStoredAuthSession,
  readStoredAuthSession,
  writeStoredAuthSession,
} from '../utils/auth';
import {
  appendInsightCommentsToCode,
  attachVersionToProject,
  buildPointCommandDiffs,
  buildRecentProjects,
  createProjectRecord,
  createVersionRecord,
  downloadTextFile,
  extractParameterControls,
  formatTagsInput,
  mergeCanvasStateIntoCode,
  parseTagsInput,
  readStudioState,
  replaceAssignmentValue,
  summarizeCodeDiff,
  upsertProject,
  writeStudioState,
} from '../utils/studio';
import { Analytics } from '@vercel/analytics/react';
import './App.css';

const DEFAULT_CODE = `// GeoGebra 交互式绘图系统
// 在下方输入 GeoGebra 指令，每行一条

// 创建点
A = (0, 0)
B = (3, 0)
C = (3, 4)
D = (0, 4)

// 创建多边形
poly = Polygon(A, B, C, D)

// 创建圆
circle = Circle(A, 2)

// 添加文字标签
l1 = "ABCD 是一个矩形"
`;

const STARTER_SNIPPETS = [
  {
    id: 'rectangle-circle',
    eyebrow: '基础图形',
    title: '矩形与圆',
    description: '快速检查点、矩形、多边形和圆的协同绘制。',
    code: DEFAULT_CODE.trim(),
  },
  {
    id: 'triangle-midline',
    eyebrow: '三角几何',
    title: '三角形与中线',
    description: '适合验证点、线段、中点与文本标注。',
    code: `// 三角形与中线
A = (-3, 0)
B = (3, 0)
C = (1, 4)

tri = Polygon(A, B, C)
M = Midpoint(B, C)
median = Segment(A, M)
label = Text("AM 是三角形的一条中线", (-4, -1))`,
  },
  {
    id: 'function-tangent',
    eyebrow: '函数探索',
    title: '函数与切线',
    description: '观察函数图像、切点与切线的实时关系。',
    code: `// 函数与切线
f(x) = 0.2x^3 - x
A = (1.5, f(1.5))
t = Tangent(A, f)
pt = Point(f)
note = Text("拖动点 A 或重新运行观察切线变化", (-4, 5))`,
  },
  {
    id: 'transform',
    eyebrow: '图形变换',
    title: '平移与旋转',
    description: '适合验证变换类指令与日志反馈。',
    code: `// 平移与旋转
A = (0, 0)
B = (2, 1)
C = (1, 3)

poly = Polygon(A, B, C)
shifted = Translate(poly, (3, 1))
rotated = Rotate(poly, 45°, A)
tip = Text("观察原图、平移图与旋转图", (-3, -1))`,
  },
];

const MOBILE_BREAKPOINT = 1024;
const PHONE_BREAKPOINT = 480;
const DEFAULT_CANVAS_MODE_ID = 'geometry';
const DEFAULT_GENERATION_PROMPT = '识别图中的几何关系并输出可执行的 GeoGebra commands';
const DEFAULT_PROJECT_TITLE = '未命名项目';
const DEFAULT_PROJECT_FOLDER = '个人空间';
const SHARE_QUERY_KEY = 'share';
const POWERSHELL_BOOTSTRAP = `$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'

function Invoke-ApiJson {
  param(
    [Parameter(Mandatory)]
    [scriptblock] $Request
  )

  $result = & $Request
  if ($null -eq $result) {
    return '{}'
  }

  $result | ConvertTo-Json -Depth 10
}`;
const withPowershellJsonOutput = (command) => `${POWERSHELL_BOOTSTRAP}

Invoke-ApiJson {
${command}
}`;
const POWERSHELL_OUTPUT_COMMAND = withPowershellJsonOutput(
  'Invoke-RestMethod -Uri "$env:API_BASE/api/v1/..." -Method Get'
);
const OPEN_SOURCE_REPOSITORY_SEGMENTS = Object.freeze([
  'github.com',
  'Chloemlla',
  'GeoGebra-Script-Lab',
]);
const OPEN_SOURCE_REPOSITORY_PATH = OPEN_SOURCE_REPOSITORY_SEGMENTS.join('/');
const OPEN_SOURCE_REPOSITORY_URL = `https://${OPEN_SOURCE_REPOSITORY_PATH}`;
const OPEN_SOURCE_LINK_LABEL = 'Open Source';
const OPEN_SOURCE_LINK_REL = 'external noopener noreferrer';
const OPEN_SOURCE_LINK_SIGNATURE = `github-origin:${OPEN_SOURCE_REPOSITORY_PATH}`;
const OPEN_SOURCE_LINK_ARIA_LABEL = `查看开源仓库：${OPEN_SOURCE_REPOSITORY_PATH}`;

const CANVAS_MODES = [
  {
    id: 'geometry',
    appName: 'geometry',
    label: '平面几何',
    shortHint: '点线面作图',
    description: '适合 Polygon、Midpoint、Circle、PerpendicularLine 等平面几何构造。',
    stageLabel: 'Plane Geometry Stage',
    stageTip: '适合多边形、作垂线、中点与平面作图',
    readyHint: '可以执行平面几何脚本、拖拽自由点或导出图像',
  },
  {
    id: '3d',
    appName: '3d',
    label: '立体几何',
    shortHint: '空间点线面',
    description: '适合空间点、空间直线、平面与立体图形的构造和观察。',
    stageLabel: '3D Geometry Stage',
    stageTip: '适合观察空间关系、立体图形与三维坐标',
    readyHint: '可以执行立体几何脚本并旋转观察三维图形',
  },
  {
    id: 'graphing',
    appName: 'graphing',
    label: '函数图形',
    shortHint: '函数与滑块',
    description: '适合函数、曲线、滑块与数值变化，不适合完整几何作图脚本。',
    stageLabel: 'Graphing Stage',
    stageTip: '适合函数、参数滑块与图像分析',
    readyHint: '可以执行函数图形脚本、调参数并导出图像',
  },
  {
    id: 'classic',
    appName: 'classic',
    label: '综合工作台',
    shortHint: '混合场景',
    description: '同时适合几何、函数与混合探索，适合不想预先限定工作流的场景。',
    stageLabel: 'Classic Math Stage',
    stageTip: '适合混合几何、函数与综合探索',
    readyHint: '可以执行混合数学脚本并在统一工作台中观察结果',
  },
];

const COMMERCIALIZATION_PRIORITIES = [
  {
    id: 'image-to-script',
    stage: 'P0',
    title: '图片转 GeoGebra 指令',
    value: '这是最容易被付费购买的能力，因为它直接把“不会写脚本”变成“能快速出图”。',
    implementation:
      '前端上传课堂截图、手绘草图或题目配图，后端用多模态模型解析成 scene spec，再生成可执行的 GeoGebra commands。',
    monetization: '按次消耗 AI credits，或打包进 Pro / 教培机构版订阅。',
    kpi: '关注图片转脚本成功率、首次出图耗时、生成后人工修改率。',
  },
  {
    id: 'share-canvas',
    stage: 'P0',
    title: '分享画布与可复用链接',
    value: '这是增长飞轮，不只是“导出图片”，而是让别人能打开链接继续拖拽、查看脚本和二次创作。',
    implementation:
      '后端保存脚本、截图、画布模式、视口和作者信息，生成 share slug、预览图和埋点统计。',
    monetization: '免费版公开分享带水印；付费版支持私密分享、品牌页、访问数据和嵌入站点。',
    kpi: '关注分享创建率、分享打开率、二次编辑率和自然新增用户占比。',
  },
  {
    id: 'workspace-review',
    stage: 'P1',
    title: '模板库、团队空间与审阅',
    value: '这部分决定客单价，尤其对学校、教培、课程内容团队和企业培训部门有价值。',
    implementation:
      '给项目、模板、评论、版本和角色权限建模，把个人工具升级成团队资产平台。',
    monetization: '席位制订阅、机构空间、模板市场分成和私有部署。',
    kpi: '关注团队留存、模板复用率、月活机构数和付费转化率。',
  },
];

const COMMERCIALIZATION_FLOW = [
  '前端上传图片或题目截图，先拿到上传凭证与 assetId。',
  '后端异步创建 AI drawing job，生成 scene spec、GeoGebra 指令和渲染建议。',
  '前端轮询任务状态，成功后把 commands 注入现有执行器，在 GeoGebra 画布中渲染。',
  '用户继续拖拽、修正、保存，再生成分享链接形成增长闭环。',
];

const WORKFLOW_STEPS = [
  '在编辑器中输入或载入 GeoGebra 指令。',
  '运行后在右侧实时查看几何图形与执行结果。',
  '拖动自由点时，可一键把新坐标同步回代码。',
];

const EDITOR_NOTES = [
  {
    title: 'UTF-8 中文注释',
    description: '编辑器与命令读取保持 UTF-8，中文注释和标题不会被误读。',
  },
  {
    title: '运行前自动清理画布',
    description: '每次执行都会先重置画布，减少旧对象残留导致的误判。',
  },
  {
    title: '拖拽与代码双向协作',
    description: '允许先拖拽验证想法，再把点位同步回脚本，形成闭环。',
  },
];

const API_RESPONSE_ENVELOPE = `{
  "success": true,
  "code": "OK",
  "message": "drawing job accepted",
  "requestId": "req_01JV7Q4V7V5G1YF0AX5WG4N7Q2",
  "data": {},
  "meta": {
    "timestamp": "2026-04-25T14:10:00.000Z",
    "version": "v1"
  },
  "error": null
}`;

const POWERSHELL_UTF8_NOTE = `# 文件本身就是 UTF-8；PowerShell 调试时先固定输入/输出编码，再把返回对象统一转成 JSON
${POWERSHELL_OUTPUT_COMMAND}`;

const API_ENDPOINT_BLUEPRINT = [
  {
    id: 'asset-upload',
    method: 'POST',
    path: '/api/v1/assets/uploads',
    title: '申请上传凭证',
    description:
      '先向业务后端申请上传凭证，元数据走索引表，文件正文走独立文件存储，不要把大文件直接塞进业务记录。',
    request: `{
  "filename": "triangle-sketch.png",
  "mimeType": "image/png",
  "size": 421993,
  "purpose": "ai_drawing_input",
  "canvasMode": "geometry"
}`,
    response: `{
  "success": true,
  "code": "UPLOAD_URL_CREATED",
  "message": "upload slot created",
  "requestId": "req_01JV7Q5EVK0X8VMEVQ4XVB8P6T",
  "data": {
    "assetId": "asset_01JV7Q5F9CW4S8FBCV7S9F1A7M",
    "uploadUrl": "https://storage.example.com/presigned-put",
    "fileUrl": "https://cdn.example.com/assets/asset_01JV7Q5F9CW4S8FBCV7S9F1A7M.png",
    "expiresIn": 900
  }
}`,
    powershell: withPowershellJsonOutput(`$body = @{
  filename = "triangle-sketch.png"
  mimeType = "image/png"
  size = 421993
  purpose = "ai_drawing_input"
  canvasMode = "geometry"
} | ConvertTo-Json

Invoke-RestMethod -Uri "$env:API_BASE/api/v1/assets/uploads" -Method Post -ContentType "application/json; charset=utf-8" -Body $body`),
  },
  {
    id: 'drawing-job',
    method: 'POST',
    path: '/api/v1/ai/drawing-jobs',
    title: '创建 AI 绘图任务',
    description:
      '真正的 AI 工作放进受限并发队列，避免前端超时和模型服务被打爆。任务负责图片理解、几何识别、命令生成和安全校验。',
    request: `{
  "assetId": "asset_01JV7Q5F9CW4S8FBCV7S9F1A7M",
  "prompt": "识别图中的三角形与中线，并输出可执行脚本",
  "canvasMode": "geometry",
  "responseFormat": "geogebra_commands_v1",
  "locale": "zh-CN"
}`,
    response: `{
  "success": true,
  "code": "JOB_ACCEPTED",
  "message": "drawing job queued",
  "requestId": "req_01JV7Q6Z53WQH4Q2JQ4T7MM9TS",
  "data": {
    "jobId": "job_01JV7Q708K7W6FDH3Y4SEB4T5W",
    "status": "queued",
    "pollUrl": "/api/v1/ai/drawing-jobs/job_01JV7Q708K7W6FDH3Y4SEB4T5W",
    "creditsReserved": 12,
    "estimatedLatencyMs": 6000
  }
}`,
    powershell: withPowershellJsonOutput(`$body = @{
  assetId = "asset_01JV7Q5F9CW4S8FBCV7S9F1A7M"
  prompt = "识别图中的三角形与中线，并输出可执行脚本"
  canvasMode = "geometry"
  responseFormat = "geogebra_commands_v1"
  locale = "zh-CN"
} | ConvertTo-Json

Invoke-RestMethod -Uri "$env:API_BASE/api/v1/ai/drawing-jobs" -Method Post -ContentType "application/json; charset=utf-8" -Body $body`),
  },
  {
    id: 'drawing-job-status',
    method: 'GET',
    path: '/api/v1/ai/drawing-jobs/{jobId}',
    title: '查询任务结果',
    description:
      '前端轮询这个接口，结果查询必须命中正确缓存和主键索引；当 status=completed 时再把 commands 交给现有 Dispatcher。',
    request: `GET /api/v1/ai/drawing-jobs/job_01JV7Q708K7W6FDH3Y4SEB4T5W`,
    response: `{
  "success": true,
  "code": "JOB_COMPLETED",
  "message": "drawing job completed",
  "requestId": "req_01JV7Q8T7SK5EXNV8C5P4S5E1S",
  "data": {
    "jobId": "job_01JV7Q708K7W6FDH3Y4SEB4T5W",
    "status": "completed",
    "sceneSummary": "识别出三角形 ABC 及边 BC 的中点 M",
    "canvasMode": "geometry",
    "commands": [
      "A = (-3, 0)",
      "B = (3, 0)",
      "C = (1, 4)",
      "tri = Polygon(A, B, C)",
      "M = Midpoint(B, C)",
      "median = Segment(A, M)"
    ],
    "renderHints": {
      "resetBeforeRun": true,
      "suggestedViewport": { "xmin": -5, "xmax": 5, "ymin": -2, "ymax": 6 }
    },
    "diagnostics": {
      "confidence": 0.92,
      "humanReviewRecommended": false
    }
  }
}`,
    powershell: withPowershellJsonOutput(
      'Invoke-RestMethod -Uri "$env:API_BASE/api/v1/ai/drawing-jobs/job_01JV7Q708K7W6FDH3Y4SEB4T5W" -Method Get'
    ),
  },
  {
    id: 'share-canvas',
    method: 'POST',
    path: '/api/v1/shares',
    title: '创建分享画布',
    description:
      '分享接口不要只存图片，至少要把脚本、封面文件、画布模式、版本和访问权限拆开存好，分享 slug 与资源引用都要可索引。',
    request: `{
  "title": "三角形中线示例",
  "canvasMode": "geometry",
  "commands": [
    "A = (-3, 0)",
    "B = (3, 0)",
    "C = (1, 4)",
    "tri = Polygon(A, B, C)",
    "M = Midpoint(B, C)",
    "median = Segment(A, M)"
  ],
  "coverAssetId": "asset_01JV7QAH3X6R2W8G7QJW6Q2E8B",
  "visibility": "public",
  "allowFork": true
}`,
    response: `{
  "success": true,
  "code": "SHARE_CREATED",
  "message": "share published",
  "requestId": "req_01JV7QB2B9T6R0W6NP8FBR4Y9G",
  "data": {
    "shareId": "share_01JV7QB9N2SQVG2YE2WZ4G2QH7",
    "slug": "median-demo-8h2f",
    "shareUrl": "https://app.example.com/s/median-demo-8h2f",
    "embedUrl": "https://app.example.com/embed/median-demo-8h2f",
    "posterUrl": "https://cdn.example.com/shares/median-demo-8h2f/poster.png"
  }
}`,
    powershell: withPowershellJsonOutput(`$body = @{
  title = "三角形中线示例"
  canvasMode = "geometry"
  commands = @(
    "A = (-3, 0)",
    "B = (3, 0)",
    "C = (1, 4)",
    "tri = Polygon(A, B, C)",
    "M = Midpoint(B, C)",
    "median = Segment(A, M)"
  )
  coverAssetId = "asset_01JV7QAH3X6R2W8G7QJW6Q2E8B"
  visibility = "public"
  allowFork = $true
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri "$env:API_BASE/api/v1/shares" -Method Post -ContentType "application/json; charset=utf-8" -Body $body`),
  },
];

const formatDuration = (duration) => {
  if (typeof duration !== 'number' || Number.isNaN(duration)) {
    return '未执行';
  }

  if (duration < 1000) {
    return `${duration} ms`;
  }

  if (duration < 10000) {
    return `${(duration / 1000).toFixed(2)} s`;
  }

  return `${(duration / 1000).toFixed(1)} s`;
};
const buildSharePageUrl = (slug) => {
  if (typeof window === 'undefined') {
    return `?${SHARE_QUERY_KEY}=${encodeURIComponent(slug)}`;
  }

  const url = new URL(window.location.href);
  url.searchParams.set(SHARE_QUERY_KEY, slug);
  return url.toString();
};

const normalizeScriptText = (commands) => `${commands.join('\n')}\n`;

const buildShareTitle = (value, fallback) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) {
    return fallback;
  }

  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}...` : trimmed;
};

const dataUrlToFile = async (dataUrl, filename) => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, {
    type: blob.type || 'image/png',
  });
};

const App = () => {
  const storedStudioState = readStudioState();
  const storedAuthSessionRef = useRef(readStoredAuthSession());
  const storedAuthSession = storedAuthSessionRef.current;
  const storedCurrentProject =
    storedStudioState.projects.find((project) => project.id === storedStudioState.currentProjectId)
    ?? storedStudioState.projects[0]
    ?? null;
  const [code, setCode] = useState(DEFAULT_CODE);
  const [logs, setLogs] = useState([]);
  const [errors, setErrors] = useState([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionStats, setExecutionStats] = useState(null);
  const [canvasDrift, setCanvasDrift] = useState({
    isDirty: false,
    changedObjects: [],
  });
  const [isCanvasLocked, setIsCanvasLocked] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth <= PHONE_BREAKPOINT : false)
  );
  const [selectedCanvasModeId, setSelectedCanvasModeId] = useState(DEFAULT_CANVAS_MODE_ID);
  const [activeTab, setActiveTab] = useState('code');
  const [viewportWidth, setViewportWidth] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth : 1440)
  );
  const [backendStatus, setBackendStatus] = useState({
    state: 'checking',
    message: '正在检测后端连接',
    modelName: '',
    providerBaseUrl: '',
  });
  const [authMode, setAuthMode] = useState('login');
  const [authState, setAuthState] = useState(
    storedAuthSession?.token
      ? {
          state: 'checking',
          message: '正在恢复登录会话',
        }
      : {
          state: 'guest',
          message: '登录后即可使用受保护的上传、AI 生成与分享接口',
        }
  );
  const [authSession, setAuthSession] = useState(storedAuthSession);
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);
  const [authForm, setAuthForm] = useState({
    account: '',
    email: '',
    username: '',
    displayName: '',
    password: '',
    confirmPassword: '',
  });
  const [adminDashboard, setAdminDashboard] = useState(null);
  const [adminState, setAdminState] = useState({
    state: 'loading',
    message: '正在拉取超级后台快照',
    isRefreshing: false,
  });
  const [isAdminAutoRefresh, setIsAdminAutoRefresh] = useState(true);
  const [savedProjects, setSavedProjects] = useState(storedStudioState.projects);
  const [currentProjectId, setCurrentProjectId] = useState(storedCurrentProject?.id ?? null);
  const [projectDraft, setProjectDraft] = useState({
    title: storedCurrentProject?.title ?? DEFAULT_PROJECT_TITLE,
    folder: storedCurrentProject?.folder ?? DEFAULT_PROJECT_FOLDER,
    tagsInput: formatTagsInput(storedCurrentProject?.tags ?? []),
    isFavorite: Boolean(storedCurrentProject?.isFavorite),
  });
  const [selectedDriftNames, setSelectedDriftNames] = useState([]);
  const [parameterValues, setParameterValues] = useState({});
  const [availableObjectNames, setAvailableObjectNames] = useState([]);
  const [selectedStyleNames, setSelectedStyleNames] = useState([]);
  const [styleDraft, setStyleDraft] = useState({
    color: '#0071e3',
    lineThickness: 3,
    pointSize: 5,
    labelVisible: true,
    showGrid: false,
    showAxes: true,
    scope: 'all',
  });
  const [lectureState, setLectureState] = useState({
    commands: [],
    currentStep: 0,
    isPlaying: false,
  });
  const [presentationMode, setPresentationMode] = useState(false);
  const [scriptInsights, setScriptInsights] = useState(null);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  const [versionComparison, setVersionComparison] = useState(null);
  const [versionCursor, setVersionCursor] = useState(-1);
  const [generationPrompt, setGenerationPrompt] = useState(DEFAULT_GENERATION_PROMPT);
  const [referenceFile, setReferenceFile] = useState(null);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isPublishingShare, setIsPublishingShare] = useState(false);
  const [latestJobResult, setLatestJobResult] = useState(null);
  const [latestShare, setLatestShare] = useState(null);
  const [activeShareSlug, setActiveShareSlug] = useState(null);
  const dispatcherRef = useRef(null);
  const startTimeRef = useRef(null);
  const dirtyWarningLoggedRef = useRef(false);
  const isExecutingRef = useRef(false);
  const canvasLockRef = useRef(isCanvasLocked);
  const openSourceLinkRef = useRef(null);
  const queuedScriptRef = useRef(null);
  const workspaceShellRef = useRef(null);
  const driftBaselineCodeRef = useRef(null);
  const lecturePlayTokenRef = useRef(0);
  const hasInitializedWorkspaceRef = useRef(false);
  const versionDraftStateRef = useRef(null);
  const initialShareSlugRef = useRef(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get(SHARE_QUERY_KEY)
      : null
  );
  const hasLoadedInitialShareRef = useRef(false);
  const deferredCode = useDeferredValue(code);
  const selectedCanvasMode = useMemo(
    () => CANVAS_MODES.find((mode) => mode.id === selectedCanvasModeId) ?? CANVAS_MODES[0],
    [selectedCanvasModeId]
  );
  const currentUser = authSession?.user ?? null;
  const isAuthenticated = authState.state === 'authenticated' && Boolean(authSession?.token && currentUser);

  const isCompactLayout = viewportWidth <= MOBILE_BREAKPOINT;
  const isPhoneLayout = viewportWidth <= PHONE_BREAKPOINT;
  const editorHeight = isPhoneLayout ? 360 : isCompactLayout ? 460 : 660;
  const canvasHeight = isPhoneLayout ? 380 : isCompactLayout ? 520 : 660;

  const populatedCodeLines = useMemo(
    () => deferredCode.split('\n').filter((line) => line.trim().length > 0).length,
    [deferredCode]
  );
  const changedPointCount = canvasDrift.changedObjects.length;
  const recentRunStatus = isExecuting
    ? '正在执行脚本'
    : executionStats
    ? executionStats.success
      ? '最近一次运行成功'
      : '最近一次运行出现错误'
    : '等待首次运行';
  const recentRunTone = isExecuting
    ? 'accent'
    : executionStats
    ? executionStats.success
      ? 'success'
      : 'danger'
    : 'neutral';
  const syncStatusText = canvasDrift.isDirty
    ? `${changedPointCount} 个自由点待同步`
    : isCanvasLocked
    ? '自由点拖拽已锁定'
    : '自由点可拖拽';
  const syncTone = canvasDrift.isDirty ? 'warning' : isCanvasLocked ? 'neutral' : 'success';
  const successRate = executionStats
    ? `${Math.round(
        (executionStats.successCount / Math.max(executionStats.successCount + executionStats.errorCount, 1))
          * 100
      )}%`
    : '未执行';
  const currentProject = useMemo(
    () => savedProjects.find((project) => project.id === currentProjectId) ?? null,
    [currentProjectId, savedProjects]
  );
  const recentProjects = useMemo(() => buildRecentProjects(savedProjects), [savedProjects]);
  const parameterControls = useMemo(() => extractParameterControls(deferredCode), [deferredCode]);
  const driftPointStates = useMemo(
    () => GeoGebraEngine.exportFreePointsAsCode(canvasDrift.changedObjects),
    [canvasDrift.changedObjects]
  );
  const pointDiffs = useMemo(
    () => buildPointCommandDiffs(deferredCode, driftPointStates),
    [deferredCode, driftPointStates]
  );
  const selectedStyleScopeNames =
    styleDraft.scope === 'selected'
      ? selectedStyleNames
      : availableObjectNames;
  const driftHasConflict =
    canvasDrift.isDirty
    && driftBaselineCodeRef.current !== null
    && driftBaselineCodeRef.current !== code;

  const backendTone =
    backendStatus.state === 'connected'
      ? 'success'
      : backendStatus.state === 'error'
      ? 'danger'
      : 'neutral';
  const authTone =
    authState.state === 'authenticated'
      ? 'success'
      : authState.state === 'error'
      ? 'danger'
      : 'neutral';
  const backendStatusText =
    backendStatus.state === 'connected'
      ? `API ready: ${backendStatus.modelName || 'model'}`
      : backendStatus.state === 'error'
      ? 'API unavailable'
      : 'API checking';
  const authStatusText = isAuthenticated
    ? `${currentUser.displayName || currentUser.username}`
    : authState.state === 'checking'
    ? '会话恢复中'
    : '未登录';
  const authUserLabel = currentUser
    ? `${currentUser.displayName || currentUser.username} (@${currentUser.username})`
    : '';
  const canPublishShare = isAuthenticated && code.trim().length > 0 && !isExecuting && !isGeneratingScript;

  const normalizedProjectTags = useMemo(
    () => formatTagsInput(parseTagsInput(projectDraft.tagsInput)) || '未设置标签',
    [projectDraft.tagsInput]
  );
  const overviewMetrics = useMemo(() => ([
    {
      label: '脚本行数',
      value: `${populatedCodeLines}`,
      caption: '按非空行统计，便于快速感知当前脚本规模。',
    },
    {
      label: '画布类型',
      value: selectedCanvasMode.label,
      caption: selectedCanvasMode.description,
    },
    {
      label: '最近运行',
      value: formatDuration(executionStats?.executionTime),
      caption: executionStats
        ? `${executionStats.successCount} 条成功 / ${executionStats.errorCount} 条失败`
        : '运行后会在这里显示耗时与结果。',
    },
    {
      label: '同步状态',
      value: canvasDrift.isDirty ? `${changedPointCount} 点待同步` : '代码与画布一致',
      caption: isCanvasLocked ? '当前锁定拖拽，避免误改图形。' : '当前允许自由拖拽探索。',
    },
  ]), [
    canvasDrift.isDirty,
    changedPointCount,
    executionStats,
    isCanvasLocked,
    populatedCodeLines,
    selectedCanvasMode.description,
    selectedCanvasMode.label,
  ]);

  const commitProjects = useCallback((nextProjects, nextProjectId) => {
    setSavedProjects(nextProjects);
    setCurrentProjectId(nextProjectId);
    writeStudioState({
      projects: nextProjects,
      currentProjectId: nextProjectId,
    });
  }, []);

  const refreshCanvasObjects = useCallback(() => {
    setAvailableObjectNames(GeoGebraEngine.getAllObjectNames().sort((left, right) => left.localeCompare(right, 'zh-CN')));
  }, []);

  const saveProjectRecord = useCallback(
    ({ versionLabel = null, trigger = 'autosave', markOpened = false } = {}) => {
      const now = new Date().toISOString();
      const existingProject =
        savedProjects.find((project) => project.id === currentProjectId)
        ?? null;
      let nextProject = {
        ...(existingProject
          ?? createProjectRecord({
            id: currentProjectId ?? undefined,
            createdAt: now,
          })),
        title: projectDraft.title.trim() || DEFAULT_PROJECT_TITLE,
        folder: projectDraft.folder.trim() || DEFAULT_PROJECT_FOLDER,
        tags: parseTagsInput(projectDraft.tagsInput),
        isFavorite: projectDraft.isFavorite,
        canvasModeId: selectedCanvasModeId,
        code,
        updatedAt: now,
        lastOpenedAt: markOpened ? now : existingProject?.lastOpenedAt ?? now,
      };

      if (versionLabel) {
        nextProject = attachVersionToProject(
          nextProject,
          createVersionRecord({
            label: versionLabel,
            code,
            canvasModeId: selectedCanvasModeId,
            trigger,
          })
        );
      }

      const nextProjects = upsertProject(savedProjects, nextProject);
      commitProjects(nextProjects, nextProject.id);
      return nextProject;
    },
    [code, commitProjects, currentProjectId, projectDraft, savedProjects, selectedCanvasModeId]
  );

  const clearCanvasDrift = useCallback(() => {
    setCanvasDrift({
      isDirty: false,
      changedObjects: [],
    });
    setSelectedDriftNames([]);
    dirtyWarningLoggedRef.current = false;
    driftBaselineCodeRef.current = null;
  }, []);

  const appendLog = useCallback((message, level = 'info') => {
    setLogs((prev) => [
      ...prev,
      {
        message,
        level,
        timestamp: new Date(),
      },
    ]);
  }, []);

  const resetAuthForm = useCallback(() => {
    setAuthForm({
      account: '',
      email: '',
      username: '',
      displayName: '',
      password: '',
      confirmPassword: '',
    });
  }, []);

  const handleAuthFieldChange = useCallback((field, value) => {
    setAuthForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const applyAuthenticatedSession = useCallback(
    (session, successMessage) => {
      const normalizedSession = {
        token: session.token,
        tokenType: session.tokenType || 'Bearer',
        expiresAt: session.expiresAt || null,
        user: session.user,
      };

      setAuthToken(normalizedSession.token);
      setAuthSession(normalizedSession);
      setAuthState({
        state: 'authenticated',
        message: `${normalizedSession.user.displayName || normalizedSession.user.username} 已登录`,
      });
      writeStoredAuthSession(normalizedSession);
      resetAuthForm();
      appendLog(successMessage, 'success');
    },
    [appendLog, resetAuthForm]
  );

  const clearAuthentication = useCallback(
    (message, level = 'info') => {
      clearAuthToken();
      clearStoredAuthSession();
      setAuthSession(null);
      setAuthState({
        state: 'guest',
        message,
      });

      if (message) {
        appendLog(message, level);
      }
    },
    [appendLog]
  );

  const handleApiAuthFailure = useCallback(
    (error, fallbackMessage = '登录状态已失效，请重新登录') => {
      if (error?.status !== 401) {
        return false;
      }

      clearAuthentication(fallbackMessage, 'error');
      setAuthMode('login');
      return true;
    },
    [clearAuthentication]
  );

  const handleAuthSubmit = useCallback(async () => {
    if (isSubmittingAuth) {
      return;
    }

    if (authMode === 'register') {
      const email = authForm.email.trim();
      const username = authForm.username.trim();
      const password = authForm.password;
      const confirmPassword = authForm.confirmPassword;

      if (!email || !username || !password) {
        alert('请完整填写注册信息');
        return;
      }

      if (password !== confirmPassword) {
        alert('两次输入的密码不一致');
        return;
      }
    } else if (!authForm.account.trim() || !authForm.password) {
      alert('请输入邮箱/用户名和密码');
      return;
    }

    setIsSubmittingAuth(true);

    try {
      if (authMode === 'register') {
        const session = await registerUser({
          email: authForm.email.trim(),
          username: authForm.username.trim(),
          displayName: authForm.displayName.trim(),
          password: authForm.password,
        });

        applyAuthenticatedSession(
          session,
          `注册成功，当前已使用 ${session.user.displayName || session.user.username} 登录`
        );
      } else {
        const session = await loginUser({
          account: authForm.account.trim(),
          password: authForm.password,
        });

        applyAuthenticatedSession(
          session,
          `登录成功，欢迎回来 ${session.user.displayName || session.user.username}`
        );
      }
    } catch (error) {
      setAuthState({
        state: 'error',
        message: error.message,
      });
      appendLog(`认证失败：${error.message}`, 'error');
      alert(error.message);
    } finally {
      setIsSubmittingAuth(false);
    }
  }, [applyAuthenticatedSession, appendLog, authForm, authMode, isSubmittingAuth]);

  const handleLogout = useCallback(async () => {
    if (isSubmittingAuth) {
      return;
    }

    setIsSubmittingAuth(true);

    try {
      await logoutUser();
    } catch (error) {
      appendLog(`退出登录请求失败：${error.message}`, 'error');
    } finally {
      clearAuthentication('已退出登录');
      setAuthMode('login');
      setIsSubmittingAuth(false);
    }
  }, [appendLog, clearAuthentication, isSubmittingAuth]);

  const refreshAdminDashboard = useCallback(async (options = {}) => {
    const { silent = false } = options;

    setAdminState((prev) => ({
      state: prev.state === 'ready' && silent ? prev.state : 'loading',
      message:
        prev.state === 'ready' && silent
          ? prev.message
          : silent
          ? '正在同步最新后台快照'
          : '正在拉取超级后台快照',
      isRefreshing: true,
    }));

    try {
      const snapshot = await fetchAdminDashboard();
      const generatedAt = snapshot?.generatedAt
        ? new Date(snapshot.generatedAt).toLocaleString('zh-CN')
        : '刚刚';

      startTransition(() => {
        setAdminDashboard(snapshot);
        setAdminState({
          state: 'ready',
          message: `最近刷新：${generatedAt}`,
          isRefreshing: false,
        });
      });
    } catch (error) {
      setAdminState({
        state: 'error',
        message: error.message,
        isRefreshing: false,
      });
    }
  }, []);

  const executePreparedCommands = useCallback(
    async (commands, options = {}) => {
      const { nextCodeText = null, logMessage = null, versionLabel = null } = options;

      if (!Array.isArray(commands) || commands.length === 0) {
        throw new Error('No commands available to execute');
      }

      if (!dispatcherRef.current) {
        queuedScriptRef.current = {
          commands,
          nextCodeText,
          logMessage,
        };

        if (nextCodeText !== null) {
          setCode(nextCodeText);
        }

        appendLog(
          logMessage
            ? `${logMessage}，画布就绪后会自动执行`
            : '画布尚未就绪，脚本已加入自动执行队列',
          'info'
        );
        return false;
      }

      if (nextCodeText !== null) {
        setCode(nextCodeText);
      }

      clearCanvasDrift();
      setErrors([]);

      if (logMessage) {
        appendLog(logMessage, 'info');
      }

      setIsExecuting(true);
      startTimeRef.current = Date.now();

      if (isCompactLayout) {
        setActiveTab('canvas');
      }

      await dispatcherRef.current.execute(commands, {
        resetBeforeRun: true,
        verbose: true,
      });

      if (canvasLockRef.current) {
        GeoGebraEngine.setInteractivePointsLocked(true);
      }

      refreshCanvasObjects();

      if (versionLabel) {
        saveProjectRecord({
          versionLabel,
          trigger: 'execution',
        });
      }

      return true;
    },
    [appendLog, clearCanvasDrift, isCompactLayout, refreshCanvasObjects, saveProjectRecord]
  );

  const loadSharedCanvas = useCallback(
    async (slug) => {
      const share = await fetchShare(slug);
      const commands = Array.isArray(share?.commands)
        ? share.commands.filter((command) => typeof command === 'string' && command.trim().length > 0)
        : [];

      if (commands.length === 0) {
        throw new Error('分享内容中没有可执行的 GeoGebra 指令');
      }

      const nextModeId = CANVAS_MODES.some((mode) => mode.id === share.canvasMode)
        ? share.canvasMode
        : DEFAULT_CANVAS_MODE_ID;
      const nextCodeText = normalizeScriptText(commands);
      const shareMessage = `已载入分享：${share.title}`;

      setActiveShareSlug(share.slug);
      setLatestShare({
        shareId: share.shareId,
        slug: share.slug,
        shareUrl: share.shareUrl,
        embedUrl: share.embedUrl,
        posterUrl: share.posterUrl,
        localShareUrl: buildSharePageUrl(share.slug),
      });

      if (nextModeId !== selectedCanvasModeId) {
        queuedScriptRef.current = {
          commands,
          nextCodeText,
          logMessage: shareMessage,
        };
        dispatcherRef.current = null;
        clearCanvasDrift();
        setCode(nextCodeText);
        setErrors([]);
        appendLog(`${shareMessage}，正在切换画布`, 'info');
        setSelectedCanvasModeId(nextModeId);

        if (isCompactLayout) {
          setActiveTab('canvas');
        }

        return share;
      }

      await executePreparedCommands(commands, {
        nextCodeText,
        logMessage: shareMessage,
        versionLabel: '载入分享',
      });

      return share;
    },
    [appendLog, clearCanvasDrift, executePreparedCommands, isCompactLayout, selectedCanvasModeId]
  );

  const handleReferenceFileChange = useCallback((file) => {
    setReferenceFile(file ?? null);
  }, []);

  const handleGenerateFromBackend = useCallback(async () => {
    if (!isAuthenticated) {
      setAuthMode('login');
      alert('请先登录后再调用后端生成能力');
      return;
    }

    const trimmedPrompt = generationPrompt.trim();
    if (!trimmedPrompt) {
      alert('请输入要发送给后端的生成提示词');
      return;
    }

    if (canvasDrift.isDirty) {
      const confirmed = window.confirm(
        '当前画布存在尚未同步回代码的拖拽结果。继续生成会用新的后端结果覆盖当前脚本，是否继续？'
      );

      if (!confirmed) {
        return;
      }
    }

    setIsGeneratingScript(true);
    setLatestShare(null);

    try {
      const uploadTicket = await reserveUpload({
        filename: referenceFile?.name || `scene-${Date.now()}.png`,
        mimeType: referenceFile?.type || 'application/octet-stream',
        size: referenceFile?.size || 0,
        purpose: 'ai_drawing_input',
        canvasMode: selectedCanvasModeId,
      });

      if (referenceFile) {
        await uploadAsset({
          uploadUrl: uploadTicket.uploadUrl,
          file: referenceFile,
          mimeType: referenceFile.type,
        });
      }

      const job = await createDrawingJob({
        assetId: uploadTicket.assetId,
        prompt: trimmedPrompt,
        canvasMode: selectedCanvasModeId,
        responseFormat: 'geogebra_commands_v1',
        locale: 'zh-CN',
      });

      appendLog(`后端任务已创建：${job.jobId}`, 'info');

      const result = await pollDrawingJob(job.jobId);
      const nextCodeText = normalizeScriptText(result.commands);

      setLatestJobResult(result);
      setScriptInsights(null);
      appendLog(`后端生成完成：${result.sceneSummary}`, 'success');

      await executePreparedCommands(result.commands, {
        nextCodeText,
        logMessage: `已载入后端生成结果：${result.sceneSummary}`,
        versionLabel: 'AI 生成脚本',
      });
    } catch (error) {
      handleApiAuthFailure(error);
      setErrors([
        {
          message: error.message,
          timestamp: new Date(),
        },
      ]);
      appendLog(`后端生成失败：${error.message}`, 'error');
      alert(error.message);
    } finally {
      setIsGeneratingScript(false);
    }
  }, [
    appendLog,
    canvasDrift.isDirty,
    executePreparedCommands,
    generationPrompt,
    handleApiAuthFailure,
    isAuthenticated,
    referenceFile,
    selectedCanvasModeId,
  ]);

  const handlePublishShare = useCallback(async () => {
    if (!isAuthenticated) {
      setAuthMode('login');
      alert('请先登录后再发布分享');
      return;
    }

    let commands = [];

    try {
      commands = Preprocessor.clean(code);
    } catch (error) {
      alert(error.message);
      return;
    }

    if (commands.length === 0) {
      alert('当前没有可发布的脚本内容');
      return;
    }

    setIsPublishingShare(true);

    try {
      const imageData = await GeoGebraEngine.exportImage();
      if (!imageData) {
        throw new Error('当前画布无法导出封面图，请先运行脚本后再发布');
      }

      const coverFile = await dataUrlToFile(imageData, `share-${Date.now()}.png`);
      const uploadTicket = await reserveUpload({
        filename: coverFile.name,
        mimeType: coverFile.type,
        size: coverFile.size,
        purpose: 'share_cover',
        canvasMode: selectedCanvasModeId,
      });

      await uploadAsset({
        uploadUrl: uploadTicket.uploadUrl,
        file: coverFile,
        mimeType: coverFile.type,
      });

      const share = await createShare({
        title: buildShareTitle(
          latestJobResult?.sceneSummary || generationPrompt,
          `${selectedCanvasMode.label} share`
        ),
        canvasMode: selectedCanvasModeId,
        commands,
        coverAssetId: uploadTicket.assetId,
        visibility: 'public',
        allowFork: true,
      });

      const localShareUrl = buildSharePageUrl(share.slug);
      setLatestShare({
        ...share,
        localShareUrl,
      });
      setActiveShareSlug(share.slug);
      appendLog(`分享已发布：${localShareUrl}`, 'success');
    } catch (error) {
      handleApiAuthFailure(error);
      appendLog(`分享发布失败：${error.message}`, 'error');
      alert(error.message);
    } finally {
      setIsPublishingShare(false);
    }
  }, [
    appendLog,
    code,
    generationPrompt,
    handleApiAuthFailure,
    isAuthenticated,
    latestJobResult,
    selectedCanvasMode.label,
    selectedCanvasModeId,
  ]);

  const initializeDispatcher = useCallback(() => {
    if (dispatcherRef.current) {
      return;
    }

    const dispatcher = new Dispatcher(GeoGebraEngine);

    dispatcher.setOnProgress((progress) => {
      console.log(`进度: ${progress.percentage}%`);
    });

    dispatcher.setOnError((error) => {
      console.error('执行错误:', error);
    });

    dispatcher.setOnComplete((report) => {
      const executionTime = Date.now() - startTimeRef.current;
      setIsExecuting(false);
      startTransition(() => {
        setLogs(report.logs);
        setErrors(report.errors);
        setExecutionStats({
          ...report,
          executionTime,
        });
      });

      if (canvasLockRef.current) {
        GeoGebraEngine.setInteractivePointsLocked(true);
      }

      refreshCanvasObjects();
    });

    dispatcherRef.current = dispatcher;
  }, [refreshCanvasObjects]);

  const handleGeoGebraReady = useCallback(() => {
    console.log('GeoGebra Applet 已准备就绪');
    initializeDispatcher();

    setLogs((prev) => [
      ...prev,
      {
        message: `${selectedCanvasMode.label}画布已就绪`,
        level: 'info',
        timestamp: new Date(),
      },
    ]);

    if (canvasLockRef.current) {
      GeoGebraEngine.setInteractivePointsLocked(true);
    }
    refreshCanvasObjects();
    if (queuedScriptRef.current) {
      const queuedScript = queuedScriptRef.current;
      queuedScriptRef.current = null;

      void executePreparedCommands(queuedScript.commands, {
        nextCodeText: queuedScript.nextCodeText,
        logMessage: queuedScript.logMessage,
      });
    }
  }, [executePreparedCommands, initializeDispatcher, refreshCanvasObjects, selectedCanvasMode.label]);

  const handleRun = useCallback(async () => {
    if (!dispatcherRef.current) {
      alert('GeoGebra 尚未初始化，请稍候...');
      return;
    }

    if (canvasDrift.isDirty) {
      const confirmed = window.confirm(
        '画布中的自由点被手动拖动过。继续运行会按代码重新绘制并丢失这些调整。是否继续运行？'
      );

      if (!confirmed) {
        return;
      }
    }

    let commands = [];

    try {
      commands = Preprocessor.clean(code);
    } catch (error) {
      setErrors([
        {
          message: error.message,
          timestamp: new Date(),
        },
      ]);
      alert(error.message);
      return;
    }

    if (commands.length === 0) {
      alert('没有有效的指令');
      return;
    }

    const validation = Preprocessor.validate(commands);
    if (!validation.valid) {
      setErrors(
        validation.errors.map((err) => ({
          ...err,
          lineNumber: err.line ?? err.lineNumber,
          timestamp: new Date(),
        }))
      );
      alert(`代码验证失败，有 ${validation.errors.length} 个错误`);
      if (isCompactLayout) {
        setActiveTab('code');
      }
      return;
    }

    await executePreparedCommands(commands, {
      versionLabel: '运行脚本',
    });
  }, [canvasDrift.isDirty, code, executePreparedCommands, isCompactLayout]);

  const handleClear = useCallback(() => {
    GeoGebraEngine.clear();
    clearCanvasDrift();
    resetVersionBrowsing();
    refreshCanvasObjects();
    setLogs((prev) => [
      ...prev,
      {
        message: '画板已清空',
        level: 'info',
        timestamp: new Date(),
      },
    ]);
  }, [clearCanvasDrift, refreshCanvasObjects, resetVersionBrowsing]);

  const handleExport = useCallback(async () => {
    const imageData = await GeoGebraEngine.exportImage();
    if (imageData) {
      const link = document.createElement('a');
      link.href = imageData;
      link.download = `geogebra-${Date.now()}.png`;
      link.click();

      setLogs((prev) => [
        ...prev,
        {
          message: '图片已导出',
          level: 'success',
          timestamp: new Date(),
        },
      ]);
    } else {
      alert('导出失败');
    }
  }, []);

  const handleReset = useCallback(() => {
    GeoGebraEngine.reset();
    clearCanvasDrift();
    resetVersionBrowsing();
    if (selectedCanvasModeId !== DEFAULT_CANVAS_MODE_ID) {
      dispatcherRef.current = null;
    }
    setSelectedCanvasModeId(DEFAULT_CANVAS_MODE_ID);
    setCode(`// GeoGebra 交互式绘图系统\n// 在下方输入 GeoGebra 指令，每行一条\n\n`);
    setLogs([
      {
        message: '系统已重置，等待新的绘图指令。',
        level: 'info',
        timestamp: new Date(),
      },
    ]);
    setErrors([]);
    setExecutionStats(null);
    setLatestJobResult(null);
    setLatestShare(null);
    setActiveShareSlug(null);
    setScriptInsights(null);
    setVersionComparison(null);
    setLectureState({
      commands: [],
      currentStep: 0,
      isPlaying: false,
    });
    refreshCanvasObjects();

    if (isCompactLayout) {
      setActiveTab('code');
    }
  }, [clearCanvasDrift, isCompactLayout, refreshCanvasObjects, resetVersionBrowsing, selectedCanvasModeId]);

  const handleToggleCanvasLock = useCallback(() => {
    setIsCanvasLocked((prev) => !prev);
  }, []);

  const handleCanvasModeChange = useCallback(
    (nextModeId) => {
      if (
        !nextModeId
        || nextModeId === selectedCanvasModeId
        || isExecuting
        || isGeneratingScript
        || isPublishingShare
      ) {
        return;
      }

      if (canvasDrift.isDirty) {
        const confirmed = window.confirm(
          '当前画布有尚未同步回代码的拖拽结果。切换画布类型会重建 GeoGebra 画布并丢失这些临时调整。是否继续？'
        );

        if (!confirmed) {
          return;
        }
      }

      const nextMode = CANVAS_MODES.find((mode) => mode.id === nextModeId);
      if (!nextMode) {
        return;
      }

      clearCanvasDrift();
      resetVersionBrowsing();
      dispatcherRef.current = null;
      setSelectedCanvasModeId(nextModeId);
      setErrors([]);
      setExecutionStats(null);
      setScriptInsights(null);
      setLogs([
        {
          message: `正在切换到${nextMode.label}画布`,
          level: 'info',
          timestamp: new Date(),
        },
      ]);

      if (isCompactLayout) {
        setActiveTab('canvas');
      }
    },
    [
      canvasDrift.isDirty,
      clearCanvasDrift,
      isCompactLayout,
      isExecuting,
      isGeneratingScript,
      isPublishingShare,
      resetVersionBrowsing,
      selectedCanvasModeId,
    ]
  );

  const handleLoadSnippet = useCallback(
    (snippet) => {
      const baseIsDefault = code.trim() === DEFAULT_CODE.trim();
      const hasCustomCode = code.trim().length > 0 && !baseIsDefault;

      if (hasCustomCode) {
        const confirmed = window.confirm('载入示例会替换当前编辑器内容，是否继续？');
        if (!confirmed) {
          return;
        }
      }

      setCode(`${snippet.code.trim()}\n`);
      clearCanvasDrift();
      resetVersionBrowsing();
      setErrors([]);
      setExecutionStats(null);
      setScriptInsights(null);
      setLogs((prev) => [
        ...prev,
        {
          message: `已载入示例：${snippet.title}`,
          level: 'info',
          timestamp: new Date(),
        },
      ]);

      if (isCompactLayout) {
        setActiveTab('code');
      }
    },
    [clearCanvasDrift, code, isCompactLayout, resetVersionBrowsing]
  );

  const resetVersionBrowsing = useCallback(() => {
    versionDraftStateRef.current = null;
    setVersionCursor(-1);
  }, []);

  const loadProjectIntoEditor = useCallback(
    (project) => {
      if (!project) {
        return;
      }

      if (
        code.trim().length > 0
        && project.id !== currentProjectId
        && !window.confirm('切换项目会替换当前编辑器内容，是否继续？')
      ) {
        return;
      }

      resetVersionBrowsing();
      clearCanvasDrift();
      setScriptInsights(null);
      setVersionComparison(null);
      setCurrentProjectId(project.id);
      setProjectDraft({
        title: project.title,
        folder: project.folder,
        tagsInput: formatTagsInput(project.tags),
        isFavorite: Boolean(project.isFavorite),
      });
      setCode(project.code || `${DEFAULT_CODE.trim()}\n`);
      setErrors([]);
      setExecutionStats(null);

      const nextProjects = upsertProject(
        savedProjects.map((item) =>
          item.id === project.id
            ? {
                ...item,
                lastOpenedAt: new Date().toISOString(),
              }
            : item
        ),
        {
          ...project,
          lastOpenedAt: new Date().toISOString(),
        }
      );
      commitProjects(nextProjects, project.id);

      if (project.canvasModeId && project.canvasModeId !== selectedCanvasModeId) {
        dispatcherRef.current = null;
        setSelectedCanvasModeId(project.canvasModeId);
      }

      appendLog(`已打开项目：${project.title}`, 'info');
      if (isCompactLayout) {
        setActiveTab('code');
      }
    },
    [
      appendLog,
      clearCanvasDrift,
      code,
      commitProjects,
      currentProjectId,
      isCompactLayout,
      resetVersionBrowsing,
      savedProjects,
      selectedCanvasModeId,
    ]
  );

  const handleCreateProject = useCallback(() => {
    const project = createProjectRecord({
      title: `${DEFAULT_PROJECT_TITLE} ${savedProjects.length + 1}`,
      folder: DEFAULT_PROJECT_FOLDER,
      tags: ['草稿'],
      canvasModeId: DEFAULT_CANVAS_MODE_ID,
      code: `// 新项目\n// 在这里输入 GeoGebra 指令\n`,
    });

    commitProjects(upsertProject(savedProjects, project), project.id);
    resetVersionBrowsing();
    clearCanvasDrift();
    setProjectDraft({
      title: project.title,
      folder: project.folder,
      tagsInput: formatTagsInput(project.tags),
      isFavorite: false,
    });
    setCode(project.code);
    setSelectedCanvasModeId(DEFAULT_CANVAS_MODE_ID);
    setScriptInsights(null);
    setVersionComparison(null);
    appendLog(`已创建项目：${project.title}`, 'success');

    if (isCompactLayout) {
      setActiveTab('code');
    }
  }, [appendLog, clearCanvasDrift, commitProjects, isCompactLayout, resetVersionBrowsing, savedProjects]);

  const handleSaveProject = useCallback(() => {
    const project = saveProjectRecord({
      versionLabel: '手动保存',
      trigger: 'manual',
      markOpened: true,
    });
    resetVersionBrowsing();
    appendLog(`项目已保存：${project.title}`, 'success');
  }, [appendLog, resetVersionBrowsing, saveProjectRecord]);

  const handleSaveSnapshot = useCallback(() => {
    const project = saveProjectRecord({
      versionLabel: '手动快照',
      trigger: 'snapshot',
    });
    resetVersionBrowsing();
    appendLog(`已为 ${project.title} 创建快照`, 'info');
  }, [appendLog, resetVersionBrowsing, saveProjectRecord]);

  const applyVersionState = useCallback(
    (version, cursor) => {
      if (!version) {
        return;
      }

      clearCanvasDrift();
      setCode(version.code);
      setVersionCursor(cursor);
      setVersionComparison({
        version,
        summary: summarizeCodeDiff(version.code, code),
      });
      setScriptInsights(null);

      if (version.canvasModeId && version.canvasModeId !== selectedCanvasModeId) {
        dispatcherRef.current = null;
        setSelectedCanvasModeId(version.canvasModeId);
      }

      if (isCompactLayout) {
        setActiveTab('code');
      }
    },
    [clearCanvasDrift, code, isCompactLayout, selectedCanvasModeId]
  );

  const handleCompareVersion = useCallback(
    (version) => {
      if (!version) {
        return;
      }

      setVersionComparison({
        version,
        summary: summarizeCodeDiff(version.code, code),
      });
    },
    [code]
  );

  const handleRollbackToVersion = useCallback(
    (version, cursor) => {
      if (!version) {
        return;
      }

      if (!window.confirm(`回滚到版本「${version.label}」后，当前未保存编辑会被覆盖。是否继续？`)) {
        return;
      }

      if (versionDraftStateRef.current === null) {
        versionDraftStateRef.current = {
          code,
          canvasModeId: selectedCanvasModeId,
        };
      }

      applyVersionState(version, cursor);
      appendLog(`已回滚到版本：${version.label}`, 'warning');
    },
    [appendLog, applyVersionState, code, selectedCanvasModeId]
  );

  const handleUndoVersion = useCallback(() => {
    const versions = currentProject?.versions ?? [];
    if (versions.length === 0) {
      return;
    }

    const nextCursor = Math.min(versionCursor + 1, versions.length - 1);
    if (nextCursor === versionCursor) {
      return;
    }

    if (versionDraftStateRef.current === null) {
      versionDraftStateRef.current = {
        code,
        canvasModeId: selectedCanvasModeId,
      };
    }

    applyVersionState(versions[nextCursor], nextCursor);
    appendLog(`版本撤销到：${versions[nextCursor].label}`, 'info');
  }, [appendLog, applyVersionState, code, currentProject?.versions, selectedCanvasModeId, versionCursor]);

  const handleRedoVersion = useCallback(() => {
    const versions = currentProject?.versions ?? [];

    if (versionCursor === -1) {
      return;
    }

    if (versionCursor === 0 && versionDraftStateRef.current) {
      const draftState = versionDraftStateRef.current;
      versionDraftStateRef.current = null;
      clearCanvasDrift();
      setCode(draftState.code);
      setVersionCursor(-1);
      setVersionComparison(null);

      if (draftState.canvasModeId !== selectedCanvasModeId) {
        dispatcherRef.current = null;
        setSelectedCanvasModeId(draftState.canvasModeId);
      }

      appendLog('已恢复到当前编辑版本', 'info');
      return;
    }

    const nextCursor = Math.max(versionCursor - 1, 0);
    if (!versions[nextCursor]) {
      return;
    }

    applyVersionState(versions[nextCursor], nextCursor);
    appendLog(`版本前进到：${versions[nextCursor].label}`, 'info');
  }, [
    appendLog,
    applyVersionState,
    clearCanvasDrift,
    currentProject?.versions,
    selectedCanvasModeId,
    versionCursor,
  ]);

  const handleParameterValueChange = useCallback((name, nextValue) => {
    setParameterValues((prev) => ({
      ...prev,
      [name]: nextValue,
    }));
  }, []);

  const handleApplyParameters = useCallback(
    async (shouldRun = false) => {
      if (parameterControls.length === 0) {
        alert('当前脚本中没有可控制的简单参数。');
        return;
      }

      let nextCode = code;
      parameterControls.forEach((control) => {
        nextCode = replaceAssignmentValue(nextCode, control.name, parameterValues[control.name]);
      });

      setCode(nextCode);
      appendLog('参数面板已更新脚本中的变量值', 'success');

      if (!shouldRun) {
        return;
      }

      const commands = Preprocessor.clean(nextCode);
      await executePreparedCommands(commands, {
        nextCodeText: nextCode,
        logMessage: '参数变更已重新渲染',
        versionLabel: '参数调参',
      });
    },
    [appendLog, code, executePreparedCommands, parameterControls, parameterValues]
  );

  const handleToggleDriftName = useCallback((name) => {
    setSelectedDriftNames((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]
    );
  }, []);

  const handleSyncSelectedCanvasState = useCallback(() => {
    const pointStates = GeoGebraEngine.exportFreePointsAsCode(selectedDriftNames);

    if (pointStates.length === 0) {
      alert('请先选择需要同步回代码的自由点。');
      return;
    }

    if (
      driftHasConflict
      && !window.confirm('在拖拽期间你已经修改过脚本。继续同步会以画布坐标覆盖对应变量，是否继续？')
    ) {
      return;
    }

    const nextCode = mergeCanvasStateIntoCode(code, pointStates);
    setCode(nextCode);
    clearCanvasDrift();
    resetVersionBrowsing();
    saveProjectRecord({
      versionLabel: '同步自由点',
      trigger: 'canvas_sync',
    });
    setActiveTab('code');
    appendLog(
      `已同步自由点：${pointStates.map((state) => state.name).join(', ')}`,
      'success'
    );
  }, [
    clearCanvasDrift,
    code,
    driftHasConflict,
    resetVersionBrowsing,
    saveProjectRecord,
    selectedDriftNames,
    appendLog,
  ]);

  const handleDiscardCanvasDrift = useCallback(() => {
    clearCanvasDrift();
    appendLog('已忽略本次拖拽结果，保留当前脚本内容', 'info');
  }, [appendLog, clearCanvasDrift]);

  const handleToggleStyleObjectName = useCallback((objectName) => {
    setSelectedStyleNames((prev) =>
      prev.includes(objectName)
        ? prev.filter((item) => item !== objectName)
        : [...prev, objectName]
    );
  }, []);

  const handleApplyStyles = useCallback(() => {
    const result = GeoGebraEngine.applyObjectStyles({
      objectNames: selectedStyleScopeNames,
      color: styleDraft.color,
      lineThickness: styleDraft.lineThickness,
      pointSize: styleDraft.pointSize,
      labelVisible: styleDraft.labelVisible,
    });

    GeoGebraEngine.setGridVisible(styleDraft.showGrid);
    GeoGebraEngine.setAxesVisible(styleDraft.showAxes);
    appendLog(
      `样式已应用到 ${result.updatedCount}/${result.attemptedCount} 个对象`,
      result.updatedCount > 0 ? 'success' : 'warning'
    );
  }, [appendLog, selectedStyleScopeNames, styleDraft]);

  const runLectureStep = useCallback(
    async (commands, nextStep) => {
      if (nextStep <= 0) {
        GeoGebraEngine.clear();
        clearCanvasDrift();
        setLectureState((prev) => ({
          ...prev,
          currentStep: 0,
        }));
        return;
      }

      await executePreparedCommands(commands.slice(0, nextStep), {
        logMessage: `讲解模式：第 ${nextStep}/${commands.length} 步`,
      });

      setLectureState((prev) => ({
        ...prev,
        currentStep: nextStep,
      }));
    },
    [clearCanvasDrift, executePreparedCommands]
  );

  const handlePrepareLecture = useCallback(() => {
    let commands = [];

    try {
      commands = Preprocessor.clean(code);
    } catch (error) {
      alert(error.message);
      return;
    }

    if (commands.length === 0) {
      alert('当前脚本没有可讲解的命令。');
      return;
    }

    lecturePlayTokenRef.current++;
    setLectureState({
      commands,
      currentStep: 0,
      isPlaying: false,
    });
    appendLog(`讲解模式已准备，共 ${commands.length} 步`, 'info');
  }, [appendLog, code]);

  const handlePreviousLectureStep = useCallback(async () => {
    if (lectureState.commands.length === 0) {
      return;
    }

    const nextStep = Math.max(lectureState.currentStep - 1, 0);
    await runLectureStep(lectureState.commands, nextStep);
  }, [lectureState.commands, lectureState.currentStep, runLectureStep]);

  const handleNextLectureStep = useCallback(async () => {
    if (lectureState.commands.length === 0) {
      handlePrepareLecture();
      return;
    }

    const nextStep = Math.min(lectureState.currentStep + 1, lectureState.commands.length);
    await runLectureStep(lectureState.commands, nextStep);
  }, [handlePrepareLecture, lectureState.commands, lectureState.currentStep, runLectureStep]);

  const handleAutoPlayLecture = useCallback(async () => {
    let commands = lectureState.commands;
    let startStep = lectureState.currentStep;

    if (commands.length === 0) {
      try {
        commands = Preprocessor.clean(code);
      } catch (error) {
        alert(error.message);
        return;
      }

      if (commands.length === 0) {
        alert('当前脚本没有可讲解的命令。');
        return;
      }

      startStep = 0;
      setLectureState({
        commands,
        currentStep: 0,
        isPlaying: true,
      });
    } else {
      setLectureState((prev) => ({
        ...prev,
        isPlaying: true,
      }));
    }

    const playToken = Date.now();
    lecturePlayTokenRef.current = playToken;

    for (let step = startStep + 1; step <= commands.length; step++) {
      if (lecturePlayTokenRef.current !== playToken) {
        break;
      }

      await runLectureStep(commands, step);
      await new Promise((resolve) => {
        window.setTimeout(resolve, 900);
      });
    }

    setLectureState((prev) => ({
      ...prev,
      isPlaying: false,
    }));
  }, [code, lectureState.commands, lectureState.currentStep, runLectureStep]);

  const handleStopLecture = useCallback(() => {
    lecturePlayTokenRef.current++;
    setLectureState((prev) => ({
      ...prev,
      isPlaying: false,
    }));
  }, []);

  const handleTogglePresentationMode = useCallback(async () => {
    const nextValue = !presentationMode;
    setPresentationMode(nextValue);

    try {
      if (nextValue && workspaceShellRef.current?.requestFullscreen) {
        await workspaceShellRef.current.requestFullscreen();
      }

      if (!nextValue && document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (_error) {
      // Fullscreen API 不可用时，仍保留页面级演示模式
    }
  }, [presentationMode]);

  const handleGenerateInsights = useCallback(async () => {
    let commands = [];

    try {
      commands = Preprocessor.clean(code);
    } catch (error) {
      alert(error.message);
      return;
    }

    if (commands.length === 0) {
      alert('当前脚本为空，无法生成解读。');
      return;
    }

    setIsGeneratingInsights(true);

    try {
      const result = await createScriptInsights({
        prompt: generationPrompt,
        commands,
        locale: 'zh-CN',
      });
      setScriptInsights(result);
      appendLog('已生成图形解释与标注建议', 'success');
    } catch (error) {
      appendLog(`图形解释生成失败：${error.message}`, 'error');
      alert(error.message);
    } finally {
      setIsGeneratingInsights(false);
    }
  }, [appendLog, code, generationPrompt]);

  const handleAppendInsightComments = useCallback(() => {
    if (!scriptInsights) {
      return;
    }

    setCode((prev) => appendInsightCommentsToCode(prev, scriptInsights));
    appendLog('已将图形解释写入脚本注释', 'success');
  }, [appendLog, scriptInsights]);

  const handleExportScriptFile = useCallback(() => {
    downloadTextFile(
      `${(projectDraft.title.trim() || DEFAULT_PROJECT_TITLE).replace(/\s+/g, '-')}.ggs.txt`,
      code
    );
    appendLog('脚本已导出为文本文件', 'success');
  }, [appendLog, code, projectDraft.title]);

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    isExecutingRef.current = isExecuting;
  }, [isExecuting]);

  useEffect(() => {
    if (hasInitializedWorkspaceRef.current || initialShareSlugRef.current) {
      return;
    }

    hasInitializedWorkspaceRef.current = true;

    const initialProject =
      storedStudioState.projects.find((project) => project.id === storedStudioState.currentProjectId)
      ?? storedStudioState.projects[0]
      ?? null;

    if (initialProject) {
      setCurrentProjectId(initialProject.id);
      setProjectDraft({
        title: initialProject.title,
        folder: initialProject.folder,
        tagsInput: formatTagsInput(initialProject.tags),
        isFavorite: Boolean(initialProject.isFavorite),
      });
      setCode(initialProject.code || DEFAULT_CODE);

      if (initialProject.canvasModeId && initialProject.canvasModeId !== selectedCanvasModeId) {
        dispatcherRef.current = null;
        setSelectedCanvasModeId(initialProject.canvasModeId);
      }

      return;
    }

    const project = createProjectRecord({
      title: DEFAULT_PROJECT_TITLE,
      folder: DEFAULT_PROJECT_FOLDER,
      tags: ['示例'],
      canvasModeId: selectedCanvasModeId,
      code,
    });

    commitProjects(upsertProject([], project), project.id);
    setProjectDraft({
      title: project.title,
      folder: project.folder,
      tagsInput: formatTagsInput(project.tags),
      isFavorite: false,
    });
  }, [code, commitProjects, selectedCanvasModeId, storedStudioState.projects, storedStudioState.currentProjectId]);

  useEffect(() => {
    if (!hasInitializedWorkspaceRef.current) {
      return undefined;
    }

    if (versionCursor >= 0) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      saveProjectRecord();
    }, 800);

    return () => window.clearTimeout(timer);
  }, [
    code,
    projectDraft.folder,
    projectDraft.isFavorite,
    projectDraft.tagsInput,
    projectDraft.title,
    saveProjectRecord,
    selectedCanvasModeId,
    versionCursor,
  ]);

  useEffect(() => {
    setParameterValues((prev) => {
      const nextValues = {};

      parameterControls.forEach((control) => {
        nextValues[control.name] = Object.prototype.hasOwnProperty.call(prev, control.name)
          ? prev[control.name]
          : control.value;
      });

      return nextValues;
    });
  }, [parameterControls]);

  useEffect(() => {
    setSelectedDriftNames((prev) => {
      const nextNames = pointDiffs
        .filter((item) => item.hasChanged)
        .map((item) => item.name);

      if (nextNames.length === 0) {
        return [];
      }

      const preserved = prev.filter((name) => nextNames.includes(name));
      return preserved.length > 0 ? preserved : nextNames;
    });
  }, [pointDiffs]);

  useEffect(() => {
    let isCancelled = false;

    const syncBackendStatus = async () => {
      try {
        const [health, modelConfig] = await Promise.all([fetchHealth(), fetchModelConfig()]);
        if (isCancelled) {
          return;
        }

        setBackendStatus({
          state: 'connected',
          message: health?.status === 'ok' ? '后端服务可用' : '后端已响应',
          modelName: modelConfig?.modelName || '',
          providerBaseUrl: modelConfig?.baseUrl || '',
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setBackendStatus({
          state: 'error',
          message: error.message,
          modelName: '',
          providerBaseUrl: '',
        });
      }
    };

    void syncBackendStatus();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    if (!storedAuthSession?.token) {
      clearAuthToken();
      return () => {
        isCancelled = true;
      };
    }

    setAuthToken(storedAuthSession.token);

    const restoreAuthSession = async () => {
      try {
        const currentSession = await fetchCurrentUser();
        if (isCancelled) {
          return;
        }

        const nextSession = {
          token: storedAuthSession.token,
          tokenType: storedAuthSession.tokenType || 'Bearer',
          expiresAt: currentSession.expiresAt || storedAuthSession.expiresAt || null,
          user: currentSession.user || storedAuthSession.user,
        };

        setAuthSession(nextSession);
        setAuthState({
          state: 'authenticated',
          message: `${nextSession.user?.displayName || nextSession.user?.username || '当前用户'} 已登录`,
        });
        writeStoredAuthSession(nextSession);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        clearAuthToken();
        clearStoredAuthSession();
        setAuthSession(null);
        setAuthState({
          state: 'guest',
          message:
            error?.status === 401
              ? '登录会话已失效，请重新登录'
              : `会话恢复失败：${error.message}`,
        });
      }
    };

    void restoreAuthSession();

    return () => {
      isCancelled = true;
    };
  }, [storedAuthSession]);

  useEffect(() => {
    void refreshAdminDashboard();
  }, [refreshAdminDashboard]);

  useEffect(() => {
    if (!isAdminAutoRefresh) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void refreshAdminDashboard({ silent: true });
    }, 8000);

    return () => window.clearInterval(timer);
  }, [isAdminAutoRefresh, refreshAdminDashboard]);

  useEffect(() => {
    if (!initialShareSlugRef.current || hasLoadedInitialShareRef.current) {
      return;
    }

    hasLoadedInitialShareRef.current = true;

    void loadSharedCanvas(initialShareSlugRef.current).catch((error) => {
      setErrors([
        {
          message: error.message,
          timestamp: new Date(),
        },
      ]);
      appendLog(`分享加载失败：${error.message}`, 'error');
    });
  }, [appendLog, loadSharedCanvas]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setPresentationMode(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const link = openSourceLinkRef.current;
    if (!link) {
      return undefined;
    }

    const repairLink = () => {
      if (link.getAttribute('href') !== OPEN_SOURCE_REPOSITORY_URL) {
        link.setAttribute('href', OPEN_SOURCE_REPOSITORY_URL);
      }

      if (link.getAttribute('rel') !== OPEN_SOURCE_LINK_REL) {
        link.setAttribute('rel', OPEN_SOURCE_LINK_REL);
      }

      if (link.getAttribute('target') !== '_blank') {
        link.setAttribute('target', '_blank');
      }

      if (link.getAttribute('referrerpolicy') !== 'no-referrer') {
        link.setAttribute('referrerpolicy', 'no-referrer');
      }

      if (link.getAttribute('title') !== OPEN_SOURCE_REPOSITORY_URL) {
        link.setAttribute('title', OPEN_SOURCE_REPOSITORY_URL);
      }

      if (link.getAttribute('data-source-signature') !== OPEN_SOURCE_LINK_SIGNATURE) {
        link.setAttribute('data-source-signature', OPEN_SOURCE_LINK_SIGNATURE);
      }

      const labelNode = link.querySelector('[data-open-source-label]');
      if (labelNode && labelNode.textContent !== OPEN_SOURCE_LINK_LABEL) {
        labelNode.textContent = OPEN_SOURCE_LINK_LABEL;
      }

      const pathNode = link.querySelector('[data-open-source-path]');
      if (pathNode && pathNode.textContent !== OPEN_SOURCE_REPOSITORY_PATH) {
        pathNode.textContent = OPEN_SOURCE_REPOSITORY_PATH;
      }
    };

    repairLink();

    // Keep the visible GitHub origin pinned even if a runtime DOM mutation tries to rewrite it.
    const observer = new MutationObserver(repairLink);
    observer.observe(link, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    canvasLockRef.current = isCanvasLocked;
    GeoGebraEngine.setInteractivePointsLocked(isCanvasLocked);
  }, [isCanvasLocked]);

  useEffect(() => {
    const unsubscribe = GeoGebraEngine.onManualChange(({ labels }) => {
      if (isExecutingRef.current) {
        return;
      }

      const changedPointNames = GeoGebraEngine.exportFreePointsAsCode(labels).map((state) => state.name);

      if (changedPointNames.length === 0) {
        return;
      }

      if (driftBaselineCodeRef.current === null) {
        driftBaselineCodeRef.current = code;
      }

      setCanvasDrift((prev) => ({
        isDirty: true,
        changedObjects: Array.from(new Set([...prev.changedObjects, ...changedPointNames])),
      }));
      refreshCanvasObjects();

      if (!dirtyWarningLoggedRef.current) {
        dirtyWarningLoggedRef.current = true;
        setLogs((prev) => [
          ...prev,
          {
            message: '画布状态已改变，当前代码与图形可能不一致。',
            level: 'warning',
            timestamp: new Date(),
          },
        ]);
      }
    });

    return unsubscribe;
  }, [code, refreshCanvasObjects]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleRun();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRun]);

    return (    
    <div className="app-shell">
      <div className="app-container">
        <div className="global-nav">
          <div className="global-nav-brand">
            <span className="global-nav-mark">
              <AppIcon className="global-nav-mark-image" decorative />
            </span>
            <div className="global-nav-copy">
              <strong>GeoGebra Script Lab</strong>
              <span>React · Monaco Editor · GeoGebra Web API</span>
            </div>
          </div>

          <div className="global-nav-actions">
            <a
              ref={openSourceLinkRef}
              className="open-source-pill"
              href={OPEN_SOURCE_REPOSITORY_URL}
              target="_blank"
              rel="external noopener noreferrer"
              referrerPolicy="no-referrer"
              title={OPEN_SOURCE_REPOSITORY_URL}
              aria-label={OPEN_SOURCE_LINK_ARIA_LABEL}
              data-source-signature={OPEN_SOURCE_LINK_SIGNATURE}
            >
              <span className="open-source-pill-label" data-open-source-label>
                {OPEN_SOURCE_LINK_LABEL}
              </span>
              <strong className="open-source-pill-path" data-open-source-path>
                {OPEN_SOURCE_REPOSITORY_PATH}
              </strong>
            </a>

            <div className="global-nav-meta">
              <span className="nav-pill">{selectedCanvasMode.label}</span>
              <span className={`nav-pill nav-pill-${authTone}`}>{authStatusText}</span>
              <span className={`nav-pill nav-pill-${backendTone}`}>{backendStatusText}</span>
              <span className={`nav-pill nav-pill-${syncTone}`}>{syncStatusText}</span>
              <span className={`nav-pill nav-pill-${recentRunTone}`}>{recentRunStatus}</span>
            </div>
          </div>
        </div>

        <AuthPanel
          authState={authState}
          authMode={authMode}
          authForm={authForm}
          isSubmitting={isSubmittingAuth}
          currentUser={currentUser}
          sessionExpiresAt={authSession?.expiresAt ?? null}
          isAuthenticated={isAuthenticated}
          onModeChange={setAuthMode}
          onFieldChange={handleAuthFieldChange}
          onSubmit={handleAuthSubmit}
          onLogout={handleLogout}
        />

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
                  onClick={() => handleLoadSnippet(STARTER_SNIPPETS[0])}
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
                  <span className={`status-chip status-chip-${syncTone}`}>
                    {canvasDrift.isDirty ? '待同步' : isCanvasLocked ? '拖拽锁定' : '可拖拽'}
                  </span>
                </div>
              </article>

              <article className="hero-status-card hero-checklist-card">
                <span className="card-kicker">推荐工作流</span>
                <ul className="workflow-list">
                  {WORKFLOW_STEPS.map((step) => (
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
            {STARTER_SNIPPETS.map((snippet) => (
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
                真正能带来收入的不是单纯多几个按钮，而是把“上传图片
                → AI 生成命令 → 前端渲染 → 分享传播”这条链路打成一个可复用工作流。
              </p>
            </div>

            <article className="strategy-note-card">
              <span className="card-kicker">优先原则</span>
              <strong>先做高频出图，再做传播，再做团队资产化</strong>
              <p>
                如果一开始就堆协作、评论、组织架构，用户不会马上付费。先把 AI
                生图到脚本这件事做到稳定，才有商业价值。
              </p>
            </article>
          </div>

          <div className="strategy-grid">
            {COMMERCIALIZATION_PRIORITIES.map((item) => (
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
              {COMMERCIALIZATION_FLOW.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </article>
        </section>

        <main
          ref={workspaceShellRef}
          className={`workspace-shell ${presentationMode ? 'presentation-mode' : ''}`}
        >
          {!presentationMode && (
            <div className="workspace-head">
              <div>
                <span className="section-kicker">Studio Workspace</span>
                <h2>项目空间、参数调参与讲解演示</h2>
                <p>
                  这一层把编辑器从单次运行工具升级成持续生产工作台。你可以自动保存项目、管理版本、
                  选中拖拽回写、生成图形解释，并切到讲解或演示模式。
                </p>
              </div>

              <div className="workspace-head-note">
                <span className="workspace-head-label">当前项目</span>
                <strong>{projectDraft.title.trim() || DEFAULT_PROJECT_TITLE}</strong>
                <span>{projectDraft.folder.trim() || DEFAULT_PROJECT_FOLDER}</span>
                <code>{normalizedProjectTags}</code>
              </div>
            </div>
          )}

          {presentationMode && (
            <div className="presentation-bar">
              <span>演示模式已开启，仅保留交互画布</span>
              <div className="presentation-bar-actions">
                <button type="button" className="banner-btn banner-btn-primary" onClick={handleRun}>
                  重新运行
                </button>
                <button type="button" className="banner-btn banner-btn-secondary" onClick={handleExport}>
                  导出 PNG
                </button>
                <button
                  type="button"
                  className="banner-btn banner-btn-secondary active"
                  onClick={handleTogglePresentationMode}
                >
                  退出演示
                </button>
              </div>
            </div>
          )}

          {!presentationMode && isCompactLayout && (
            <div className="mobile-tabs" role="tablist" aria-label="移动端视图切换">
              <button
                type="button"
                className={`tab-button ${activeTab === 'code' ? 'active' : ''}`}
                onClick={() => setActiveTab('code')}
              >
                代码
              </button>
              <button
                type="button"
                className={`tab-button ${activeTab === 'canvas' ? 'active' : ''}`}
                onClick={() => setActiveTab('canvas')}
              >
                画布
              </button>
            </div>
          )}

          {!presentationMode && isPhoneLayout && (
            <div className="mobile-readonly-note">
              手机端优先查看图形。需要拖拽点位时可以先解锁画布，完成后再同步回代码。
            </div>
          )}


          <div className={`workspace ${isCompactLayout ? 'mobile-mode' : ''} ${presentationMode ? 'presentation-active' : ''}`}>
            {!presentationMode && (
              <section className={`editor-section ${!isCompactLayout || activeTab === 'code' ? 'active' : ''}`}>
                <div className="section-heading">
                  <div>
                    <span className="section-kicker">Script Editor</span>
                    <h2>代码编辑台</h2>
                    <p>支持 UTF-8 中文注释、专用高亮主题与 Ctrl+Enter 快速运行。</p>
                  </div>
                  <div className="section-meta">
                    <span className="meta-pill">{populatedCodeLines} 行内容</span>
                    <span className="meta-pill meta-pill-accent">{successRate} 成功率</span>
                  </div>
                </div>

                <div className="studio-grid">
                  <article className="studio-card">
                    <div className="studio-card-head">
                      <div>
                        <span className="card-kicker">Project Space</span>
                        <strong>项目空间</strong>
                      </div>
                      <span className="meta-pill meta-pill-neutral">
                        {currentProject ? `已保存 ${savedProjects.length} 个项目` : '等待初始化'}
                      </span>
                    </div>

                    <div className="studio-field-grid">
                      <label className="studio-field">
                        <span>项目名称</span>
                        <input
                          type="text"
                          value={projectDraft.title}
                          onChange={(event) =>
                            setProjectDraft((prev) => ({
                              ...prev,
                              title: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="studio-field">
                        <span>文件夹</span>
                        <input
                          type="text"
                          value={projectDraft.folder}
                          onChange={(event) =>
                            setProjectDraft((prev) => ({
                              ...prev,
                              folder: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>

                    <label className="studio-field">
                      <span>标签</span>
                      <input
                        type="text"
                        value={projectDraft.tagsInput}
                        onChange={(event) =>
                          setProjectDraft((prev) => ({
                            ...prev,
                            tagsInput: event.target.value,
                          }))
                        }
                        placeholder="例如：几何, 课堂, 动态"
                      />
                    </label>

                    <label className="studio-check">
                      <input
                        type="checkbox"
                        checked={projectDraft.isFavorite}
                        onChange={(event) =>
                          setProjectDraft((prev) => ({
                            ...prev,
                            isFavorite: event.target.checked,
                          }))
                        }
                      />
                      <span>加入收藏并优先显示</span>
                    </label>

                    <div className="studio-action-row">
                      <button type="button" className="studio-btn studio-btn-primary" onClick={handleCreateProject}>
                        新项目
                      </button>
                      <button type="button" className="studio-btn" onClick={handleSaveProject}>
                        保存项目
                      </button>
                      <button type="button" className="studio-btn" onClick={handleSaveSnapshot}>
                        保存快照
                      </button>
                      <button type="button" className="studio-btn" onClick={handleExportScriptFile}>
                        导出脚本
                      </button>
                    </div>

                    <div className="studio-list">
                      {recentProjects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          className={`studio-list-item ${project.id === currentProjectId ? 'active' : ''}`}
                          onClick={() => loadProjectIntoEditor(project)}
                        >
                          <strong>{project.title}</strong>
                          <span>{project.folder}</span>
                          <small>{formatTagsInput(project.tags) || '未设置标签'}</small>
                        </button>
                      ))}
                    </div>
                  </article>

                  <article className="studio-card">
                    <div className="studio-card-head">
                      <div>
                        <span className="card-kicker">Version History</span>
                        <strong>历史版本</strong>
                      </div>
                      <span className="meta-pill meta-pill-neutral">
                        {currentProject?.versions?.length ?? 0} 个快照
                      </span>
                    </div>

                    <div className="studio-action-row">
                      <button
                        type="button"
                        className="studio-btn"
                        onClick={handleUndoVersion}
                        disabled={!currentProject?.versions?.length}
                      >
                        撤销快照
                      </button>
                      <button
                        type="button"
                        className="studio-btn"
                        onClick={handleRedoVersion}
                        disabled={versionCursor === -1}
                      >
                        重做快照
                      </button>
                    </div>

                    <div className="version-list">
                      {(currentProject?.versions ?? []).slice(0, 6).map((version, index) => (
                        <article
                          key={version.id}
                          className={`version-item ${index === versionCursor ? 'active' : ''}`}
                        >
                          <div className="version-item-copy">
                            <strong>{version.label}</strong>
                            <span>{new Date(version.createdAt).toLocaleString('zh-CN')}</span>
                          </div>
                          <div className="version-item-actions">
                            <button type="button" className="studio-inline-btn" onClick={() => handleCompareVersion(version)}>
                              对比
                            </button>
                            <button
                              type="button"
                              className="studio-inline-btn"
                              onClick={() => handleRollbackToVersion(version, index)}
                            >
                              回滚
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>

                    {versionComparison && (
                      <div className="version-compare">
                        <strong>{versionComparison.version.label} 与当前脚本差异</strong>
                        <p>
                          修改 {versionComparison.summary.changedLines} 行，新增 {versionComparison.summary.addedLines} 行，
                          删除 {versionComparison.summary.removedLines} 行。
                        </p>
                        <div className="diff-sample-list">
                          {versionComparison.summary.changedSamples.map((sample) => (
                            <div key={`${sample.lineNumber}-${sample.before}-${sample.after}`} className="diff-sample-item">
                              <span>第 {sample.lineNumber} 行</span>
                              <code>{sample.before ?? '∅'} → {sample.after ?? '∅'}</code>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                </div>

              <BackendPanel
                backendStatus={backendStatus}
                prompt={generationPrompt}
                onPromptChange={setGenerationPrompt}
                selectedFile={referenceFile}
                onFileChange={handleReferenceFileChange}
                onGenerate={handleGenerateFromBackend}
                onPublish={handlePublishShare}
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

                <CodeEditor
                  value={code}
                  onChange={setCode}
                  width="100%"
                  height={editorHeight}
                  language="geogebra"
                  theme="geogebra-workbench"
                />

                <div className="studio-grid studio-grid-secondary">
                  <article className="studio-card">
                    <div className="studio-card-head">
                      <div>
                        <span className="card-kicker">Parameter Panel</span>
                        <strong>参数面板</strong>
                      </div>
                    </div>

                    {parameterControls.length === 0 ? (
                      <p className="studio-empty">
                        当前脚本中还没有可直接映射成滑块、开关或输入框的简单变量。
                      </p>
                    ) : (
                      <div className="parameter-list">
                        {parameterControls.map((control) => (
                          <div key={control.id} className="parameter-item">
                            <div className="parameter-head">
                              <strong>{control.name}</strong>
                              <span>第 {control.lineNumber} 行</span>
                            </div>

                            {control.type === 'number' && (
                              <div className="parameter-input-row">
                                <input
                                  type="range"
                                  min={control.min}
                                  max={control.max}
                                  step={control.step}
                                  value={Number(parameterValues[control.name] ?? control.value)}
                                  onChange={(event) =>
                                    handleParameterValueChange(control.name, Number.parseFloat(event.target.value))
                                  }
                                />
                                <input
                                  type="number"
                                  value={Number(parameterValues[control.name] ?? control.value)}
                                  onChange={(event) =>
                                    handleParameterValueChange(control.name, Number.parseFloat(event.target.value))
                                  }
                                />
                              </div>
                            )}

                            {control.type === 'boolean' && (
                              <label className="studio-check">
                                <input
                                  type="checkbox"
                                  checked={Boolean(parameterValues[control.name] ?? control.value)}
                                  onChange={(event) =>
                                    handleParameterValueChange(control.name, event.target.checked)
                                  }
                                />
                                <span>启用 {control.name}</span>
                              </label>
                            )}

                            {control.type === 'string' && (
                              <input
                                type="text"
                                className="studio-input"
                                value={`${parameterValues[control.name] ?? control.value}`}
                                onChange={(event) =>
                                  handleParameterValueChange(control.name, event.target.value)
                                }
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="studio-action-row">
                      <button type="button" className="studio-btn" onClick={() => handleApplyParameters(false)}>
                        应用参数
                      </button>
                      <button type="button" className="studio-btn studio-btn-primary" onClick={() => handleApplyParameters(true)}>
                        应用并运行
                      </button>
                    </div>
                  </article>

                  <article className="studio-card">
                    <div className="studio-card-head">
                      <div>
                        <span className="card-kicker">Insights</span>
                        <strong>智能标注与图形解释</strong>
                      </div>
                    </div>

                    <div className="studio-action-row">
                      <button
                        type="button"
                        className="studio-btn studio-btn-primary"
                        onClick={handleGenerateInsights}
                        disabled={isGeneratingInsights}
                      >
                        {isGeneratingInsights ? '生成中...' : '生成图形解读'}
                      </button>
                      <button
                        type="button"
                        className="studio-btn"
                        onClick={handleAppendInsightComments}
                        disabled={!scriptInsights}
                      >
                        写入脚本注释
                      </button>
                    </div>

                    {scriptInsights ? (
                      <div className="insight-block">
                        <strong>{scriptInsights.summary}</strong>
                        <div className="insight-list">
                          {scriptInsights.keyPoints?.map((item) => (
                            <p key={item}>关键点：{item}</p>
                          ))}
                          {scriptInsights.annotations?.map((item) => (
                            <p key={item}>标注建议：{item}</p>
                          ))}
                          {scriptInsights.explanationSteps?.slice(0, 4).map((item) => (
                            <p key={item}>步骤说明：{item}</p>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="studio-empty">
                        点击“生成图形解读”后，后端会基于当前指令返回概要、关键点和教学标注建议。
                      </p>
                    )}
                  </article>

                  <article className="studio-card">
                    <div className="studio-card-head">
                      <div>
                        <span className="card-kicker">Editor Notes</span>
                        <strong>编辑说明</strong>
                      </div>
                    </div>

                    <div className="editor-tip-grid compact">
                      {EDITOR_NOTES.map((note) => (
                        <article key={note.title} className="micro-card">
                          <strong>{note.title}</strong>
                          <p>{note.description}</p>
                        </article>
                      ))}
                    </div>
                  </article>
                </div>
              </section>
            )}

            <section className={`canvas-section ${presentationMode || !isCompactLayout || activeTab === 'canvas' ? 'active' : ''}`}>
              <div className="section-heading">
                <div>
                  <span className="section-kicker">Live Canvas</span>
                  <h2>几何画布</h2>
                  <p>{selectedCanvasMode.description}</p>
                </div>
                <div className="section-meta">
                  <span className="meta-pill meta-pill-accent">{selectedCanvasMode.label}</span>
                  <span className={`meta-pill meta-pill-${syncTone}`}>
                    {isCanvasLocked ? '拖拽锁定' : '拖拽开放'}
                  </span>
                </div>
              </div>

              {!presentationMode && (
                <div className={`canvas-sync-banner ${canvasDrift.isDirty ? 'is-dirty' : ''}`}>
                  <div className="canvas-sync-copy">
                    <span className="canvas-sync-eyebrow">
                      {canvasDrift.isDirty ? '待同步变更' : isCanvasLocked ? '受控模式' : '探索模式'}
                    </span>
                    <span className="canvas-sync-title">
                      {canvasDrift.isDirty
                        ? '画布上的自由点已经移动，当前代码与图形不再完全一致。'
                        : isCanvasLocked
                        ? '自由点拖拽已锁定，适合稳定复现脚本结果。'
                        : '当前允许拖拽自由点，便于快速验证几何关系。'}
                    </span>
                    <span className="canvas-sync-meta">
                      {canvasDrift.isDirty
                        ? `变更对象：${canvasDrift.changedObjects.join(', ')}`
                        : '如果拖拽后的结果需要保留，请点击“同步回代码”。'}
                    </span>
                    {driftHasConflict && (
                      <span className="canvas-sync-warning">
                        拖拽发生后你又修改过脚本，回写会覆盖对应点位定义。
                      </span>
                    )}
                  </div>

                  <div className="canvas-sync-actions">
                    {canvasDrift.isDirty && (
                      <button
                        type="button"
                        className="banner-btn banner-btn-primary"
                        onClick={handleSyncSelectedCanvasState}
                      >
                        同步选中对象
                      </button>
                    )}
                    {canvasDrift.isDirty && (
                      <button
                        type="button"
                        className="banner-btn banner-btn-secondary"
                        onClick={handleDiscardCanvasDrift}
                      >
                        忽略拖拽
                      </button>
                    )}
                    <button
                      type="button"
                      className={`banner-btn banner-btn-secondary ${isCanvasLocked ? 'active' : ''}`}
                      onClick={handleToggleCanvasLock}
                    >
                      {isCanvasLocked ? '解锁拖拽' : '锁定点拖拽'}
                    </button>
                  </div>
                </div>
              )}

              {!presentationMode && canvasDrift.isDirty && (
                <article className={`studio-card drift-card ${driftHasConflict ? 'is-conflict' : ''}`}>
                  <div className="studio-card-head">
                    <div>
                      <span className="card-kicker">Canvas Drift</span>
                      <strong>拖拽回写增强</strong>
                    </div>
                  </div>

                  <div className="drift-list">
                    {pointDiffs.map((diff) => (
                      <label key={diff.name} className="drift-item">
                        <input
                          type="checkbox"
                          checked={selectedDriftNames.includes(diff.name)}
                          onChange={() => handleToggleDriftName(diff.name)}
                        />
                        <div className="drift-item-copy">
                          <strong>{diff.name}</strong>
                          <span>{diff.lineNumber ? `原第 ${diff.lineNumber} 行` : '新增自由点'}</span>
                          <code>{diff.beforeCommand ?? '未在脚本中定义'} → {diff.afterCommand}</code>
                        </div>
                      </label>
                    ))}
                  </div>
                </article>
              )}

              <GeoGebraContainer
                key={selectedCanvasMode.id}
                onReady={handleGeoGebraReady}
                height={canvasHeight}
                canvasMode={selectedCanvasMode}
              />

              {!presentationMode && (
                <ControlPanel
                  onRun={handleRun}
                  onClear={handleClear}
                  onExport={handleExport}
                  onReset={handleReset}
                  canvasModes={CANVAS_MODES}
                  selectedCanvasModeId={selectedCanvasModeId}
                  onCanvasModeChange={handleCanvasModeChange}
                  isExecuting={isExecuting}
                  executionStats={executionStats}
                />
              )}

              {!presentationMode && (
                <div className="studio-grid studio-grid-secondary">
                  <article className="studio-card">
                    <div className="studio-card-head">
                      <div>
                        <span className="card-kicker">Style Batch</span>
                        <strong>批量样式</strong>
                      </div>
                    </div>

                    <div className="style-grid">
                      <label className="studio-field">
                        <span>颜色</span>
                        <input
                          type="color"
                          value={styleDraft.color}
                          onChange={(event) =>
                            setStyleDraft((prev) => ({
                              ...prev,
                              color: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="studio-field">
                        <span>线宽</span>
                        <input
                          type="number"
                          min="1"
                          max="13"
                          value={styleDraft.lineThickness}
                          onChange={(event) =>
                            setStyleDraft((prev) => ({
                              ...prev,
                              lineThickness: Number.parseInt(event.target.value, 10) || 1,
                            }))
                          }
                        />
                      </label>
                      <label className="studio-field">
                        <span>点大小</span>
                        <input
                          type="number"
                          min="1"
                          max="12"
                          value={styleDraft.pointSize}
                          onChange={(event) =>
                            setStyleDraft((prev) => ({
                              ...prev,
                              pointSize: Number.parseInt(event.target.value, 10) || 1,
                            }))
                          }
                        />
                      </label>
                    </div>

                    <div className="studio-toggle-grid">
                      <label className="studio-check">
                        <input
                          type="checkbox"
                          checked={styleDraft.labelVisible}
                          onChange={(event) =>
                            setStyleDraft((prev) => ({
                              ...prev,
                              labelVisible: event.target.checked,
                            }))
                          }
                        />
                        <span>显示标签</span>
                      </label>
                      <label className="studio-check">
                        <input
                          type="checkbox"
                          checked={styleDraft.showGrid}
                          onChange={(event) =>
                            setStyleDraft((prev) => ({
                              ...prev,
                              showGrid: event.target.checked,
                            }))
                          }
                        />
                        <span>显示网格</span>
                      </label>
                      <label className="studio-check">
                        <input
                          type="checkbox"
                          checked={styleDraft.showAxes}
                          onChange={(event) =>
                            setStyleDraft((prev) => ({
                              ...prev,
                              showAxes: event.target.checked,
                            }))
                          }
                        />
                        <span>显示坐标轴</span>
                      </label>
                    </div>

                    <div className="scope-switch">
                      <button
                        type="button"
                        className={`studio-inline-btn ${styleDraft.scope === 'all' ? 'active' : ''}`}
                        onClick={() =>
                          setStyleDraft((prev) => ({
                            ...prev,
                            scope: 'all',
                          }))
                        }
                      >
                        全部对象
                      </button>
                      <button
                        type="button"
                        className={`studio-inline-btn ${styleDraft.scope === 'selected' ? 'active' : ''}`}
                        onClick={() =>
                          setStyleDraft((prev) => ({
                            ...prev,
                            scope: 'selected',
                          }))
                        }
                      >
                        选中对象
                      </button>
                    </div>

                    {styleDraft.scope === 'selected' && (
                      <div className="object-chip-grid">
                        {availableObjectNames.map((objectName) => (
                          <button
                            key={objectName}
                            type="button"
                            className={`object-chip ${selectedStyleNames.includes(objectName) ? 'active' : ''}`}
                            onClick={() => handleToggleStyleObjectName(objectName)}
                          >
                            {objectName}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="studio-action-row">
                      <button type="button" className="studio-btn studio-btn-primary" onClick={handleApplyStyles}>
                        应用到画布
                      </button>
                    </div>
                  </article>

                  <article className="studio-card">
                    <div className="studio-card-head">
                      <div>
                        <span className="card-kicker">Lecture & Presentation</span>
                        <strong>讲解模式与演示模式</strong>
                      </div>
                    </div>

                    <p className="studio-empty">
                      讲解模式会按命令顺序逐步重建图形，适合课堂演示和录屏讲解；演示模式会隐藏代码区，只保留画布和最少控制。
                    </p>

                    <div className="lecture-metrics">
                      <span className="meta-pill meta-pill-neutral">
                        讲解进度 {lectureState.currentStep}/{lectureState.commands.length}
                      </span>
                      <span className={`meta-pill ${lectureState.isPlaying ? 'meta-pill-accent' : 'meta-pill-neutral'}`}>
                        {lectureState.isPlaying ? '自动播放中' : '等待讲解'}
                      </span>
                    </div>

                    <div className="studio-action-row">
                      <button type="button" className="studio-btn" onClick={handlePrepareLecture}>
                        准备讲解
                      </button>
                      <button type="button" className="studio-btn" onClick={handlePreviousLectureStep}>
                        上一步
                      </button>
                      <button type="button" className="studio-btn" onClick={handleNextLectureStep}>
                        下一步
                      </button>
                      <button
                        type="button"
                        className="studio-btn studio-btn-primary"
                        onClick={lectureState.isPlaying ? handleStopLecture : handleAutoPlayLecture}
                      >
                        {lectureState.isPlaying ? '停止播放' : '自动播放'}
                      </button>
                      <button type="button" className="studio-btn" onClick={handleTogglePresentationMode}>
                        开启演示模式
                      </button>
                    </div>
                  </article>
                </div>
              )}

              {!presentationMode && (
                <LogPanel
                  logs={logs}
                  errors={errors}
                  isExecuting={isExecuting}
                  executionStats={executionStats}
                />
              )}
            </section>
          </div>
        </main>

        <footer className="app-footer">
          <p>GeoGebra 交互式绘图系统 · React + Monaco Editor + GeoGebra Web API</p>
        </footer>
        <Analytics />
      </div>
    </div>
  );
};

export default App;
