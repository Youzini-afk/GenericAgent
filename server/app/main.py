from __future__ import annotations

import os
import base64
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from runtime_paths import code_path, ensure_runtime_layout, mykey_path, runtime_path
from server.app.browser.manager import BrowserRegistry
from server.app.cli_agents.installer import ToolInstaller
from server.app.cli_agents.pool import CliRunPool
from server.app.cli_agents.registry import get_tool_spec, list_tool_specs
from server.app.cli_agents.store import CliAgentStore
from server.app.core.auth import AuthManager
from server.app.queue.store import QueueStore
from server.app.services.llm_config import load_llm_config, save_llm_config
from server.app.services.resources import (
    ResourceError,
    browse_files,
    delete_file,
    memory_file,
    read_logs,
    write_file,
    write_memory_file,
)
from server.app.services.scheduler import SchedulerService
from server.app.workers.pool import WorkerPool


class LoginRequest(BaseModel):
    password: str


class SessionCreate(BaseModel):
    title: str = ""


class MessageCreate(BaseModel):
    content: str


class SessionPatch(BaseModel):
    title: str | None = None
    llm_idx: int | None = None


class ConfigPayload(BaseModel):
    configs: list[dict[str, Any]] = []
    extras: dict[str, Any] = {}


class MemoryPayload(BaseModel):
    content: str = ""


class FilePayload(BaseModel):
    root: str = "workspace"
    path: str
    content: str = ""


class SchedulePayload(BaseModel):
    title: str = ""
    prompt: str = ""
    cron: str = "@manual"
    enabled: bool = True


class BrowserTabCreate(BaseModel):
    url: str | None = None


class BrowserNavigate(BaseModel):
    url: str


class BrowserExecute(BaseModel):
    code: str
    timeout: int = 15


class CliToolInstallPayload(BaseModel):
    version: str = "latest"


class CliEnvProfilePayload(BaseModel):
    name: str = ""
    tool_id: str = "codex"
    env: dict[str, Any] = {}


class CliRunCreatePayload(BaseModel):
    provider: str
    prompt: str
    target_workspace: str | None = None
    write_intent: bool = True
    policy: dict[str, Any] = {}
    env_profile_id: str | None = None
    parent_task_id: str | None = None
    parent_session_id: str | None = None


def _settings() -> dict[str, Any]:
    ensure_runtime_layout()
    data = runtime_path()
    auth = AuthManager(data, os.environ.get("GA_ADMIN_PASSWORD", ""))
    store = QueueStore(runtime_path("app.db"))
    store.recover_interrupted()
    cli_store = CliAgentStore(runtime_path("app.db"))
    cli_store.recover_interrupted()
    concurrency = int(os.environ.get("GA_WORKER_CONCURRENCY", "2") or 2)
    pool = WorkerPool(store, concurrency=concurrency, data_dir=str(data)) if concurrency > 0 else None
    cli_concurrency = int(os.environ.get("GA_CLI_RUNNER_CONCURRENCY", "2") or 2)
    cli_pool = CliRunPool(cli_store, concurrency=cli_concurrency) if cli_concurrency > 0 else None
    scheduler = None
    if os.environ.get("GA_SCHEDULER_ENABLED", "1") != "0":
        scheduler = SchedulerService(store, poll_interval=float(os.environ.get("GA_SCHEDULER_POLL_SECONDS", "30") or 30))
    browsers = BrowserRegistry(fake=os.environ.get("GA_BROWSER_FAKE") == "1")
    return {
        "data_dir": str(data),
        "auth": auth,
        "store": store,
        "pool": pool,
        "cli_store": cli_store,
        "cli_pool": cli_pool,
        "scheduler": scheduler,
        "browsers": browsers,
    }


