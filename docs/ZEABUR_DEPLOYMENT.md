# GenericAgent Zeabur 单服务部署

GenericAgent Web 版现在按一个 Zeabur Docker 服务部署。镜像构建时会先编译 `web/` React 前端，再由 FastAPI 同时提供：

- `/`：WebUI
- `/assets/*`：前端静态资源
- `/api/*`：Backend API
- `/ws/*`：任务事件 WebSocket

## 新建服务

在 Zeabur 新建 Project，然后添加 GitHub 服务：

- Repository：`Youzini-afk/GenericAgent`
- Branch：`main`
- Root Directory：仓库根目录
- 部署方式：Dockerfile

Zeabur 会使用根目录 `Dockerfile` 构建单服务镜像。

## 环境变量

必填：

```env
GA_ADMIN_PASSWORD=<your-private-password>
```

推荐：

```env
GA_DATA_DIR=/data
GA_MYKEY_PATH=/data/mykey.py
GA_WORKER_CONCURRENCY=2
GA_MAX_QUEUE_SIZE=100
GA_TASK_TIMEOUT_SECONDS=3600
GA_CLI_TOOLS_DIR=/data/tools
GA_CLI_AUTH_DIR=/data/tool-auth
GA_CLI_RUNS_DIR=/data/agent-runs
GA_CLI_RUNNER_CONCURRENCY=2
GA_CLI_RUN_TIMEOUT_SECONDS=7200
GA_CLI_OUTPUT_LIMIT_BYTES=1000000
GA_CLI_DEFAULT_WORKSPACE=/data/workspace
GA_BROWSER_BACKEND=playwright
GA_BROWSER_NO_SANDBOX=1
```

单服务同域名访问时通常不需要配置 `GA_ALLOWED_ORIGINS`。如果你想显式限制，可以设成服务自己的 Zeabur 域名：

```env
GA_ALLOWED_ORIGINS=https://<your-service-domain>
```

## Volume

给服务挂载一个 Volume：

```text
/data
```

Backend 会把运行数据放到 `/data`：

```text
/data/mykey.py
/data/app.db
/data/memory
/data/sche_tasks
/data/workspace
/data/tools
/data/tool-auth
/data/agent-runs
/data/temp
/data/browser/workers/{worker_id}
/data/workers/{worker_id}
```

首次启动会把仓库内 `memory/` 的种子文件补到 `/data/memory`，已有文件不会覆盖。

## 访问

部署完成后直接打开 Zeabur 服务域名：

```text
https://<your-service-domain>/
```

登录密码就是 `GA_ADMIN_PASSWORD`。

健康检查：

```text
https://<your-service-domain>/api/health
```

应返回：

```json
{"ok": true}
```

## 注意事项

- 不要给 Uvicorn 配 `--workers`。多 Agent 并发由 `GA_WORKER_CONCURRENCY` 控制。
- Claude Code / Codex / OpenCode 由 WebUI 的 `CLI Tools` 安装到 `/data/tools`，不会写到系统全局 npm。
- CLI 子 Agent 的运行记录、日志、diff 和复制工作区在 `/data/agent-runs`。
- 第一版不支持水平扩容多个 Backend 实例，Zeabur 保持一个服务实例即可。
- 前端现在由 FastAPI 托管，不需要单独部署 `web/` 服务，也不需要配置 `VITE_API_BASE_URL`。
