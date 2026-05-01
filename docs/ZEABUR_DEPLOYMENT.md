# GenericAgent Zeabur 部署

## Backend

在 Zeabur 新建 Docker 服务，Root Directory 指向仓库根目录。

环境变量：

```env
GA_DATA_DIR=/data
GA_MYKEY_PATH=/data/mykey.py
GA_WORKER_CONCURRENCY=2
GA_MAX_QUEUE_SIZE=100
GA_TASK_TIMEOUT_SECONDS=3600
GA_BROWSER_BACKEND=playwright
GA_BROWSER_NO_SANDBOX=1
GA_ADMIN_PASSWORD=<required>
GA_ALLOWED_ORIGINS=https://<frontend-domain>
```

挂载 Volume：

```text
/data
```

启动命令由 Dockerfile 提供：

```sh
uvicorn server.app.main:app --host 0.0.0.0 --port ${PORT:-8080}
```

不要额外配置 `uvicorn --workers`。多 Agent 并发由 Backend 内部 worker pool 管理。

## Frontend

新建 Node.js 服务，Root Directory 指向 `web/`。

构建命令：

```sh
npm ci && npm run build
```

环境变量：

```env
VITE_API_BASE_URL=https://<backend-domain>
```

## 持久化目录

Backend 会把运行数据放到 `/data`：

```text
/data/mykey.py
/data/app.db
/data/memory
/data/sche_tasks
/data/workspace
/data/temp
/data/browser/workers/{worker_id}
/data/workers/{worker_id}
```

首次启动会把仓库内 `memory/` 的种子文件补到 `/data/memory`，已有文件不会覆盖。
