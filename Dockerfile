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
    GA_BROWSER_BACKEND=playwright \
    GA_BROWSER_NO_SANDBOX=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY . /app
COPY --from=web-build /src/web/dist /app/web/dist

RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir ".[server]" \
    && python -m playwright install --with-deps chromium \
    && mkdir -p /data

EXPOSE 8080

CMD ["sh", "-c", "uvicorn server.app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
