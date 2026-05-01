from __future__ import annotations

import base64
import os
import shutil
from pathlib import Path
from typing import Any

from runtime_paths import runtime_path

ALLOWED_FILE_ROOTS = {
    "workspace": "workspace",
    "temp": "temp",
    "memory": "memory",
}

LOG_PATHS = {
    "server": ("server.log",),
    "scheduler": ("sche_tasks", "scheduler.log"),
    "browser": ("browser", "browser.log"),
    "agent": ("temp", "model_responses"),
}


class ResourceError(ValueError):
    pass


def _safe_join(base: Path, rel_path: str | None) -> Path:
    rel = str(rel_path or "").strip().replace("\\", "/")
    if rel.startswith("/") or rel.startswith("~"):
        raise ResourceError("absolute paths are not allowed")
    root = base.resolve()
    target = (root / rel).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ResourceError("path escapes allowed root") from exc
    return target


def _relative(base: Path, target: Path) -> str:
    return target.resolve().relative_to(base.resolve()).as_posix()


def memory_file(path: str) -> dict[str, Any]:
    base = runtime_path("memory")
    target = _safe_join(base, path)
    if not target.exists() or not target.is_file():
        raise FileNotFoundError(path)
    return {"path": _relative(base, target), "content": target.read_text(encoding="utf-8", errors="replace")}


def write_memory_file(path: str, content: str) -> dict[str, Any]:
    base = runtime_path("memory")
    target = _safe_join(base, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(str(content or ""), encoding="utf-8")
    return {"path": _relative(base, target), "size": target.stat().st_size}


def _file_root(name: str) -> Path:
    key = str(name or "workspace").strip()
    if key not in ALLOWED_FILE_ROOTS:
        raise ResourceError("unsupported root")
    return runtime_path(ALLOWED_FILE_ROOTS[key])


def _metadata(base: Path, path: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "name": path.name,
        "path": _relative(base, path),
        "is_dir": path.is_dir(),
        "size": 0 if path.is_dir() else stat.st_size,
        "updated_at": stat.st_mtime,
    }


def browse_files(root: str, path: str = "", read: bool = False) -> dict[str, Any]:
    base = _file_root(root)
    base.mkdir(parents=True, exist_ok=True)
    target = _safe_join(base, path)
    if read:
        if not target.exists() or not target.is_file():
            raise FileNotFoundError(path)
        return {
            "root": root,
            "path": _relative(base, target),
            "content": target.read_text(encoding="utf-8", errors="replace"),
            "item": _metadata(base, target),
        }
    if not target.exists():
        raise FileNotFoundError(path)
    if target.is_file():
        return {"root": root, "path": _relative(base, target), "item": _metadata(base, target)}
    items = sorted((_metadata(base, child) for child in target.iterdir()), key=lambda x: (not x["is_dir"], x["name"].lower()))
    return {"root": root, "path": _relative(base, target) if target != base else "", "items": items}


def write_file(root: str, path: str, content: str) -> dict[str, Any]:
    base = _file_root(root)
    target = _safe_join(base, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(str(content or ""), encoding="utf-8")
    return {"root": root, "path": _relative(base, target), "item": _metadata(base, target)}


def delete_file(root: str, path: str) -> dict[str, Any]:
    base = _file_root(root)
    target = _safe_join(base, path)
    if not target.exists():
        raise FileNotFoundError(path)
    rel = _relative(base, target)
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    return {"root": root, "path": rel, "deleted": True}


def _tail_file(path: Path, lines: int) -> str:
    if not path.exists() or not path.is_file():
        return ""
    with path.open("r", encoding="utf-8", errors="replace") as f:
        content = f.readlines()
    return "".join(content[-max(1, int(lines)) :])


def read_logs(kind: str, lines: int = 200, worker_id: str | None = None) -> dict[str, Any]:
    safe_kind = str(kind or "server").strip()
    if safe_kind == "worker":
        root = runtime_path("workers")
        if worker_id:
            path = _safe_join(root, f"{worker_id}/worker.log")
            return {"kind": safe_kind, "content": _tail_file(path, lines), "paths": [str(path)]}
        paths = sorted(root.glob("*/worker.log"))
        return {"kind": safe_kind, "content": "\n".join(_tail_file(p, lines) for p in paths), "paths": [str(p) for p in paths]}
    if safe_kind not in LOG_PATHS:
        raise ResourceError("unsupported log kind")
    target = runtime_path(*LOG_PATHS[safe_kind])
    if target.is_dir():
        paths = sorted(target.glob("*"), key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)[:5]
        return {"kind": safe_kind, "content": "\n".join(_tail_file(p, lines) for p in paths), "paths": [str(p) for p in paths]}
    return {"kind": safe_kind, "content": _tail_file(target, lines), "paths": [str(target)]}


def encode_file_base64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")
