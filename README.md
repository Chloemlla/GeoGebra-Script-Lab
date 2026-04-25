# GeoGebra 交互式绘图系统

一个基于 GeoGebra Web API 的现代化交互式数学可视化平台，使用 React 和 Monaco Editor 构建。

## 🎯 系统架构

```
┌─────────────────────────────────────┐
│      前端交互层 (UI)                │
├─────────────────────────────────────┤
│ - 代码编辑器 (Monaco Editor)         │
│ - 控制面板 (Control Panel)           │
│ - 日志面板 (Log Panel)               │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│      逻辑中枢层 (Engine)             │
├─────────────────────────────────────┤
│ - 预处理器 (Preprocessor)           │
│ - 指令调度器 (Dispatcher)           │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│    GeoGebra 引擎层 (Engine)          │
├─────────────────────────────────────┤
│ - GeoGebra Applet API               │
│ - Canvas/SVG 渲染视图                │
└─────────────────────────────────────┘
```

## 📋 核心功能

### 1. 引擎初始化 (GeoGebraEngine)

- 异步加载 GeoGebra Applet
- 隐藏原生工具栏，提供纯净的绘图环境
- 强制使用英文 API，保证脚本通用性
- 支持对象状态监听和双向绑定

### 2. 预处理器 (Preprocessor)

- 移除注释 (`//` 及之后的内容)
- 过滤空行
- 验证基本语法 (括号匹配、赋值格式)
- 提取变量依赖关系
- 代码统计

### 3. 指令调度器 (Dispatcher)

- 顺序执行清洗后的指令
- 捕获执行错误
- 提供详细的执行日志和报告
- 进度回调和错误处理

### 4. 用户界面

- **代码编辑器**：支持语法高亮、行号、代码折叠
- **绘图画板**：GeoGebra 原生渲染
- **控制面板**：运行、清空、导出、重置等操作
- **日志面板**：实时显示执行结果和错误信息

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

打开 `http://localhost:5173` 即可看到应用。

### 生产构建

```bash
npm run build
```

## 📝 使用指南

### 基本用法

1. 在左侧编辑器中输入 GeoGebra 指令
2. 点击"运行"按钮或按 `Ctrl+Enter` 执行
3. 在中间的画板上查看绘图结果
4. 查看下方的日志面板了解执行详情

### GeoGebra 指令示例

```
// 创建点
A = (0, 0)
B = (3, 0)
C = (3, 4)

// 创建线段
s1 = Segment(A, B)
s2 = Segment(B, C)

// 创建圆
circle = Circle(A, 2)

// 计算距离
dist = Distance(A, B)

// 创建多边形
poly = Polygon(A, B, C)
```

### 注释

使用 `//` 添加注释，预处理器会自动移除：

```
A = (0, 0)  // 这是点 A
B = (3, 0)  // 这是点 B
```

## 🎨 主要特性

### 1. 错误处理

- 详细的错误报告（行号、错误信息、错误指令）
- 执行出错后自动停止，防止级联错误
- 实时错误日志显示

### 2. 性能优化

- 支持异步指令执行
- 进度回调，避免 UI 阻塞
- 高效的预处理和验证机制

### 3. 用户体验

- 快捷键支持 (`Ctrl+Enter` 运行代码)
- 实时执行统计信息
- 图片导出功能
- 响应式设计，适配各种屏幕

### 4. 代码质量

- 模块化设计，易于扩展
- 完整的注释和文档
- 错误处理完善
- 支持验证和状态管理

## 📦 项目结构

```
geograba/
├── index.html                 # HTML 入口
├── vite.config.js             # Vite 配置
├── package.json               # 项目配置
├── src/
│   ├── index.jsx              # React 入口
│   ├── index.css              # 全局样式
│   ├── engine/
│   │   ├── GeoGebraEngine.js   # GeoGebra 引擎初始化
│   │   ├── Preprocessor.js     # 代码预处理器
│   │   └── Dispatcher.js       # 指令调度器
│   └── components/
│       ├── App.jsx            # 主应用组件
│       ├── App.css            # 应用样式
│       ├── GeoGebraContainer.jsx  # 画板容器
│       ├── CodeEditor.jsx      # 代码编辑器
│       ├── ControlPanel.jsx    # 控制面板
│       ├── ControlPanel.css    # 面板样式
│       ├── LogPanel.jsx        # 日志面板
│       └── LogPanel.css        # 日志样式
```

## 🔧 配置选项

### GeoGebra 初始化配置

```javascript
{
  appName: 'geometry',           // 默认使用几何应用，兼容 Polygon / Midpoint / Tangent 等命令
  width: 800,                    // 宽度
  height: 600,                   // 高度
  showToolBar: false,            // 隐藏工具栏
  showMenuBar: false,            // 隐藏菜单栏
  showAlgebraInput: false,       // 隐藏代数输入框
  enableLabelDrags: true,        // 启用标签拖动
  enableRightClick: true,        // 启用右键菜单
  language: 'en',                // 强制英文
}
```

## 🐛 常见问题

### 1. GeoGebra 加载失败

**问题**：提示"GeoGebra 加载超时"

**解决**：

- 检查网络连接
- 确保 `deployggb.js` 可以访问（需要网络）
- 稍等片刻后重新加载页面

### 2. 指令执行失败

**问题**：某些指令无法执行

**解决**：

- 检查语法是否正确
- 确保变量已定义
- 查看日志面板中的错误详情

### 3. 多语言问题

**问题**：指令在不同语言环境下无法执行

**解决**：

- 系统已强制设置为英文 API
- 确保使用英文指令名称（如 `Polygon` 而不是 `多边形`）

## 🌐 浏览器兼容性

- Chrome / Edge (推荐)
- Firefox
- Safari
- 需要 ES6 支持

## 📚 GeoGebra API 文档

官方文档：https://wiki.geogebra.org/en/Reference:GeoGebra_Apps_API

常用指令：

- `Point(x, y)` - 创建点
- `Line(A, B)` - 创建直线
- `Segment(A, B)` - 创建线段
- `Circle(center, radius)` - 创建圆
- `Polygon(A, B, C, ...)` - 创建多边形
- `Distance(A, B)` - 计算距离
- `Midpoint(A, B)` - 计算中点

## 🎓 学习资源

- GeoGebra 官网: https://www.geogebra.org/
- React 文档: https://react.dev/
- Monaco Editor: https://microsoft.github.io/monaco-editor/

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📞 联系方式

如有问题或建议，请提交 Issue。

---

**开发者提示**：

1. 修改编辑器代码会自动触发实时渲染（通过 Vite HMR）
2. 打开浏览器开发者工具的控制台可以查看详细的调试信息
3. 所有的执行日志都保存在 React state 中，支持回放和分析
4. 预处理器提供了代码统计功能，可以用来分析代码质量

**扩展建议**：

1. 添加历史记录和撤销/重做功能
2. 实现代码模板库
3. 支持导出为 GeoGebra 原生格式
4. 添加协作编辑功能
5. 集成更多数学工具
6. 支持动画和交互式参数调整
