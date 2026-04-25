# Advanced UX Feature Spec

更新日期：2026-04-25

## 1. 本轮已落地

以下能力已经在当前仓库中以可运行形态落地：

- 项目空间（本地优先）
  - 自动保存
  - 最近打开
  - 文件夹
  - 标签
  - 收藏
- 历史版本（本地快照）
  - 手动快照
  - 快照回滚
  - 快照对比
  - 快照级撤销 / 重做
- 拖拽回写增强
  - 只同步选中对象
  - 原始命令 / 新命令差异展示
  - 脚本冲突提醒
- 参数面板
  - 数值变量映射为滑块 + 数字输入
  - 布尔变量映射为开关
  - 字符串变量映射为输入框
- 批量样式
  - 颜色
  - 线宽
  - 点大小
  - 标签显示
  - 网格显示
  - 坐标轴显示
- 讲解模式
  - 按命令逐步构造
  - 上一步 / 下一步 / 自动播放
- 演示模式
  - 隐藏代码区
  - 保留交互画布
  - 尝试进入浏览器全屏
- 智能标注 / 图形解释 v1
  - 前端触发
  - 后端 AI 接口
  - 返回概要、关键点、标注建议、步骤说明

## 2. 本轮未完全落地但已完成设计

以下能力一次性全部做完成本较高，当前以详细技术方案冻结接口与实现路径：

- 项目空间云端同步版
- 历史版本云端持久化版
- 导出矩阵高级版
- 智能标注 v2：对象级标注回写
- 图形解释 v2：依赖链解释、对象级解释、教学讲稿生成

---

## 3. 项目空间云端同步版

### 3.1 目标

把当前本地优先的项目空间升级为账号可同步、可恢复、可扩展为团队空间的后端能力。

### 3.2 前端模块

- `WorkspacePanel`
  - 新建 / 保存 / 打开 / 收藏 / 标签编辑
- `AutosaveManager`
  - 800ms debounce
  - 离线时写本地草稿
  - 在线时同步后端
- `ProjectIndexStore`
  - 维护最近打开、当前项目、同步状态

### 3.3 后端数据模型

#### `projects`

```json
{
  "id": "proj_01JV...",
  "ownerId": "user_01...",
  "title": "三角形中线",
  "folder": "初中几何/七年级",
  "tags": ["课堂", "中线", "动态"],
  "isFavorite": true,
  "canvasMode": "geometry",
  "latestCode": "A = ...",
  "latestVersionId": "ver_01...",
  "createdAt": "2026-04-25T12:00:00Z",
  "updatedAt": "2026-04-25T12:30:00Z",
  "lastOpenedAt": "2026-04-25T12:31:00Z",
  "deletedAt": null
}
```

#### `project_versions`

```json
{
  "id": "ver_01JV...",
  "projectId": "proj_01JV...",
  "label": "运行脚本",
  "trigger": "execution",
  "canvasMode": "geometry",
  "code": "A = ...",
  "summary": {
    "changedLines": 4,
    "addedLines": 1,
    "removedLines": 0
  },
  "createdAt": "2026-04-25T12:30:00Z"
}
```

### 3.4 API 设计

#### 创建项目

`POST /api/v1/projects`

```json
{
  "title": "三角形中线",
  "folder": "初中几何/七年级",
  "tags": ["课堂", "中线"],
  "isFavorite": false,
  "canvasMode": "geometry",
  "code": "A = (-3,0)\n..."
}
```

#### 项目列表

`GET /api/v1/projects?favorite=true&folder=初中几何`

#### 更新项目元数据

`PATCH /api/v1/projects/{projectId}`

#### 获取项目详情

`GET /api/v1/projects/{projectId}`

#### 保存快照

`POST /api/v1/projects/{projectId}/versions`

```json
{
  "label": "手动快照",
  "trigger": "manual",
  "canvasMode": "geometry",
  "code": "A = ..."
}
```

#### 版本列表

`GET /api/v1/projects/{projectId}/versions`

### 3.5 同步策略

- 前端始终维护本地草稿
- 后端保存结构化项目与版本
- 采用 `updatedAt` + `etag` 防覆盖
- 若服务端版本更新晚于本地且内容不同：
  - 前端提示冲突
  - 用户选择“保留本地”或“使用云端”

### 3.6 实施顺序

1. 新增后端 `projects` 与 `project_versions` 内存版 / Mongo 版仓储
2. 前端 autosave 增加在线同步
3. 增加冲突检测与重试
4. 再做多端恢复与团队共享

---

## 4. 历史版本云端持久化版

### 4.1 目标

把当前快照级历史升级成可长期保存、可比较、可审阅的版本系统。

### 4.2 当前缺口

- 当前版本仅存在本地项目快照中
- 没有服务端持久化
- 没有 diff 压缩存储
- 没有版本备注 / 责任人 / 审阅状态

### 4.3 建议模型

#### `project_version_diffs`

```json
{
  "versionId": "ver_01JV...",
  "projectId": "proj_01JV...",
  "baseVersionId": "ver_01JU...",
  "diffFormat": "line_patch_v1",
  "diffPayload": "...",
  "stats": {
    "changedLines": 12,
    "addedLines": 3,
    "removedLines": 2
  }
}
```

### 4.4 关键 API

- `GET /api/v1/projects/{projectId}/versions/{versionId}/diff?base=current`
- `POST /api/v1/projects/{projectId}/versions/{versionId}/restore`
- `POST /api/v1/projects/{projectId}/versions/{versionId}/pin`

