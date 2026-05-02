from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

from runtime_paths import runtime_path
from server.app.cli_agents.store import CliAgentStore

IGNORED_COPY_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", ".mypy_cache", ".pytest_cache", "dist", "build"}


def cli_runs_dir() -> Path:
    return Path(os.environ.get("GA_CLI_RUNS_DIR") or runtime_path("agent-runs")).expanduser().resolve()


def default_workspace() -> Path:
    return Path(os.environ.get("GA_CLI_DEFAULT_WORKSPACE") or runtime_path("workspace")).expanduser().resolve()


def _split_allowed(text: str) -> list[str]:
    items: list[str] = []
    for chunk in str(text or "").replace(",", os.pathsep).split(os.pathsep):
        chunk = chunk.strip()
        if chunk:
            items.append(chunk)
    return items


def allowed_workspace_roots() -> list[Path]:
    configured = _split_allowed(os.environ.get("GA_CLI_ALLOWED_WORKSPACES", ""))
    roots = [Path(item).expanduser().resolve() for item in configured]
    base = default_workspace()
    data_workspace = runtime_path("workspace").resolve()
    for item in (base, data_workspace):
        if item not in roots:
            roots.append(item)
    return roots


def validate_workspace(path: str | None) -> Path:
    target = Path(path or str(default_workspace())).expanduser().resolve()
    roots = allowed_workspace_roots()
    for root in roots:
        try:
            target.relative_to(root)
            return target
        except ValueError:
            continue
    allowed = ", ".join(str(root) for root in roots)
    raise ValueError(f"target workspace is outside allowed roots: {allowed}")


def _copy_ignore(_directory: str, names: list[str]) -> set[str]:
    return {name for name in names if name in IGNORED_COPY_DIRS}


class WorkspaceManager:
    def __init__(self, store: CliAgentStore):
        self.store = store

    def prepare(self, run: dict[str, Any]) -> dict[str, Any]:
        target = validate_workspace(run.get("target_workspace"))
        target.mkdir(parents=True, exist_ok=True)
        policy = run.get("policy") or {}
        write_intent = bool(policy.get("write_intent", True))
        allow_write = bool(policy.get("allow_write", True))
        wants_write = write_intent and allow_write

        if not wants_write:
            return self.store.update_run_workspace(run["id"], "direct", str(target))

        lock = self.store.get_workspace_lock(str(target))
        if lock and lock.get("run_id") != run["id"]:
            copied = self._copy_workspace(run["id"], target)
            return self.store.update_run_workspace(run["id"], "copy", str(copied))

        if self.store.try_acquire_workspace_lock(str(target), run["id"], mode="write"):
            return self.store.update_run_workspace(run["id"], "direct", str(target))

        copied = self._copy_workspace(run["id"], target)
        return self.store.update_run_workspace(run["id"], "copy", str(copied))

    def release(self, run_id: str) -> None:
        self.store.release_workspace_lock(run_id)

    def run_dir(self, run_id: str) -> Path:
        return cli_runs_dir() / run_id

    def _copy_workspace(self, run_id: str, target: Path) -> Path:
        destination = self.run_dir(run_id) / "workspace"
        if destination.exists():
            shutil.rmtree(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(target, destination, ignore=_copy_ignore)
        return destination.resolve()

