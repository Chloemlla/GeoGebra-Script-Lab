import React, { useState, useCallback, useEffect, useRef } from 'react';
import GeoGebraContainer from './GeoGebraContainer';
import CodeEditor from './CodeEditor';
import ControlPanel from './ControlPanel';
import LogPanel from './LogPanel';
import AppIcon from './AppIcon';
import GeoGebraEngine from '../engine/GeoGebraEngine';
import Preprocessor from '../engine/Preprocessor';
import Dispatcher from '../engine/Dispatcher';
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
const POWERSHELL_OUTPUT_COMMAND =
  '$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Invoke-RestMethod -Uri "$env:API_BASE/api/v1/..." -Method Get | ConvertTo-Json -Depth 10';
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

const POWERSHELL_UTF8_NOTE = `# 所有接口都返回 UTF-8 JSON，PowerShell 调试时先固定输出编码
${POWERSHELL_OUTPUT_COMMAND}`;

const API_ENDPOINT_BLUEPRINT = [
  {
    id: 'asset-upload',
    method: 'POST',
    path: '/api/v1/assets/uploads',
    title: '申请上传凭证',
    description:
      '先向业务后端申请临时上传 URL，而不是把图片直接打到模型服务。这样便于做鉴权、限流、审计和对象存储隔离。',
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
    powershell: `$body = @{
  filename = "triangle-sketch.png"
  mimeType = "image/png"
  size = 421993
  purpose = "ai_drawing_input"
  canvasMode = "geometry"
} | ConvertTo-Json

Invoke-RestMethod -Uri "$env:API_BASE/api/v1/assets/uploads" -Method Post -ContentType "application/json; charset=utf-8" -Body $body | ConvertTo-Json -Depth 10`,
  },
  {
    id: 'drawing-job',
    method: 'POST',
    path: '/api/v1/ai/drawing-jobs',
    title: '创建 AI 绘图任务',
    description:
      '真正的 AI 工作放在异步任务里，避免前端请求超时。任务负责图片理解、几何对象识别、GeoGebra 命令生成和安全校验。',
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
    powershell: `$body = @{
  assetId = "asset_01JV7Q5F9CW4S8FBCV7S9F1A7M"
  prompt = "识别图中的三角形与中线，并输出可执行脚本"
  canvasMode = "geometry"
  responseFormat = "geogebra_commands_v1"
  locale = "zh-CN"
} | ConvertTo-Json

Invoke-RestMethod -Uri "$env:API_BASE/api/v1/ai/drawing-jobs" -Method Post -ContentType "application/json; charset=utf-8" -Body $body | ConvertTo-Json -Depth 10`,
  },
  {
    id: 'drawing-job-status',
    method: 'GET',
    path: '/api/v1/ai/drawing-jobs/{jobId}',
    title: '查询任务结果',
    description:
      '前端轮询这个接口，当 status=completed 时直接把 commands 交给现有 Dispatcher。返回体里要同时带 scene spec、渲染建议和风险提示。',
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
    powershell: `Invoke-RestMethod -Uri "$env:API_BASE/api/v1/ai/drawing-jobs/job_01JV7Q708K7W6FDH3Y4SEB4T5W" -Method Get | ConvertTo-Json -Depth 10`,
  },
  {
    id: 'share-canvas',
    method: 'POST',
    path: '/api/v1/shares',
    title: '创建分享画布',
    description:
      '分享接口不要只存图片，至少要保存脚本、截图、画布模式、版本、访问权限和作者信息，否则无法形成真正的协作与传播能力。',
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
    powershell: `$body = @{
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

Invoke-RestMethod -Uri "$env:API_BASE/api/v1/shares" -Method Post -ContentType "application/json; charset=utf-8" -Body $body | ConvertTo-Json -Depth 10`,
  },
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const mergeCanvasStateIntoCode = (sourceCode, pointStates) => {
  if (pointStates.length === 0) {
    return sourceCode;
  }

  const remainingStates = new Map(pointStates.map((state) => [state.name, state.command]));
  const updatedLines = sourceCode.split('\n').map((line) => {
    for (const [name, command] of remainingStates) {
      const pattern = new RegExp(
        `^(\\s*)${escapeRegExp(name)}\\s*=\\s*\\(([^()]*)\\)\\s*(//.*)?$`
      );
      const match = line.match(pattern);

      if (match) {
        remainingStates.delete(name);
        return `${match[1]}${command}${match[3] ? ` ${match[3]}` : ''}`;
      }
    }

    return line;
  });

  if (remainingStates.size === 0) {
    return updatedLines.join('\n');
  }

  const appendedLines = Array.from(remainingStates.values());
  const baseCode = updatedLines.join('\n');
  const separator = baseCode.trim().length > 0 ? '\n\n' : '';

  return `${baseCode}${separator}// 从画布同步的自由点\n${appendedLines.join('\n')}`;
};

const App = () => {
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
  const dispatcherRef = useRef(null);
  const startTimeRef = useRef(null);
  const dirtyWarningLoggedRef = useRef(false);
  const isExecutingRef = useRef(false);
  const canvasLockRef = useRef(isCanvasLocked);
  const openSourceLinkRef = useRef(null);
  const selectedCanvasMode =
    CANVAS_MODES.find((mode) => mode.id === selectedCanvasModeId) ?? CANVAS_MODES[0];

  const isCompactLayout = viewportWidth <= MOBILE_BREAKPOINT;
  const isPhoneLayout = viewportWidth <= PHONE_BREAKPOINT;
  const editorHeight = isPhoneLayout ? 360 : isCompactLayout ? 460 : 660;
  const canvasHeight = isPhoneLayout ? 380 : isCompactLayout ? 520 : 660;

  const populatedCodeLines = code.split('\n').filter((line) => line.trim().length > 0).length;
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

  const overviewMetrics = [
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
  ];

  const workflowSteps = [
    '在编辑器中输入或载入 GeoGebra 指令。',
    '运行后在右侧实时查看几何图形与执行结果。',
    '拖动自由点时，可一键把新坐标同步回代码。',
  ];

  const editorNotes = [
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

  const clearCanvasDrift = useCallback(() => {
    setCanvasDrift({
      isDirty: false,
      changedObjects: [],
    });
    dirtyWarningLoggedRef.current = false;
  }, []);

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
      setLogs(report.logs);
      setErrors(report.errors);

      const executionTime = Date.now() - startTimeRef.current;
      setExecutionStats({
        ...report,
        executionTime,
      });

      setIsExecuting(false);

      if (canvasLockRef.current) {
        GeoGebraEngine.setInteractivePointsLocked(true);
      }
    });

    dispatcherRef.current = dispatcher;
  }, []);

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
  }, [initializeDispatcher, selectedCanvasMode.label]);

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

    clearCanvasDrift();
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
  }, [canvasDrift.isDirty, clearCanvasDrift, code, isCompactLayout]);

  const handleClear = useCallback(() => {
    GeoGebraEngine.clear();
    clearCanvasDrift();
    setLogs((prev) => [
      ...prev,
      {
        message: '画板已清空',
        level: 'info',
        timestamp: new Date(),
      },
    ]);
  }, [clearCanvasDrift]);

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

    if (isCompactLayout) {
      setActiveTab('code');
    }
  }, [clearCanvasDrift, isCompactLayout, selectedCanvasModeId]);

  const handleExportCanvasState = useCallback(() => {
    const pointStates = GeoGebraEngine.exportFreePointsAsCode(canvasDrift.changedObjects);

    if (pointStates.length === 0) {
      alert('当前没有可同步回代码的自由点。');
      return;
    }

    const nextCode = mergeCanvasStateIntoCode(code, pointStates);
    setCode(nextCode);
    clearCanvasDrift();
    setActiveTab('code');
    setLogs((prev) => [
      ...prev,
      {
        message: `已将 ${pointStates.map((state) => state.name).join(', ')} 的当前位置同步回代码`,
        level: 'success',
        timestamp: new Date(),
      },
    ]);
  }, [canvasDrift.changedObjects, clearCanvasDrift, code]);

  const handleToggleCanvasLock = useCallback(() => {
    setIsCanvasLocked((prev) => !prev);
  }, []);

  const handleCanvasModeChange = useCallback(
    (nextModeId) => {
      if (!nextModeId || nextModeId === selectedCanvasModeId || isExecuting) {
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
      dispatcherRef.current = null;
      setSelectedCanvasModeId(nextModeId);
      setErrors([]);
      setExecutionStats(null);
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
    [canvasDrift.isDirty, clearCanvasDrift, isCompactLayout, isExecuting, selectedCanvasModeId]
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
      setErrors([]);
      setExecutionStats(null);
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
    [clearCanvasDrift, code, isCompactLayout]
  );

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

      setCanvasDrift((prev) => ({
        isDirty: true,
        changedObjects: Array.from(new Set([...prev.changedObjects, ...changedPointNames])),
      }));

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
  }, []);

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
              <span className={`nav-pill nav-pill-${syncTone}`}>{syncStatusText}</span>
              <span className={`nav-pill nav-pill-${recentRunTone}`}>{recentRunStatus}</span>
            </div>
          </div>
        </div>

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
                  {workflowSteps.map((step) => (
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

        <section className="chapter chapter-white api-section">
          <div className="chapter-header">
            <div>
              <span className="section-kicker">API Contract</span>
              <h2>后端接口与 PowerShell 返回格式</h2>
              <p>
                下面这组接口是前端上传图片、后端 AI 生成绘图指令、前端回放渲染与分享画布的最小可行后端。
                所有返回统一为 UTF-8 JSON，避免调试时中文乱码。
              </p>
            </div>
          </div>

          <div className="api-summary-grid">
            <article className="api-summary-card">
              <span className="card-kicker">统一返回结构</span>
              <pre className="api-code-block">{API_RESPONSE_ENVELOPE}</pre>
            </article>

            <article className="api-summary-card">
              <span className="card-kicker">PowerShell UTF-8</span>
              <pre className="api-code-block">{POWERSHELL_UTF8_NOTE}</pre>
            </article>
          </div>

          <div className="api-endpoint-grid">
            {API_ENDPOINT_BLUEPRINT.map((endpoint) => (
              <article key={endpoint.id} className="api-endpoint-card">
                <div className="api-endpoint-head">
                  <span className={`api-method api-method-${endpoint.method.toLowerCase()}`}>
                    {endpoint.method}
                  </span>
                  <code className="api-path">{endpoint.path}</code>
                </div>

                <strong className="api-endpoint-title">{endpoint.title}</strong>
                <p className="api-endpoint-description">{endpoint.description}</p>

                <div className="api-code-group">
                  <span className="api-code-label">Request</span>
                  <pre className="api-code-block">{endpoint.request}</pre>
                </div>

                <div className="api-code-group">
                  <span className="api-code-label">Response</span>
                  <pre className="api-code-block">{endpoint.response}</pre>
                </div>

                <div className="api-code-group">
                  <span className="api-code-label">PowerShell</span>
                  <pre className="api-code-block">{endpoint.powershell}</pre>
                </div>
              </article>
            ))}
          </div>
        </section>

        <main className="workspace-shell">
          {isCompactLayout && (
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

          {isPhoneLayout && (
            <div className="mobile-readonly-note">
              手机端优先查看图形。需要拖拽点位时可以先解锁画布，完成后再同步回代码。
            </div>
          )}


          <div className={`workspace ${isCompactLayout ? 'mobile-mode' : ''}`}>
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

              <CodeEditor
                value={code}
                onChange={setCode}
                width="100%"
                height={editorHeight}
                language="geogebra"
                theme="geogebra-workbench"
              />

              <div className="editor-tip-grid">
                {editorNotes.map((note) => (
                  <article key={note.title} className="micro-card">
                    <strong>{note.title}</strong>
                    <p>{note.description}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className={`canvas-section ${!isCompactLayout || activeTab === 'canvas' ? 'active' : ''}`}>
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
                </div>

                <div className="canvas-sync-actions">
                  {canvasDrift.isDirty && (
                    <button
                      type="button"
                      className="banner-btn banner-btn-primary"
                      onClick={handleExportCanvasState}
                    >
                      同步回代码
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

              <GeoGebraContainer
                key={selectedCanvasMode.id}
                onReady={handleGeoGebraReady}
                height={canvasHeight}
                canvasMode={selectedCanvasMode}
              />

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

              <LogPanel
                logs={logs}
                errors={errors}
                isExecuting={isExecuting}
                executionStats={executionStats}
              />
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
