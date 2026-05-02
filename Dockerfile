FROM node:22-bookworm-slim AS web-build

WORKDIR /src/web

COPY web/package*.json ./
RUN npm ci

COPY web/ ./
RUN npm run build


FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GA_DATA_DIR=/data \
    GA_MYKEY_PATH=/data/mykey.py \
    GA_WORKER_CONCURRENCY=2 \
    GA_MAX_QUEUE_SIZE=100 \
    GA_TASK_TIMEOUT_SECONDS=3600 \
    GA_CLI_TOOLS_DIR=/data/tools \
    GA_CLI_AUTH_DIR=/data/tool-auth \
    GA_CLI_RUNS_DIR=/data/agent-runs \
    GA_CLI_RUNNER_CONCURRENCY=2 \
    GA_CLI_RUN_TIMEOUT_SECONDS=7200 \
    GA_CLI_OUTPUT_LIMIT_BYTES=1000000 \
    GA_CLI_DEFAULT_WORKSPACE=/data/workspace \
    GA_BROWSER_BACKEND=playwright \
    GA_BROWSER_NO_SANDBOX=1

WORKDIR /app

COPY --from=web-build /usr/local/bin/node /usr/local/bin/node
COPY --from=web-build /usr/local/lib/node_modules /usr/local/lib/node_modules

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl git ca-certificates \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && rm -rf /var/lib/apt/lists/*

COPY . /app
COPY --from=web-build /src/web/dist /app/web/dist

RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir ".[server]" \
    && python -m playwright install --with-deps chromium \
    && mkdir -p /data/tools /data/tool-auth /data/agent-runs /data/workspace

EXPOSE 8080

CMD ["sh", "-c", "uvicorn server.app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
