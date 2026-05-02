from __future__ import annotations

import os
import shutil
from pathlib import Path

CODE_DIR = Path(__file__).resolve().parent


def data_dir() -> Path:
    configured = os.environ.get("GA_DATA_DIR", "").strip()
    return Path(configured).expanduser().resolve() if configured else CODE_DIR


def code_path(*parts: str) -> Path:
    return CODE_DIR.joinpath(*parts)


def runtime_path(*parts: str) -> Path:
    return data_dir().joinpath(*parts)


def temp_path(*parts: str) -> Path:
    configured = os.environ.get("GA_WORKER_TEMP_DIR", "").strip()
    base = Path(configured).expanduser().resolve() if configured else runtime_path("temp")
    return base.joinpath(*parts)


def mykey_path() -> Path:
    configured = os.environ.get("GA_MYKEY_PATH", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return runtime_path("mykey.py")


def ensure_runtime_dirs() -> None:
    for name in ("temp", "memory", "sche_tasks", "workspace", "workers", "browser", "tools", "tool-auth", "agent-runs"):
        runtime_path(name).mkdir(parents=True, exist_ok=True)


def seed_memory_if_needed() -> None:
    src = code_path("memory")
    dst = runtime_path("memory")
    if not src.is_dir():
        return
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.rglob("*"):
        rel = item.relative_to(src)
        target = dst / rel
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)


def ensure_runtime_layout() -> None:
    ensure_runtime_dirs()
    seed_memory_if_needed()
