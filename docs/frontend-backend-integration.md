# 前后端挂载与集成技术文档

本文档说明 geograba 当前代码中后端能力如何接入前端，以及开发、生产和容器部署时请求如何从浏览器进入 Rust 后端。

## 1. 集成目标

项目采用 React + Vite 前端和 Rust Hyper 后端。前端不直接访问模型、存储、Synapse OAuth 或上传缓存，而是通过 `src/api/backend.js` 的统一 API 客户端访问后端。

后端与前端有两种挂载方式：

- 开发模式：Vite dev server 运行前端，代理 `/api`、`/health`、`/assets` 到 Rust 后端。
- 生产模式：Rust 后端读取 Vite 构建产物 `dist`，同一进程同时提供 API 和前端静态资源。

## 2. 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/api/backend.js` | 前端后端 API 客户端，统一拼接地址、注入认证头、解析响应 envelope。 |
| `vite.config.js` | 开发服务器端口、Vite base path、开发代理规则。 |
| `backend/src/http/handlers.rs` | Rust 后端路由分发，区分 API、上传资产和前端静态资源。 |
| `backend/src/frontend.rs` | 加载并响应前端 `dist` 静态文件，支持 SPA fallback。 |
| `backend/src/config.rs` | 读取 `BIND_ADDR`、`FRONTEND_DIST_DIR`、`API_BASE_URL` 等运行配置。 |
| `backend/src/state.rs` | 启动时把前端构建目录预加载为内存静态资源。 |
| `Dockerfile` | 多阶段构建前端和后端，并在 fullstack 镜像中挂载前端产物。 |
| `docker-compose.yml` | 本地 fullstack 运行配置，设置 `FRONTEND_DIST_DIR=/app/frontend-dist`。 |

## 3. 开发模式挂载

开发时前端由 Vite 提供，默认地址是：

```text
http://localhost:5173
```

后端默认监听：

```text
http://127.0.0.1:3001
```

`vite.config.js` 的逻辑是：

- 如果未设置 `VITE_API_BASE_URL`，启用本地代理。
- 代理目标默认是 `VITE_API_PROXY_TARGET`，未设置时为 `http://127.0.0.1:3001`。
- 代理路径包含 `/health`、`/api`、`/assets`。

因此开发模式下，浏览器看到的是同源请求：

```text
浏览器 -> http://localhost:5173/api/v1/auth/config
Vite   -> http://127.0.0.1:3001/api/v1/auth/config
```

如果设置了 `VITE_API_BASE_URL`，Vite 不再启用代理，前端会直接请求该绝对地址。

## 4. 生产模式挂载

生产 fullstack 模式由 Rust 后端托管前端构建产物。

构建链路：

1. Docker `frontend-build` 阶段执行 `pnpm build`，生成 `/app/dist`。
2. Docker `backend-build` 阶段编译 `geograba-backend`。
3. Docker `fullstack-runtime` 阶段复制前端产物到 `/app/frontend-dist`。
4. 设置 `FRONTEND_DIST_DIR=/app/frontend-dist`。
5. Rust 后端启动时读取该目录并预加载静态资源。

运行后，API 和前端共用同一个 origin：

```text
浏览器 -> http://localhost:8080/
浏览器 -> http://localhost:8080/api/v1/auth/config
浏览器 -> http://localhost:8080/health
```

后端启动时如果能读取 `FRONTEND_DIST_DIR`，日志会显示前端资源托管已启用；如果目录不存在或未配置，则只提供 API，不提供前端页面。

## 5. 前端 API 客户端

`src/api/backend.js` 是前端访问后端的唯一集中入口。

核心职责：

- `VITE_API_BASE_URL` 为空时，请求使用相对路径，例如 `/api/v1/projects`。
- `VITE_API_BASE_URL` 非空时，请求使用绝对地址，例如 `https://api.example.com/api/v1/projects`。
- 每个 JSON 请求默认带上：
  - `Accept: application/json`
  - `Content-Type: application/json; charset=utf-8`
  - `X-Workspace-Key: <localStorage 中的工作区 key>`
  - `Authorization: Bearer <Synapse OAuth access token>`，仅在已登录时发送。
- 统一解析后端 envelope，失败时抛出带 `status`、`code` 的错误。
- 401 且本地存在 token 时触发 unauthorized handler，前端可以清理会话或提示重新授权。

后端响应格式由 `backend/src/http/responses.rs` 统一封装：

```json
{
  "success": true,
  "code": "OK",
  "message": "service is healthy",
  "requestId": "req_xxx",
  "data": {},
  "meta": {
    "timestamp": "2026-06-07T00:00:00Z",
    "version": "v1"
  },
  "error": null
}
```

