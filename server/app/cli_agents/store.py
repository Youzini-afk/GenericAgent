from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

FINAL_STATUSES = {"succeeded", "failed", "canceled", "interrupted"}
ACTIVE_STATUSES = {"pending", "preparing", "running"}
SECRET_MARKERS = ("key", "token", "secret", "password", "credential", "cookie")
DEFAULT_PROVIDER_PROFILES = {
    "codex": {
        "strengths": ["large_refactor", "complex_code_understanding"],
        "weaknesses": [],
        "recent_success": 0,
        "recent_failure": 0,
        "notes": [],
    },
    "claude_code": {
        "strengths": ["frontend", "context_judgement", "review"],
        "weaknesses": [],
        "recent_success": 0,
        "recent_failure": 0,
        "notes": [],
    },
    "opencode": {
        "strengths": ["ordinary_implementation", "small_medium_tasks"],
        "weaknesses": [],
        "recent_success": 0,
        "recent_failure": 0,
        "notes": [],
    },
    "custom_shell": {
        "strengths": ["verify", "script", "fallback"],
        "weaknesses": [],
        "recent_success": 0,
        "recent_failure": 0,
        "notes": [],
    },
}


class CliAgentStore:
    def __init__(self, db_path: str | os.PathLike[str]):
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS cli_tools (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    install_kind TEXT NOT NULL,
                    requested_version TEXT NOT NULL,
                    resolved_version TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    install_path TEXT NOT NULL,
                    command_path TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    error TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS cli_env_profiles (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    tool_id TEXT NOT NULL,
                    env_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS cli_runs (
                    id TEXT PRIMARY KEY,
                    parent_task_id TEXT,
                    parent_session_id TEXT,
                    provider TEXT NOT NULL,
                    target_workspace TEXT NOT NULL,
                    effective_workspace TEXT NOT NULL,
                    workspace_mode TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    status TEXT NOT NULL,
                    policy_json TEXT NOT NULL,
                    env_profile_id TEXT,
                    result_json TEXT NOT NULL DEFAULT '{}',
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    started_at REAL,
                    finished_at REAL,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    error TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_cli_runs_status_created ON cli_runs(status, created_at);
                CREATE INDEX IF NOT EXISTS idx_cli_runs_parent_session ON cli_runs(parent_session_id, created_at);
                CREATE TABLE IF NOT EXISTS cli_run_events (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_cli_events_run_seq ON cli_run_events(run_id, seq);
                CREATE TABLE IF NOT EXISTS workspace_locks (
                    workspace_key TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    created_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS cli_provider_profiles (
                    provider TEXT PRIMARY KEY,
                    strengths_json TEXT NOT NULL,
                    weaknesses_json TEXT NOT NULL,
                    recent_success INTEGER NOT NULL DEFAULT 0,
                    recent_failure INTEGER NOT NULL DEFAULT 0,
                    notes_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS task_events (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at REAL NOT NULL
                );
                """
            )

    @staticmethod
    def _json(data: Any) -> str:
        return json.dumps(data if data is not None else {}, ensure_ascii=False)

    @staticmethod
    def _mask_env(env: dict[str, Any]) -> dict[str, Any]:
        masked: dict[str, Any] = {}
        for key, value in (env or {}).items():
            if any(marker in str(key).lower() for marker in SECRET_MARKERS):
                masked[key] = "********" if value not in (None, "") else ""
            else:
                masked[key] = value
        return masked

    @classmethod
    def _tool_row(cls, row: sqlite3.Row | None) -> dict[str, Any] | None:
        return dict(row) if row is not None else None

    @classmethod
    def _env_row(cls, row: sqlite3.Row | None, mask_secrets: bool = True) -> dict[str, Any] | None:
        if row is None:
            return None
        data = dict(row)
        env = json.loads(data.pop("env_json") or "{}")
        data["env"] = cls._mask_env(env) if mask_secrets else env
        return data

    @staticmethod
    def _run_row(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        data = dict(row)
        data["policy"] = json.loads(data.pop("policy_json") or "{}")
        data["result"] = json.loads(data.pop("result_json") or "{}")
        data["cancel_requested"] = bool(data.get("cancel_requested"))
        return data

    @staticmethod
    def _event_row(row: sqlite3.Row) -> dict[str, Any]:
        data = dict(row)
        data["payload"] = json.loads(data.pop("payload_json") or "{}")
        return data

    @staticmethod
    def _provider_profile_row(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        data = dict(row)
        data["strengths"] = json.loads(data.pop("strengths_json") or "[]")
        data["weaknesses"] = json.loads(data.pop("weaknesses_json") or "[]")
        data["notes"] = json.loads(data.pop("notes_json") or "[]")
        return data

    @staticmethod
    def _unique_list(values: list[Any]) -> list[str]:
        result: list[str] = []
        for value in values or []:
            text = str(value or "").strip()
            if text and text not in result:
                result.append(text)
        return result

    def ensure_provider_profiles(self) -> None:
        now = time.time()
        with self._connect() as conn:
            for provider, profile in DEFAULT_PROVIDER_PROFILES.items():
                existing = conn.execute("SELECT provider FROM cli_provider_profiles WHERE provider=?", (provider,)).fetchone()
                if existing:
                    continue
                conn.execute(
                    """
                    INSERT INTO cli_provider_profiles(
                        provider, strengths_json, weaknesses_json, recent_success,
                        recent_failure, notes_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        provider,
                        self._json(profile["strengths"]),
                        self._json(profile["weaknesses"]),
                        int(profile["recent_success"]),
                        int(profile["recent_failure"]),
                        self._json(profile["notes"]),
                        now,
                        now,
                    ),
                )

    def list_provider_profiles(self) -> list[dict[str, Any]]:
        self.ensure_provider_profiles()
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM cli_provider_profiles ORDER BY provider ASC").fetchall()
            return [self._provider_profile_row(row) for row in rows]

    def get_provider_profile(self, provider: str) -> dict[str, Any] | None:
        self.ensure_provider_profiles()
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM cli_provider_profiles WHERE provider=?", (provider,)).fetchone()
            return self._provider_profile_row(row)

    def set_provider_profile(
        self,
        provider: str,
        *,
        strengths: list[Any] | None = None,
        weaknesses: list[Any] | None = None,
        recent_success: int | None = None,
        recent_failure: int | None = None,
        notes: list[Any] | None = None,
    ) -> dict[str, Any] | None:
        profile = self.get_provider_profile(provider)
        if not profile:
            return None
        next_strengths = self._unique_list(strengths if strengths is not None else profile.get("strengths", []))
        next_weaknesses = self._unique_list(weaknesses if weaknesses is not None else profile.get("weaknesses", []))
        next_notes = self._unique_list(notes if notes is not None else profile.get("notes", []))[-20:]
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE cli_provider_profiles
                SET strengths_json=?, weaknesses_json=?, recent_success=?,
                    recent_failure=?, notes_json=?, updated_at=?
                WHERE provider=?
                """,
                (
                    self._json(next_strengths),
                    self._json(next_weaknesses),
                    int(recent_success if recent_success is not None else profile.get("recent_success", 0)),
                    int(recent_failure if recent_failure is not None else profile.get("recent_failure", 0)),
                    self._json(next_notes),
                    now,
                    provider,
                ),
            )
        return self.get_provider_profile(provider)

    def update_provider_profile(
        self,
        provider: str,
        task_tags: list[Any] | None,
        outcome: str,
        note: str = "",
    ) -> dict[str, Any] | None:
        profile = self.get_provider_profile(provider)
        if not profile:
            return None
        tags = self._unique_list(list(task_tags or []))
        outcome_text = str(outcome or "").lower()
        strengths = list(profile.get("strengths") or [])
        weaknesses = list(profile.get("weaknesses") or [])
        recent_success = int(profile.get("recent_success") or 0)
        recent_failure = int(profile.get("recent_failure") or 0)
        if outcome_text in {"success", "succeeded", "ok"}:
            recent_success += 1
            strengths = self._unique_list([*strengths, *tags])
        elif outcome_text in {"failure", "failed", "interrupted", "blocked", "canceled"}:
            recent_failure += 1
            weaknesses = self._unique_list([*weaknesses, *tags])
        notes = list(profile.get("notes") or [])
        if str(note or "").strip():
            notes.append(str(note).strip())
        return self.set_provider_profile(
            provider,
            strengths=strengths,
            weaknesses=weaknesses,
            recent_success=recent_success,
            recent_failure=recent_failure,
            notes=notes,
        )

    def list_tools(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            return [dict(row) for row in conn.execute("SELECT * FROM cli_tools ORDER BY id ASC").fetchall()]

    def get_tool(self, tool_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            return self._tool_row(conn.execute("SELECT * FROM cli_tools WHERE id=?", (tool_id,)).fetchone())

    def upsert_tool(
        self,
        *,
        tool_id: str,
        name: str,
        provider: str,
        install_kind: str,
        requested_version: str,
        resolved_version: str = "",
        status: str,
        install_path: str,
        command_path: str,
        error: str = "",
    ) -> dict[str, Any]:
        now = time.time()
        with self._connect() as conn:
            existing = conn.execute("SELECT created_at FROM cli_tools WHERE id=?", (tool_id,)).fetchone()
            created_at = float(existing["created_at"]) if existing else now
            conn.execute(
                """
                INSERT OR REPLACE INTO cli_tools(
                    id, name, provider, install_kind, requested_version, resolved_version,
                    status, install_path, command_path, created_at, updated_at, error
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tool_id,
                    name,
                    provider,
                    install_kind,
                    requested_version,
                    resolved_version or "",
                    status,
                    install_path,
                    command_path,
                    created_at,
                    now,
                    error or "",
                ),
            )
        return self.get_tool(tool_id)

    def delete_tool(self, tool_id: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM cli_tools WHERE id=?", (tool_id,))
            return bool(cur.rowcount)

    def create_env_profile(self, name: str, tool_id: str, env: dict[str, Any]) -> dict[str, Any]:
        profile_id = str(uuid.uuid4())
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO cli_env_profiles(id, name, tool_id, env_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (profile_id, str(name or "").strip() or "Env profile", tool_id, self._json(env), now, now),
            )
        return self.get_env_profile(profile_id)

    def get_env_profile(self, profile_id: str, mask_secrets: bool = True) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM cli_env_profiles WHERE id=?", (profile_id,)).fetchone()
            return self._env_row(row, mask_secrets=mask_secrets)

    def list_env_profiles(self, mask_secrets: bool = True) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM cli_env_profiles ORDER BY updated_at DESC").fetchall()
            return [self._env_row(row, mask_secrets=mask_secrets) for row in rows]

    def update_env_profile(self, profile_id: str, name: str, tool_id: str, env: dict[str, Any]) -> dict[str, Any] | None:
        if not self.get_env_profile(profile_id, mask_secrets=False):
            return None
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                "UPDATE cli_env_profiles SET name=?, tool_id=?, env_json=?, updated_at=? WHERE id=?",
                (str(name or "").strip() or "Env profile", tool_id, self._json(env), now, profile_id),
            )
        return self.get_env_profile(profile_id)

    def delete_env_profile(self, profile_id: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM cli_env_profiles WHERE id=?", (profile_id,))
            return bool(cur.rowcount)

    def create_run(
        self,
        *,
        provider: str,
        prompt: str,
        target_workspace: str | None,
        write_intent: bool,
        policy: dict[str, Any] | None,
        env_profile_id: str | None = None,
        parent_task_id: str | None = None,
        parent_session_id: str | None = None,
    ) -> dict[str, Any]:
        run_id = str(uuid.uuid4())
        now = time.time()
        merged_policy = dict(policy or {})
        merged_policy["write_intent"] = bool(write_intent)
        workspace = str(target_workspace or os.environ.get("GA_CLI_DEFAULT_WORKSPACE") or "")
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO cli_runs(
                    id, parent_task_id, parent_session_id, provider, target_workspace,
                    effective_workspace, workspace_mode, prompt, status, policy_json,
                    env_profile_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, '', '', ?, 'pending', ?, ?, ?, ?)
                """,
                (
                    run_id,
                    parent_task_id,
                    parent_session_id,
                    provider,
                    workspace,
                    str(prompt or ""),
                    self._json(merged_policy),
                    env_profile_id,
                    now,
                    now,
                ),
            )
        self.append_event(run_id, "status", {"status": "pending"})
        self._emit_parent_event(run_id, "cli_run_started", {"run_id": run_id, "provider": provider, "status": "pending"})
        return self.get_run(run_id)

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            return self._run_row(conn.execute("SELECT * FROM cli_runs WHERE id=?", (run_id,)).fetchone())

    def list_runs(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM cli_runs ORDER BY created_at DESC LIMIT ?", (int(limit),)).fetchall()
            return [self._run_row(row) for row in rows if row is not None]

    def list_runs_for_session(self, session_id: str, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM cli_runs WHERE parent_session_id=? ORDER BY created_at DESC LIMIT ?",
                (session_id, int(limit)),
            ).fetchall()
            return [self._run_row(row) for row in rows if row is not None]

    def update_run_workspace(self, run_id: str, workspace_mode: str, effective_workspace: str) -> dict[str, Any] | None:
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                "UPDATE cli_runs SET workspace_mode=?, effective_workspace=?, updated_at=? WHERE id=?",
                (workspace_mode, effective_workspace, now, run_id),
            )
        return self.get_run(run_id)

    def lease_next_run(self, runner_id: str) -> dict[str, Any] | None:
        now = time.time()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT * FROM cli_runs WHERE status='pending' AND cancel_requested=0 ORDER BY created_at ASC LIMIT 1"
            ).fetchone()
            if row is None:
                conn.execute("COMMIT")
                return None
            conn.execute(
                "UPDATE cli_runs SET status='preparing', updated_at=? WHERE id=? AND status='pending'",
                (now, row["id"]),
            )
            self.append_event(row["id"], "status", {"status": "preparing", "runner_id": runner_id}, conn=conn)
            self._emit_parent_event(row["id"], "cli_run_status", {"run_id": row["id"], "status": "preparing"}, conn=conn)
            conn.execute("COMMIT")
        return self.get_run(row["id"])

    def mark_run_preparing(self, run_id: str) -> None:
        self._set_status(run_id, "preparing")

    def mark_run_running(self, run_id: str) -> None:
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE cli_runs
                SET status='running', started_at=COALESCE(started_at, ?), updated_at=?
                WHERE id=? AND status IN ('pending','preparing','running')
                """,
                (now, now, run_id),
            )
            self.append_event(run_id, "status", {"status": "running"}, conn=conn)
            self._emit_parent_event(run_id, "cli_run_status", {"run_id": run_id, "status": "running"}, conn=conn)

    def _set_status(self, run_id: str, status: str, error: str = "") -> None:
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                "UPDATE cli_runs SET status=?, error=?, updated_at=? WHERE id=?",
                (status, error or "", now, run_id),
            )
            self.append_event(run_id, "status", {"status": status, "error": error}, conn=conn)
            self._emit_parent_event(run_id, "cli_run_status", {"run_id": run_id, "status": status, "error": error}, conn=conn)

    def finish_run(self, run_id: str, status: str, result: dict[str, Any] | None = None, error: str = "") -> None:
        if status not in FINAL_STATUSES:
            raise ValueError(f"invalid final status: {status}")
        now = time.time()
        result = result or {}
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE cli_runs
                SET status=?, result_json=?, error=?, finished_at=?, updated_at=?
                WHERE id=? AND status NOT IN ('succeeded','failed','canceled','interrupted')
                """,
                (status, self._json(result), error or "", now, now, run_id),
            )
            self.append_event(run_id, "result", result, conn=conn)
            event_type = "done" if status == "succeeded" else "error"
            self.append_event(run_id, event_type, {"status": status, "error": error or ""}, conn=conn)
            parent_type = "cli_run_done" if status == "succeeded" else "cli_run_error"
            self._emit_parent_event(run_id, parent_type, {"run_id": run_id, "status": status, "error": error or "", "result": result}, conn=conn)

    def request_cancel(self, run_id: str) -> bool:
        run = self.get_run(run_id)
        if not run:
            return False
        now = time.time()
        with self._connect() as conn:
            if run["status"] == "pending":
                conn.execute(
                    """
                    UPDATE cli_runs
                    SET status='canceled', cancel_requested=1, finished_at=?, updated_at=?
                    WHERE id=? AND status='pending'
                    """,
                    (now, now, run_id),
                )
                self.append_event(run_id, "status", {"status": "canceled", "cancel_requested": True}, conn=conn)
                self.append_event(run_id, "done", {"status": "canceled"}, conn=conn)
                self._emit_parent_event(run_id, "cli_run_error", {"run_id": run_id, "status": "canceled"}, conn=conn)
                return True
            if run["status"] in {"preparing", "running"}:
                conn.execute("UPDATE cli_runs SET cancel_requested=1, updated_at=? WHERE id=?", (now, run_id))
                self.append_event(run_id, "status", {"status": run["status"], "cancel_requested": True}, conn=conn)
                return True
        return False

    def append_event(self, run_id: str, event_type: str, payload: dict[str, Any], conn: sqlite3.Connection | None = None) -> int:
        own_conn = conn is None
        if own_conn:
            conn = self._connect()
        assert conn is not None
        now = time.time()
        cur = conn.execute(
            "INSERT INTO cli_run_events(run_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)",
            (run_id, event_type, self._json(payload), now),
        )
        seq = int(cur.lastrowid)
        if own_conn:
            conn.close()
        return seq

    def events_after(self, run_id: str, after_seq: int = 0, limit: int = 200) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM cli_run_events WHERE run_id=? AND seq>? ORDER BY seq ASC LIMIT ?",
                (run_id, int(after_seq or 0), int(limit or 200)),
            ).fetchall()
            return [self._event_row(row) for row in rows]

    @staticmethod
    def _workspace_key(path: str) -> str:
        resolved = str(Path(path).expanduser().resolve())
        return resolved.lower() if os.name == "nt" else resolved

    def get_workspace_lock(self, path: str) -> dict[str, Any] | None:
        key = self._workspace_key(path)
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM workspace_locks WHERE workspace_key=?", (key,)).fetchone()
            return dict(row) if row is not None else None

    def try_acquire_workspace_lock(self, path: str, run_id: str, mode: str = "write") -> bool:
        key = self._workspace_key(path)
        now = time.time()
        with self._connect() as conn:
            try:
                conn.execute(
                    "INSERT INTO workspace_locks(workspace_key, run_id, mode, created_at) VALUES (?, ?, ?, ?)",
                    (key, run_id, mode, now),
                )
                return True
            except sqlite3.IntegrityError:
                row = conn.execute("SELECT run_id FROM workspace_locks WHERE workspace_key=?", (key,)).fetchone()
                return bool(row and row["run_id"] == run_id)

    def release_workspace_lock(self, run_id: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM workspace_locks WHERE run_id=?", (run_id,))

    def recover_interrupted(self) -> int:
        now = time.time()
        with self._connect() as conn:
            rows = conn.execute("SELECT id FROM cli_runs WHERE status IN ('preparing','running')").fetchall()
            for row in rows:
                conn.execute(
                    """
                    UPDATE cli_runs
                    SET status='interrupted', error='backend restarted', finished_at=?, updated_at=?
                    WHERE id=?
                    """,
                    (now, now, row["id"]),
                )
                conn.execute("DELETE FROM workspace_locks WHERE run_id=?", (row["id"],))
                self.append_event(row["id"], "error", {"status": "interrupted", "error": "backend restarted"}, conn=conn)
            return len(rows)

    def _emit_parent_event(
        self,
        run_id: str,
        event_type: str,
        payload: dict[str, Any],
        conn: sqlite3.Connection | None = None,
    ) -> None:
        own_conn = conn is None
        if own_conn:
            conn = self._connect()
        assert conn is not None
        run = conn.execute("SELECT parent_task_id FROM cli_runs WHERE id=?", (run_id,)).fetchone()
        parent_task_id = run["parent_task_id"] if run else None
        if parent_task_id:
            conn.execute(
                "INSERT INTO task_events(task_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)",
                (parent_task_id, event_type, self._json(payload), time.time()),
            )
        if own_conn:
            conn.close()