### 4.5 前端交互

- 版本列表按时间倒序
- 支持筛选：
  - 运行生成
  - 手动快照
  - AI 生成
  - 拖拽同步
- 对比视图采用两栏：
  - 左侧旧版本
  - 右侧当前版本
- 回滚前强制确认

---

## 5. 导出矩阵高级版

### 5.1 当前状态

当前已支持：

- PNG 导出
- 脚本文本导出

### 5.2 目标格式

- PNG
- SVG
- PDF
- GIF
- MP4
- PPT 插图
- GeoGebra 原生文件

### 5.3 前后端一对一设计

#### PNG / SVG

- 前端
  - 触发导出
  - 选择尺寸、背景、是否显示网格/坐标轴
- 后端
  - 可选，用于服务端批量导出

#### PDF

- 前端
  - 选择单页 / 多页
  - 选择是否包含脚本说明
- 后端
  - `POST /api/v1/exports/pdf`
  - 服务端把 PNG/SVG 与说明文本拼成 PDF

#### GIF / MP4

- 前端
  - 设置录制时长、帧率、讲解模式数据源
- 后端
  - `POST /api/v1/exports/media-jobs`
  - 任务异步渲染
  - 输出对象存储 URL

#### PPT 插图

- 前端
  - 选择主题比例、标题、副标题
- 后端
  - `POST /api/v1/exports/pptx`
  - 生成标准 `.pptx`

#### GeoGebra 原生文件

- 前端
  - 导出项目元数据
- 后端
  - `POST /api/v1/exports/ggb`
  - 若直接调用 GeoGebra 原生导出受限，则采用中间结构转换

### 5.4 建议任务模型

#### `export_jobs`

```json
{
  "id": "exp_01JV...",
  "projectId": "proj_01JV...",
  "type": "mp4",
  "status": "queued",
  "options": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "durationMs": 12000
  },
  "assetUrl": null,
  "createdAt": "2026-04-25T12:40:00Z",
  "updatedAt": "2026-04-25T12:40:00Z"
}
```

### 5.5 落地建议

1. 先做 `SVG` 和 `PDF`
2. 再做 `GIF`
3. 最后做 `MP4 / PPT / GGB`

---

## 6. 智能标注 v2

### 6.1 当前状态

当前已支持：

- 生成概要
- 生成关键点
- 生成标注建议
- 把说明写入脚本注释

### 6.2 v2 目标

让 AI 标注结果能回写成真正的图上元素，而不是只显示在说明卡片里。

### 6.3 后端接口

`POST /api/v1/ai/annotation-jobs`

```json
{
  "canvasMode": "geometry",
  "commands": [
    "A = (-3, 0)",
    "B = (3, 0)",
    "C = (1, 4)",
    "M = Midpoint(B, C)"
  ],
  "goal": "生成教学标注",
  "locale": "zh-CN"
}
```

### 6.4 返回结构

```json
{
  "summary": "三角形 ABC 中，M 是 BC 的中点。",
  "annotations": [
    {
      "id": "ann_1",
      "label": "中点 M",
      "description": "M 由边 BC 的中点定义。",
      "relatedObjects": ["M", "B", "C"],
      "suggestedCommand": "Text(\"M 是 BC 的中点\", (1.2, 1.4))"
    }
  ]
}
```

### 6.5 前端交互

- 用户勾选想插入的标注
- 前端把 `suggestedCommand` 合并到脚本
- 可二次拖拽文字位置

---

## 7. 图形解释 v2

### 7.1 当前状态

当前已支持：

- 基于全脚本生成自然语言解释
- 返回步骤说明

### 7.2 v2 目标

解释要从“整段概述”升级到“对象级依赖链解释”。

### 7.3 后端模型

#### `script_explanations`

```json
{
  "summary": "脚本先定义三角形顶点，再构造中点 M，最后连接中线。",
  "objects": [
    {
      "name": "M",
      "kind": "point",
      "dependsOn": ["B", "C"],
      "reason": "M 由 Midpoint(B, C) 定义，因此依赖于 B 和 C。"
    }
  ],
  "steps": [
    {
      "index": 1,
      "command": "M = Midpoint(B, C)",
      "explanation": "计算边 BC 的中点并命名为 M。"
    }
  ]
}
```

### 7.4 API

- `POST /api/v1/ai/script-insights`
  - 当前已落地
- `POST /api/v1/ai/object-explanations`
  - v2 目标接口

### 7.5 前端交互

- 在对象列表中点击 `M`
- 右侧显示：
  - 它由什么命令生成
  - 它依赖哪些对象
  - 它在整张图里的作用

---

## 8. 推荐的下一阶段任务拆分

### Milestone A

- 项目空间后端 CRUD
- 版本快照服务端持久化
- 项目同步状态提示

### Milestone B

- SVG / PDF 导出
- 标注命令回写
- 对象级解释 API

### Milestone C

- GIF / MP4 任务导出
- 团队项目空间
- 审阅与评论

---

## 9. 与当前代码的对应关系

- 前端主入口：
  - `src/components/App.jsx`
- 本地工作流工具层：
  - `src/utils/studio.js`
- GeoGebra 样式能力：
  - `src/engine/GeoGebraEngine.js`
- 后端 AI 解释接口：
  - `backend/src/main.rs`
- 前端后端桥接：
  - `src/api/backend.js`

这份文档的目的不是抽象讨论，而是给下一轮开发直接提供 API、数据模型和前端模块边界。
