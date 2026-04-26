# GeoGebra 系统架构文档

## 1. 系统总览

本系统是一个基于 GeoGebra Web API 的交互式数学可视化平台。整个系统采用**分层架构**设计，分为三个核心层次：

```
┌──────────────────────────────────────────┐
│         前端交互层 (Presentation)         │
│  - React 组件                             │
│  - Monaco Editor (代码编辑)               │
│  - UI 组件库                              │
└──────────────┬───────────────────────────┘
               │ 数据流 / 指令流
┌──────────────▼───────────────────────────┐
│         逻辑中枢层 (Business Logic)       │
│  - 预处理器 (Preprocessor)               │
│  - 指令调度器 (Dispatcher)               │
│  - 状态管理                               │
└──────────────┬───────────────────────────┘
               │ GeoGebra 标准指令
┌──────────────▼───────────────────────────┐
│      GeoGebra 引擎层 (External API)       │
│  - ggbApplet.evalCommand()                │
│  - ggbApplet.getValue()                   │
│  - Canvas/SVG 渲染                        │
└───────────────────────────────────────────┘
```

## 2. 核心模块详解

### 2.1 GeoGebraEngine (引擎初始化)

**职责**：

- 管理 GeoGebra Applet 的生命周期
- 提供统一的 API 接口
- 处理异步加载问题

**关键方法**：

```javascript
class GeoGebraEngine {
  // 初始化 Applet
  async init(containerId, options)

  // 等待就绪
  async ready()

  // 执行指令
  executeCommand(command: string): boolean

  // 获取对象值
  getValue(objectName: string): any

  // 重置和清空
  reset()
  clear()

  // 对象监听
  onUpdate(listener: Function)

  // 导出
  exportImage(format: string): string
}
```

**特殊配置**：

```javascript
{
  language: 'en',           // 强制英文，保证脚本通用性
  showToolBar: false,       // 隐藏工具栏，提供纯净环境
  showMenuBar: false,
  showAlgebraInput: false,
  enableLabelDrags: true,   // 启用交互拖动
}
```

**异步加载处理**：

系统通过全局的 `ggbOnInit` 钩子处理异步初始化：

```javascript
// 系统监听这个全局函数
window.ggbOnInit = () => {
  // GeoGebra 已完全初始化
  this.applet = ggbApplet;
  this.isReady = true;
  this.resolveReady(this.applet);
};
```

### 2.2 Preprocessor (预处理器)

**职责**：

- 清洗用户输入的代码
- 验证语法的基本有效性
- 提取代码统计信息

**处理流程**：

```
用户代码
  ↓
1. 按行分割
  ↓
2. 移除注释 (//)
  ↓
3. 去除前后空白
  ↓
4. 过滤空行
  ↓
清洁指令数组
```

**关键方法**：

```javascript
class Preprocessor {
  // 清洗代码
  static clean(userCode: string): string[]

  // 验证语法
  static validate(commands: string[]): {valid, errors}

  // 提取变量
  static extractVariables(commands: string[]): {defined, referenced}

  // 获取统计信息
  static getStats(userCode: string): {totalLines, commandLines, ...}
}
```

**注释处理算法**：

```javascript
// 移除 // 注释，但要避免移除字符串内的 //
const commentIndex = line.indexOf("//");

if (commentIndex === -1) return line;

// 检查 // 是否在字符串内
const beforeComment = line.substring(0, commentIndex);
const quoteCount = (beforeComment.match(/"/g) || []).length;

// 如果引号个数为奇数，说明在字符串内，保留 //
if (quoteCount % 2 === 1) return line;

return beforeComment;
```

### 2.3 Dispatcher (指令调度器)

**职责**：

- 顺序执行指令
- 捕获和报告错误
- 提供执行日志

**执行流程**：

```
指令数组
  ↓
检查就绪
  ↓
重置画板 (可选)
  ↓
for each command:
  ├─ 报告进度
  ├─ 执行指令 (evalCommand)
  ├─ 检查返回值
  ├─ 记录日志
  └─ 如果失败，记录错误
  ↓
生成报告
  ↓
触发回调
```

**关键方法**：

```javascript
class Dispatcher {
  // 执行指令序列
  async execute(commands: string[], options: {resetBeforeRun, verbose})

  // 回调设置
  setOnProgress(callback)
  setOnError(callback)
  setOnComplete(callback)

  // 报告生成
  getExecutionReport(): Report

  // 日志管理
  getLogs(): Log[]
  getErrors(): Error[]
}
```

**错误处理策略**：

- 捕获每一行的执行结果
- 如果某行失败，记录错误但继续执行后续指令（可配置）
- 收集所有错误，最后生成完整报告

## 3. React 组件架构

### 3.1 组件树

```
<App>
  ├── <GeoGebraContainer>      # 画板容器
  ├── <CodeEditor>             # 代码编辑器
  ├── <ControlPanel>           # 控制面板
  └── <LogPanel>               # 日志面板
```

### 3.2 数据流

```
┌──────────────┐
│ App (状态)   │
├──────────────┤
│ - code       │ ───→ CodeEditor
│ - logs       │ ───→ LogPanel
│ - errors     │ ───→ LogPanel
│ - isExecuting│ ───→ ControlPanel
└──────────────┘
     ▲
     │
  回调函数
     │
┌────┴──────────────────┬────────────────┐
│ onRun            onClear          onExport
│ (执行代码)       (清空画板)      (导出图片)
```