## 6. 路由边界

后端路由分发在 `backend/src/http/handlers.rs`。

优先级如下：

1. `OPTIONS` 返回 CORS 预检响应。
2. `/health`、`/healthz`、`/metrics` 等基础端点。
3. `/api/v1/...` 业务 API。
4. `PUT /api/v1/uploads/...` 处理上传内容。
5. `GET /assets/...` 读取后端缓存或持久化的上传资产。
6. 其他非 `/api/` 的 `GET` 请求进入前端静态资源托管。

前端静态资源托管规则在 `backend/src/frontend.rs`：

- 命中文件路径时直接返回该文件。
- `/` 映射到 `/index.html`。
- 如果请求路径不像文件路径，也就是最后一个 path segment 不包含 `.`，返回 `index.html` 作为 SPA fallback。
- HTML 使用 `Cache-Control: no-cache`。
- JS、CSS、图片、字体等构建资源使用 `Cache-Control: public, max-age=31536000, immutable`。

需要注意：`/assets/...` 不是 Vite 构建资源路径，而是后端上传资产路径。Vite 构建资源目录配置为 `assetsDir: '_assets'`，避免和后端 `/assets` 冲突。

## 7. OAuth 回调如何回到前端

Synapse OAuth 由前端发起、后端完成 token 交换。

流程：

1. 前端调用 `buildSynapseOAuthStartUrl(window.location.href)`。
2. 浏览器跳转到后端 `/api/v1/auth/oauth/start?returnTo=<当前页面>`。
3. 后端生成 OAuth state，并重定向到 Synapse 授权页。
4. Synapse 回调后端 `/api/v1/auth/oauth/callback`。
5. 后端换取 token、读取 userinfo、生成前端 session。
6. 后端重定向回 `returnTo`，并把结果写入 URL hash：
   - 成功：`#synapseAuth=<base64url session>`
   - 失败：`#synapseError=<message>`
7. 前端 `consumeSynapseOAuthResult()` 读取 hash，保存或清除本地会话。

这个设计让 OAuth secret 只存在后端，前端只接收已经换好的 access token/session 数据。

## 8. 部署配置

常用环境变量：

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `BIND_ADDR` | 后端监听地址 | `127.0.0.1:3001`，Docker 中为 `0.0.0.0:8080` |
| `FRONTEND_DIST_DIR` | 前端构建产物目录；设置后启用后端静态托管 | 空 |
| `API_BASE_URL` | 后端对外 API 地址，用于生成 OAuth redirect URI 等 | `http://127.0.0.1:3001` |
| `FRONTEND_BASE_URL` | 前端对外地址；未设置时使用 `API_BASE_URL` | 同 `API_BASE_URL` |
| `VITE_API_BASE_URL` | 构建时注入前端的 API base URL | 空 |
| `VITE_API_PROXY_TARGET` | 开发代理目标 | `http://127.0.0.1:3001` |
| `VITE_BASE_PATH` | Vite 前端 base path | `/` |
| `SYNAPSE_OAUTH_REDIRECT_URI` | Synapse OAuth 回调地址 | `${API_BASE_URL}/api/v1/auth/oauth/callback` |

fullstack Docker 默认使用相对 API 路径，也就是 `VITE_API_BASE_URL` 为空。这是推荐方式，因为前端和后端同源部署，不需要跨域配置。

## 9. 本地验证

开发模式：

```bash
cd backend
cargo run
```

```bash
pnpm dev
```

浏览器打开 `http://localhost:5173`。前端请求 `/api` 会被 Vite 代理到 `127.0.0.1:3001`。

生产 fullstack 模式：

```bash
docker compose up --build
```

浏览器打开 `http://localhost:8080`。

验证点：

- `GET /` 返回前端页面。
- `GET /health` 返回后端健康检查 envelope。
- `GET /api/v1/auth/config` 返回 Synapse OAuth 配置。
- 刷新任意前端路由时仍返回 `index.html`。
- 上传生成的 `/assets/...` URL 由后端返回对应资产，不落入前端 SPA fallback。

## 10. 扩展约束

新增前端页面时，前端路由不应以 `/api/` 开头。

新增后端 API 时，应放在 `/api/v1/...` 下，避免被静态资源 fallback 捕获。

新增静态构建资源目录时，不要使用 `/assets` 作为 Vite 输出目录；该路径已经被后端资产服务占用。

如果要把前端部署到独立静态站点，必须在构建时设置 `VITE_API_BASE_URL` 指向后端公开地址，并确保后端 CORS、OAuth redirect URI 和 `API_BASE_URL` 与公开域名一致。