def _web_dist_dir() -> Path:
    configured = os.environ.get("GA_WEB_DIST_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return code_path("web", "dist")


def create_app() -> FastAPI:
    settings = _settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        pool = settings.get("pool")
        cli_pool = settings.get("cli_pool")
        scheduler = settings.get("scheduler")
        if pool:
            pool.start()
        if cli_pool:
            cli_pool.start()
        if scheduler:
            scheduler.start()
        try:
            yield
        finally:
            if scheduler:
                scheduler.stop()
            if cli_pool:
                cli_pool.stop()
            if pool:
                pool.stop()
            settings["browsers"].close_all()

    app = FastAPI(title="GenericAgent Web", lifespan=lifespan)
    app.state.settings = settings

    allowed = [x.strip() for x in os.environ.get("GA_ALLOWED_ORIGINS", "*").split(",") if x.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed or ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def require_auth(authorization: str = Header(default="")) -> None:
        prefix = "Bearer "
        if not authorization.startswith(prefix):
            raise HTTPException(status_code=401, detail="missing token")
        if not settings["auth"].verify_token(authorization[len(prefix):]):
            raise HTTPException(status_code=401, detail="invalid token")

    def store() -> QueueStore:
        return settings["store"]

    def cli_store() -> CliAgentStore:
        return settings["cli_store"]

    def resource_error(exc: Exception) -> HTTPException:
        if isinstance(exc, ResourceError):
            return HTTPException(status_code=400, detail=str(exc))
        if isinstance(exc, FileNotFoundError):
            return HTTPException(status_code=404, detail="not found")
        return HTTPException(status_code=500, detail=str(exc))

    def cli_tool_payload(tool_id: str, cs: CliAgentStore) -> dict[str, Any]:
        spec = get_tool_spec(tool_id)
        row = cs.get_tool(tool_id) or {}
        payload = {
            "id": spec.id,
            "name": spec.name,
            "provider": spec.provider,
            "install_kind": spec.install_kind,
            "package": spec.package,
            "command": spec.command,
            "args_template": list(spec.args_template),
            "status": "missing",
            "requested_version": "",
            "resolved_version": "",
            "install_path": "",
            "command_path": "",
            "error": "",
        }
        payload.update(row)
        return payload

    @app.get("/api/health")
    def health():
        return {"ok": True}

    @app.post("/api/auth/login")
    def login(req: LoginRequest):
        try:
            return {"token": settings["auth"].issue_token(req.password)}
        except PermissionError:
            raise HTTPException(status_code=401, detail="invalid password")

    @app.get("/api/auth/me")
    def me(_: None = Depends(require_auth)):
        return {"authenticated": True}

    @app.get("/api/status")
    def status(_: None = Depends(require_auth)):
        return {
            "data_dir": settings["data_dir"],
            "configured": mykey_path().exists() or runtime_path("mykey.json").exists(),
            "worker_concurrency": int(os.environ.get("GA_WORKER_CONCURRENCY", "2") or 2),
            "cli_runner_concurrency": int(os.environ.get("GA_CLI_RUNNER_CONCURRENCY", "2") or 2),
        }

    @app.get("/api/workers")
    def workers(_: None = Depends(require_auth)):
        pool = settings.get("pool")
        return pool.status() if pool else []

    @app.post("/api/workers/{worker_id}/restart")
    def restart_worker(worker_id: str, _: None = Depends(require_auth)):
        pool = settings.get("pool")
        if not pool or not pool.restart_worker(worker_id):
            raise HTTPException(status_code=404, detail="worker not found")
        return {"ok": True}

    @app.get("/api/cli-tools")
    def list_cli_tools(_: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        return {"items": [cli_tool_payload(spec.id, cs) for spec in list_tool_specs()]}

    @app.get("/api/cli-tools/{tool_id}")
    def get_cli_tool(tool_id: str, _: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        try:
            return cli_tool_payload(tool_id, cs)
        except KeyError:
            raise HTTPException(status_code=404, detail="tool not found")

    @app.post("/api/cli-tools/{tool_id}/install")
    def install_cli_tool(tool_id: str, req: CliToolInstallPayload, _: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        try:
            return ToolInstaller(cs).install(tool_id, version=req.version)
        except KeyError:
            raise HTTPException(status_code=404, detail="tool not found")

    @app.post("/api/cli-tools/{tool_id}/test")
    def test_cli_tool(tool_id: str, _: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        try:
            get_tool_spec(tool_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="tool not found")
        return ToolInstaller(cs).test(tool_id)

    @app.delete("/api/cli-tools/{tool_id}")
    def delete_cli_tool(tool_id: str, _: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        if not cs.delete_tool(tool_id):
            raise HTTPException(status_code=404, detail="tool not installed")
        return {"ok": True}

    @app.get("/api/cli-env-profiles")
    def list_cli_env_profiles(_: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        return {"items": cs.list_env_profiles(mask_secrets=True)}

    @app.post("/api/cli-env-profiles")
    def create_cli_env_profile(req: CliEnvProfilePayload, _: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        try:
            get_tool_spec(req.tool_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="tool not found")
        return cs.create_env_profile(req.name, req.tool_id, req.env)

    @app.put("/api/cli-env-profiles/{profile_id}")
    def update_cli_env_profile(profile_id: str, req: CliEnvProfilePayload, _: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        profile = cs.update_env_profile(profile_id, req.name, req.tool_id, req.env)
        if not profile:
            raise HTTPException(status_code=404, detail="env profile not found")
        return profile

    @app.delete("/api/cli-env-profiles/{profile_id}")
    def delete_cli_env_profile(profile_id: str, _: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        if not cs.delete_env_profile(profile_id):
            raise HTTPException(status_code=404, detail="env profile not found")
        return {"ok": True}

    @app.get("/api/cli-runs")
    def list_cli_runs(_: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        return {"items": cs.list_runs()}

    @app.post("/api/cli-runs")
    def create_cli_run(req: CliRunCreatePayload, _: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        try:
            get_tool_spec(req.provider)
        except KeyError:
            raise HTTPException(status_code=404, detail="tool not found")
        return cs.create_run(
            provider=req.provider,
            prompt=req.prompt,
            target_workspace=req.target_workspace,
            write_intent=req.write_intent,
            policy=req.policy,
            env_profile_id=req.env_profile_id,
            parent_task_id=req.parent_task_id,
            parent_session_id=req.parent_session_id,
        )

    @app.get("/api/cli-runs/{run_id}")
    def get_cli_run(run_id: str, _: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        run = cs.get_run(run_id)
        if not run:
            raise HTTPException(status_code=404, detail="run not found")
        return run

    @app.post("/api/cli-runs/{run_id}/cancel")
    def cancel_cli_run(run_id: str, _: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        pool = settings.get("cli_pool")
        ok = pool.cancel_run(run_id) if pool else cs.request_cancel(run_id)
        if not ok:
            raise HTTPException(status_code=404, detail="run not found")
        return {"ok": True}

    @app.get("/api/cli-runs/{run_id}/events")
    def get_cli_run_events(run_id: str, after_seq: int = 0, limit: int = 200, _: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        if not cs.get_run(run_id):
            raise HTTPException(status_code=404, detail="run not found")
        return {"events": cs.events_after(run_id, after_seq, limit=limit)}

    @app.get("/api/cli-runs/{run_id}/diff")
    def get_cli_run_diff(run_id: str, _: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        run = cs.get_run(run_id)
        if not run:
            raise HTTPException(status_code=404, detail="run not found")
        diff_path = (run.get("result") or {}).get("diff_path") or runtime_path("agent-runs", run_id, "diff.patch")
        path = Path(diff_path)
        return {"run_id": run_id, "content": path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""}

    @app.get("/api/cli-runs/{run_id}/result")
    def get_cli_run_result(run_id: str, _: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        run = cs.get_run(run_id)
        if not run:
            raise HTTPException(status_code=404, detail="run not found")
        return run.get("result") or {}

    @app.get("/api/sessions/{session_id}/cli-runs")
    def session_cli_runs(session_id: str, _: None = Depends(require_auth), cs: CliAgentStore = Depends(cli_store)):
        return {"items": cs.list_runs_for_session(session_id)}

    @app.get("/api/config/llm")
    def get_llm_config(_: None = Depends(require_auth)):
        return load_llm_config(mask_secrets=True)

    @app.post("/api/config/models/fetch")
    def fetch_models(_: None = Depends(require_auth)):
        config = load_llm_config(mask_secrets=True)
        models = []
        for item in config.get("configs", []):
            data = item.get("data") or {}
            if data.get("model"):
                models.append({"var": item.get("var"), "model": data.get("model"), "kind": item.get("kind")})
        return {"models": models}

    @app.put("/api/config/llm")
    def put_llm_config(req: ConfigPayload, _: None = Depends(require_auth)):
        result = save_llm_config(req.model_dump())
        pool = settings.get("pool")
        if pool:
            pool.reload_config()
        return result

    @app.post("/api/runtime/reload")
    def runtime_reload(_: None = Depends(require_auth)):
        pool = settings.get("pool")
        if pool:
            pool.reload_config()
        return {"ok": True}

    @app.post("/api/sessions")
    def create_session(req: SessionCreate, _: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        return qs.create_session(req.title)

    @app.get("/api/sessions")
    def list_sessions(_: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        return qs.list_sessions()

    @app.patch("/api/sessions/{session_id}")
    def patch_session(session_id: str, req: SessionPatch, _: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        session = qs.update_session(session_id, title=req.title, llm_idx=req.llm_idx)
        if not session:
            raise HTTPException(status_code=404, detail="session not found")
        return session

    @app.delete("/api/sessions/{session_id}")
    def delete_session(session_id: str, _: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        if not qs.delete_session(session_id):
            raise HTTPException(status_code=404, detail="session not found")
        return {"ok": True}

    @app.get("/api/sessions/{session_id}/messages")
    def list_messages(session_id: str, _: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        if not qs.get_session(session_id):
            raise HTTPException(status_code=404, detail="session not found")
        return qs.list_messages(session_id)

    @app.post("/api/sessions/{session_id}/messages")
    def create_message(session_id: str, req: MessageCreate, _: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        if not qs.get_session(session_id):
            raise HTTPException(status_code=404, detail="session not found")
        max_queue = int(os.environ.get("GA_MAX_QUEUE_SIZE", "100") or 100)
        if qs.active_count() >= max_queue:
            raise HTTPException(status_code=429, detail="queue full")
        task_id = qs.enqueue_task("chat", session_id, {"text": req.content})
        qs.add_message(session_id, "user", req.content, task_id=task_id)
        return {"task_id": task_id, "status": "queued", "queue_position": qs.queue_position(task_id)}

    @app.get("/api/memory/files/{path:path}")
    def get_memory_file(path: str, _: None = Depends(require_auth)):
        try:
            return memory_file(path)
        except Exception as exc:
            raise resource_error(exc)

    @app.put("/api/memory/files/{path:path}")
    def put_memory_file(path: str, req: MemoryPayload, _: None = Depends(require_auth)):
        try:
            return write_memory_file(path, req.content)
        except Exception as exc:
            raise resource_error(exc)

    @app.get("/api/files")
    def get_files(root: str = "workspace", path: str = "", read: bool = False, _: None = Depends(require_auth)):
        try:
            return browse_files(root=root, path=path, read=read)
        except Exception as exc:
            raise resource_error(exc)

    @app.post("/api/files")
    def post_file(req: FilePayload, _: None = Depends(require_auth)):
        try:
            return write_file(req.root, req.path, req.content)
        except Exception as exc:
            raise resource_error(exc)

    @app.put("/api/files")
    def put_file(req: FilePayload, _: None = Depends(require_auth)):
        try:
            return write_file(req.root, req.path, req.content)
        except Exception as exc:
            raise resource_error(exc)

    @app.delete("/api/files")
    def remove_file(root: str = "workspace", path: str = "", _: None = Depends(require_auth)):
        try:
            return delete_file(root, path)
        except Exception as exc:
            raise resource_error(exc)

    @app.get("/api/schedules")
    def list_schedules(_: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        return {"items": qs.list_schedules()}

    @app.post("/api/schedules")
    def create_schedule(req: SchedulePayload, _: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        return qs.create_schedule(req.model_dump())

    @app.get("/api/schedules/reports")
    def schedule_reports(_: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        return {"items": qs.list_schedule_reports()}

    @app.put("/api/schedules/{schedule_id}")
    def update_schedule(schedule_id: str, req: SchedulePayload, _: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        schedule = qs.update_schedule(schedule_id, req.model_dump())
        if not schedule:
            raise HTTPException(status_code=404, detail="schedule not found")
        return schedule

    @app.delete("/api/schedules/{schedule_id}")
    def delete_schedule(schedule_id: str, _: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        if not qs.delete_schedule(schedule_id):
            raise HTTPException(status_code=404, detail="schedule not found")
        return {"ok": True}

    @app.post("/api/schedules/{schedule_id}/enqueue")
    def enqueue_schedule(schedule_id: str, _: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        task_id = qs.enqueue_schedule(schedule_id)
        if not task_id:
            raise HTTPException(status_code=404, detail="schedule not found")
        return {"task_id": task_id, "status": "queued", "queue_position": qs.queue_position(task_id)}

    @app.get("/api/logs")
    def logs(kind: str = "server", lines: int = 200, worker_id: str | None = None, _: None = Depends(require_auth)):
        try:
            return read_logs(kind, lines=lines, worker_id=worker_id)
        except Exception as exc:
            raise resource_error(exc)

    @app.get("/api/browser/workers/{worker_id}/tabs")
    def browser_tabs(worker_id: str, _: None = Depends(require_auth)):
        driver = settings["browsers"].get(worker_id)
        return {"worker_id": worker_id, "items": driver.get_all_sessions()}

    @app.post("/api/browser/workers/{worker_id}/tabs")
    def browser_new_tab(worker_id: str, req: BrowserTabCreate, _: None = Depends(require_auth)):
        driver = settings["browsers"].get(worker_id)
        return driver.newtab(req.url)

    @app.post("/api/browser/workers/{worker_id}/tabs/{tab_id}/navigate")
    def browser_navigate(worker_id: str, tab_id: str, req: BrowserNavigate, _: None = Depends(require_auth)):
        driver = settings["browsers"].get(worker_id)
        if hasattr(driver, "navigate"):
            return driver.navigate(tab_id, req.url)
        driver.default_session_id = tab_id
        return driver.jump(req.url)

    @app.post("/api/browser/workers/{worker_id}/tabs/{tab_id}/execute")
    def browser_execute(worker_id: str, tab_id: str, req: BrowserExecute, _: None = Depends(require_auth)):
        driver = settings["browsers"].get(worker_id)
        return driver.execute_js(req.code, timeout=req.timeout, session_id=tab_id)

    @app.get("/api/browser/workers/{worker_id}/tabs/{tab_id}/screenshot")
    def browser_screenshot(worker_id: str, tab_id: str, _: None = Depends(require_auth)):
        driver = settings["browsers"].get(worker_id)
        raw = driver.screenshot(tab_id)
        return {"content_type": "image/png", "base64": base64.b64encode(raw).decode("ascii")}

    @app.get("/api/tasks")
    def list_tasks(_: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        return qs.list_tasks()

    @app.get("/api/tasks/{task_id}")
    def get_task(task_id: str, _: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        task = qs.get_task(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="task not found")
        return task

    @app.get("/api/tasks/{task_id}/events")
    def get_events(task_id: str, after_seq: int = 0, _: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        if not qs.get_task(task_id):
            raise HTTPException(status_code=404, detail="task not found")
        return {"events": qs.events_after(task_id, after_seq)}

    @app.post("/api/tasks/{task_id}/cancel")
    def cancel_task(task_id: str, _: None = Depends(require_auth), qs: QueueStore = Depends(store)):
        if not qs.request_cancel(task_id):
            raise HTTPException(status_code=404, detail="task not found")
        pool = settings.get("pool")
        if pool:
            pool.cancel_task(task_id)
        return {"ok": True}

    @app.websocket("/ws/tasks/{task_id}")
    async def task_ws(websocket: WebSocket, task_id: str, token: str = "", after_seq: int = 0):
        if not settings["auth"].verify_token(token):
            await websocket.close(code=4401)
            return
        await websocket.accept()
        last_seq = int(after_seq or 0)
        try:
            while True:
                events = settings["store"].events_after(task_id, last_seq)
                for event in events:
                    last_seq = max(last_seq, int(event["seq"]))
                    await websocket.send_json(event)
                try:
                    await asyncio.wait_for(websocket.receive_text(), timeout=0.5)
                except asyncio.TimeoutError:
                    pass
        except WebSocketDisconnect:
            return

    @app.websocket("/ws/cli-runs/{run_id}")
    async def cli_run_ws(websocket: WebSocket, run_id: str, token: str = "", after_seq: int = 0):
        if not settings["auth"].verify_token(token):
            await websocket.close(code=4401)
            return
        await websocket.accept()
        last_seq = int(after_seq or 0)
        try:
            while True:
                events = settings["cli_store"].events_after(run_id, last_seq)
                for event in events:
                    last_seq = max(last_seq, int(event["seq"]))
                    await websocket.send_json(event)
                try:
                    await asyncio.wait_for(websocket.receive_text(), timeout=0.5)
                except asyncio.TimeoutError:
                    pass
        except WebSocketDisconnect:
            return

    web_dist = _web_dist_dir()
    assets_dir = web_dist / "assets"
    index_html = web_dist / "index.html"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(status_code=404, detail="not found")
        if not index_html.exists():
            raise HTTPException(status_code=404, detail="web frontend is not built")
        target = (web_dist / full_path).resolve() if full_path else index_html
        try:
            target.relative_to(web_dist.resolve())
        except ValueError:
            target = index_html
        if target.is_file() and target.name != "index.html":
            return FileResponse(str(target))
        return FileResponse(str(index_html))

    return app


app = create_app()
