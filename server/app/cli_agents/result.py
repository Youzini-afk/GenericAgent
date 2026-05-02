from __future__ import annotations

import difflib
import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any

IGNORED_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", ".mypy_cache", ".pytest_cache", "dist", "build"}
TEXT_LIMIT = 512_000


def _iter_files(root: Path):
    for current, dirs, files in os.walk(root):
        dirs[:] = [name for name in dirs if name not in IGNORED_DIRS]
        base = Path(current)
        for name in files:
            path = base / name
            try:
                rel = path.relative_to(root).as_posix()
            except ValueError:
                continue
            yield rel, path


def _decode_text(raw: bytes) -> str | None:
    if b"\x00" in raw:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return raw.decode("utf-8", errors="replace")
        except Exception:
            return None


def _file_entry(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    entry: dict[str, Any] = {"sha256": hashlib.sha256(raw).hexdigest(), "size": len(raw)}
    if len(raw) <= TEXT_LIMIT:
        text = _decode_text(raw)
        if text is not None:
            entry["text"] = text
    return entry


def create_baseline(workspace: str | os.PathLike[str], baseline_path: str | os.PathLike[str]) -> dict[str, Any]:
    root = Path(workspace).resolve()
    baseline = {"root": str(root), "files": {}}
    for rel, path in _iter_files(root):
        try:
            baseline["files"][rel] = _file_entry(path)
        except OSError:
            continue
    target = Path(baseline_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(baseline, ensure_ascii=False, indent=2), encoding="utf-8")
    return baseline


def _current_snapshot(root: Path) -> dict[str, Any]:
    files = {}
    for rel, path in _iter_files(root):
        try:
            files[rel] = _file_entry(path)
        except OSError:
            continue
    return files


def collect_diff(
    workspace: str | os.PathLike[str],
    baseline_path: str | os.PathLike[str],
    diff_path: str | os.PathLike[str],
) -> dict[str, Any]:
    root = Path(workspace).resolve()
    baseline = json.loads(Path(baseline_path).read_text(encoding="utf-8"))
    before = baseline.get("files") or {}
    after = _current_snapshot(root)
    changed: list[str] = []
    patch_parts: list[str] = []

    for rel in sorted(set(before) | set(after)):
        old = before.get(rel)
        new = after.get(rel)
        if old and new and old.get("sha256") == new.get("sha256"):
            continue
        changed.append(rel)
        old_text = "" if old is None else old.get("text")
        new_text = "" if new is None else new.get("text")
        if old_text is None or new_text is None:
            status = "created" if old is None else "deleted" if new is None else "modified"
            patch_parts.append(f"Binary or large file {status}: {rel}\n")
            continue
        patch_parts.extend(
            difflib.unified_diff(
                old_text.splitlines(keepends=True),
                new_text.splitlines(keepends=True),
                fromfile=f"a/{rel}",
                tofile=f"b/{rel}",
            )
        )
        if patch_parts and not str(patch_parts[-1]).endswith("\n"):
            patch_parts.append("\n")

    patch_text = "".join(patch_parts)
    if not patch_text:
        patch_text = _git_diff(root)
    target = Path(diff_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(patch_text, encoding="utf-8")
    return {"changed_files": changed, "diff_path": str(target), "patch": patch_text}


def _git_diff(root: Path) -> str:
    if not (root / ".git").exists():
        return ""
    try:
        result = subprocess.run(
            ["git", "diff", "--binary"],
            cwd=str(root),
            text=True,
            capture_output=True,
            timeout=20,
        )
        return result.stdout if result.returncode == 0 else ""
    except Exception:
        return ""


def tail_file(path: str | os.PathLike[str], limit: int = 4000) -> str:
    target = Path(path)
    if not target.exists() or not target.is_file():
        return ""
    raw = target.read_bytes()
    return raw[-max(1, int(limit)) :].decode("utf-8", errors="replace")