### 3.3 组件职责

| 组件              | 职责                 | 主要 Props               |
| ----------------- | -------------------- | ------------------------ |
| App               | 状态管理、协调各组件 | -                        |
| GeoGebraContainer | 挂载 GeoGebra Applet | onReady                  |
| CodeEditor        | 代码编辑、语法高亮   | value, onChange          |
| ControlPanel      | 操作按钮、统计显示   | onRun, onClear, onExport |
| LogPanel          | 显示执行日志和错误   | logs, errors             |

## 4. 技术难点和解决方案

### 4.1 异步加载问题

**问题**：GeoGebra 体积大，加载是异步的。如果在加载完成前调用 API，会导致错误。

**解决**：

- 使用 Promise-based 的 `ready()` 方法
- 通过全局 `ggbOnInit` 钩子监听初始化完成
- 在 React 中用 `useEffect` 异步初始化

```javascript
useEffect(() => {
  const init = async () => {
    await GeoGebraEngine.ready();
    // 现在可以安全使用
  };
  init();
}, []);
```

### 4.2 多语言/本地化问题

**问题**：GeoGebra 的指令支持多语言本地化。如果用户系统语言不是英文，指令可能无法识别。

**解决**：

- 在初始化时强制设置 `language: 'en'`
- 所有脚本必须使用英文指令名称
- 在文档中明确说明这一限制

### 4.3 指令执行顺序依赖

**问题**：GeoGebra 是强依赖的。如果定义 A 失败，后续使用 A 的指令也会失败。

**解决**：

- 前置验证（检查括号、赋值格式等）
- 实时错误捕获和报告
- 可选的"快速失败"或"继续执行"策略

```javascript
// 当前策略：快速失败
if (!success) {
  errors.push(error);
  break;  // 停止执行
}

// 可选：继续执行
// errors.push(error);
// continue;  // 继续下一行
```

### 4.4 UI 响应性问题

**问题**：如果执行大量指令，UI 可能会阻塞。

**解决**：

- 使用异步执行
- 提供进度回调
- 允许用户看到实时进度

```javascript
dispatcher.setOnProgress((progress) => {
  updateProgressBar(progress.percentage);
});
```

## 5. 扩展指南

### 5.1 添加新功能

#### 添加新的预处理规则

```javascript
// 在 Preprocessor 中
static validateCustomRule(command) {
  // 实现自定义验证规则
}
```

#### 添加新的操作按钮

```javascript
// 在 ControlPanel 中
<button onClick={onNewAction}>新操作</button>
```

#### 添加新的日志类型

```javascript
// 在 Dispatcher 中
this.log(message, 'custom-level', data);

// 在 LogPanel 中添加对应的样式
.log-custom-level { ... }
```

### 5.2 自定义主题

编辑 Monaco Editor 主题：

```javascript
monaco.editor.defineTheme("my-theme", {
  base: "vs-dark",
  inherit: true,
  rules: [
    // 自定义规则
  ],
  colors: {
    // 自定义颜色
  },
});
```

### 5.3 集成其他库

系统设计允许集成其他数学库（如 math.js）：

```javascript
import * as math from "mathjs";

// 在预处理器中使用
const result = math.evaluate(expression);
```

## 6. 性能优化建议

### 6.1 指令优化

- 避免重复创建相同的对象
- 合并可以合并的指令
- 使用序列函数生成多个对象

### 6.2 渲染优化

- 使用 React.memo 防止不必要的重渲染
- 避免在 render 中创建新的函数引用

### 6.3 加载优化

- 考虑使用 CDN 加速 GeoGebra 和 Monaco Editor
- 实现代码分割，延迟加载非核心功能

## 7. 测试策略

### 单元测试

```javascript
// 测试预处理器
describe("Preprocessor", () => {
  test("should remove comments", () => {
    const input = "A = (0, 0) // comment";
    expect(Preprocessor.clean(input)).toEqual(["A = (0, 0)"]);
  });
});
```

### 集成测试

```javascript
// 测试完整流程
test("should execute commands and update canvas", async () => {
  const dispatcher = new Dispatcher(mockEngine);
  const report = await dispatcher.execute(["A = (0, 0)"]);
  expect(report.success).toBe(true);
});
```

## 8. 部署指南

### 构建生产版本

```bash
npm run build
```

生成的 `dist/` 目录可以直接部署到任何静态文件服务器。

### 环境变量

创建 `.env` 文件（可选）：

```
VITE_GEOGEBRA_URL=https://www.geogebra.org/apps/deployggb.js
VITE_API_BASE_URL=http://127.0.0.1:3001
```

## 9. 故障排查

| 问题              | 原因                  | 解决                     |
| ----------------- | --------------------- | ------------------------ |
| GeoGebra 加载失败 | 网络问题或 CDN 不可用 | 检查网络，使用代理或镜像 |
| 指令无法识别      | 使用了非英文指令      | 确保使用英文指令名称     |
| 图形不显示        | 指令有误或没有执行    | 检查日志面板错误信息     |
| 编辑器响应慢      | Monaco Editor 加载中  | 耐心等待或使用简化编辑器 |

---

**更新日期**：2026 年 4 月 24 日
