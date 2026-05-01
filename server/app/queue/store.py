from __future__ import annotations

import json
import os
import re
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

FINAL_STATUSES = {"succeeded", "failed", "canceled", "interrupted"}
ACTIVE_STATUSES = {"pending", "leased", "running"}


class QueueStore:
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
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    leased_by TEXT,
                    lease_until REAL,
                    started_at REAL,
                    finished_at REAL,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    error TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at);
                CREATE INDEX IF NOT EXISTS idx_tasks_session_created ON tasks(session_id, created_at);
                CREATE TABLE IF NOT EXISTS task_events (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_events_task_seq ON task_events(task_id, seq);
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    llm_idx INTEGER NOT NULL DEFAULT 0,
                    agent_history_json TEXT NOT NULL DEFAULT '[]',
                    backend_history_json TEXT NOT NULL DEFAULT '[]'
                );
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    task_id TEXT,
                    created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);
                CREATE TABLE IF NOT EXISTS schedules (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    cron TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    last_task_id TEXT,
                    last_run_at REAL,
                    next_run_at REAL
                );
                CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled, updated_at);
                """
            )
            self._ensure_column(conn, "schedules", "next_run_at", "REAL")

    @staticmethod
    def _ensure_column(conn: sqlite3.Connection, table: str, column: str, decl: str) -> None:
        columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")

    @staticmethod
    def _next_schedule_run(cron: str, after: float | None = None) -> float | None:
        base = float(after if after is not None else time.time())
        text = str(cron or "").strip().lower()
        if not text or text == "@manual":
            return None
        match = re.fullmatch(r"@every\s+(\d+)\s*([smhd]?)", text)
        if match:
            amount = max(1, int(match.group(1)))
            unit = match.group(2) or "s"
            scale = {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]
            return base + amount * scale
        if text == "@hourly":
            return base + 3600
        if text == "@daily":
            return base + 86400
        parts = text.split()
        if len(parts) == 5:
            minute = parts[0]
            if minute.startswith("*/") and minute[2:].isdigit():
                return base + max(1, int(minute[2:])) * 60
            return base + 60
        return base + 86400

    @staticmethod
    def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        data = dict(row)
        data["payload"] = json.loads(data.pop("payload_json", "{}"))
        data["cancel_requested"] = bool(data.get("cancel_requested"))
        return data

    @staticmethod
    def _event(row: sqlite3.Row) -> dict[str, Any]:
        data = dict(row)
        data["payload"] = json.loads(data.pop("payload_json", "{}"))
        return data

    def enqueue_task(self, kind: str, session_id: str, payload: dict[str, Any]) -> str:
        task_id = str(uuid.uuid4())
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO tasks(id, kind, session_id, payload_json, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'pending', ?, ?)
                """,
                (task_id, kind, session_id, json.dumps(payload or {}, ensure_ascii=False), now, now),
            )
        return task_id

    def active_count(self) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('pending','leased','running')").fetchone()
            return int(row["n"] or 0)

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            return self._row(conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())

    def lease_next_task(self, worker_id: str, lease_seconds: int = 60) -> dict[str, Any] | None:
        now = time.time()
        lease_until = now + int(lease_seconds)
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                """
                SELECT t.* FROM tasks t
                WHERE t.status='pending'
                  AND NOT EXISTS (
                    SELECT 1 FROM tasks earlier
                    WHERE earlier.session_id=t.session_id
                      AND earlier.created_at < t.created_at
                      AND earlier.status IN ('pending','leased','running')
                  )
                ORDER BY t.created_at ASC
                LIMIT 1
                """
            ).fetchone()
            if row is None:
                conn.execute("COMMIT")
                return None
            conn.execute(
                """
                UPDATE tasks
                SET status='leased', leased_by=?, lease_until=?, updated_at=?
                WHERE id=? AND status='pending'
                """,
                (worker_id, lease_until, now, row["id"]),
            )
            self.append_event(row["id"], "worker_status", {"status": "leased", "worker_id": worker_id}, conn=conn)
            conn.execute("COMMIT")
            return self.get_task(row["id"])

    def mark_task_running(self, task_id: str, worker_id: str) -> None:
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE tasks
                SET status='running', leased_by=?, started_at=COALESCE(started_at, ?), updated_at=?
                WHERE id=? AND status IN ('leased','pending','running')
                """,
                (worker_id, now, now, task_id),
            )
            self.append_event(task_id, "worker_status", {"status": "running", "worker_id": worker_id}, conn=conn)

    def finish_task(self, task_id: str, status: str, error: str = "", emit_event: bool = True) -> None:
        if status not in FINAL_STATUSES:
            raise ValueError(f"invalid final status: {status}")
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE tasks
                SET status=?, error=?, finished_at=?, updated_at=?
                WHERE id=? AND status NOT IN ('succeeded','failed','canceled','interrupted')
                """,
                (status, error or "", now, now, task_id),
            )
            if emit_event:
                self.append_event(task_id, "done" if status == "succeeded" else "error", {"status": status, "error": error}, conn=conn)

    def request_cancel(self, task_id: str) -> bool:
        row = self.get_task(task_id)
        if not row:
            return False
        now = time.time()
        with self._connect() as conn:
            if row["status"] == "pending":
                conn.execute(
                    "UPDATE tasks SET status='canceled', cancel_requested=1, finished_at=?, updated_at=? WHERE id=?",
                    (now, now, task_id),
                )
                self.append_event(task_id, "error", {"status": "canceled"}, conn=conn)
                return True
            if row["status"] in {"leased", "running"}:
                conn.execute("UPDATE tasks SET cancel_requested=1, updated_at=? WHERE id=?", (now, task_id))
                self.append_event(task_id, "worker_status", {"cancel_requested": True}, conn=conn)
                return True
        return False

    def append_event(self, task_id: str, event_type: str, payload: dict[str, Any], conn: sqlite3.Connection | None = None) -> int:
        own_conn = conn is None
        if own_conn:
            conn = self._connect()
        assert conn is not None
        now = time.time()
        cur = conn.execute(
            "INSERT INTO task_events(task_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)",
            (task_id, event_type, json.dumps(payload or {}, ensure_ascii=False), now),
        )
        seq = int(cur.lastrowid)
        if own_conn:
            conn.close()
        return seq

    def events_after(self, task_id: str, after_seq: int = 0) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM task_events WHERE task_id=? AND seq>? ORDER BY seq ASC",
                (task_id, int(after_seq or 0)),
            ).fetchall()
            return [self._event(r) for r in rows]

    def list_tasks(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?", (int(limit),)).fetchall()
            return [self._row(r) for r in rows if r is not None]

    def create_session(self, title: str = "") -> dict[str, Any]:
        sid = str(uuid.uuid4())
        now = time.time()
        clean_title = str(title or "").strip() or "New session"
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO sessions(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (sid, clean_title, now, now),
            )
        return self.get_session(sid)

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
            if row is None:
                return None
            data = dict(row)
            data["agent_history"] = json.loads(data.pop("agent_history_json", "[]"))
            data["backend_history"] = json.loads(data.pop("backend_history_json", "[]"))
            return data

    def list_sessions(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM sessions ORDER BY updated_at DESC").fetchall()
            return [self.get_session(r["id"]) for r in rows]

    def update_session(self, session_id: str, title: str | None = None, llm_idx: int | None = None) -> dict[str, Any] | None:
        current = self.get_session(session_id)
        if not current:
            return None
        next_title = current["title"] if title is None else (str(title).strip() or current["title"])
        next_llm_idx = current["llm_idx"] if llm_idx is None else int(llm_idx)
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                "UPDATE sessions SET title=?, llm_idx=?, updated_at=? WHERE id=?",
                (next_title, next_llm_idx, now, session_id),
            )
        return self.get_session(session_id)

    def delete_session(self, session_id: str) -> bool:
        if not self.get_session(session_id):
            return False
        with self._connect() as conn:
            conn.execute("DELETE FROM messages WHERE session_id=?", (session_id,))
            conn.execute("DELETE FROM sessions WHERE id=?", (session_id,))
        return True

    def add_message(self, session_id: str, role: str, content: str, task_id: str | None = None) -> dict[str, Any]:
        if not self.get_session(session_id):
            raise KeyError(session_id)
        mid = str(uuid.uuid4())
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO messages(id, session_id, role, content, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (mid, session_id, role, str(content or ""), task_id, now),
            )
            conn.execute("UPDATE sessions SET updated_at=? WHERE id=?", (now, session_id))
        return {"id": mid, "session_id": session_id, "role": role, "content": str(content or ""), "task_id": task_id, "created_at": now}

    def list_messages(self, session_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM messages WHERE session_id=? ORDER BY created_at ASC",
                (session_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def queue_position(self, task_id: str) -> int:
        task = self.get_task(task_id)
        if not task or task["status"] != "pending":
            return 0
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM tasks WHERE status='pending' AND created_at <= ?",
                (task["created_at"],),
            ).fetchone()
            return int(row["n"] or 1)

    def recover_interrupted(self) -> int:
        now = time.time()
        with self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE tasks
                SET status='interrupted', finished_at=?, updated_at=?, error='backend restarted'
                WHERE status IN ('leased','running')
                """,
                (now, now),
            )
            return int(cur.rowcount or 0)

    def interrupt_timed_out_tasks(self, now: float | None = None, timeout_seconds: int = 3600) -> list[str]:
        stamp = float(now if now is not None else time.time())
        threshold = stamp - int(timeout_seconds)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id FROM tasks
                WHERE status IN ('leased','running')
                  AND COALESCE(started_at, updated_at, created_at) <= ?
                ORDER BY created_at ASC
                """,
                (threshold,),
            ).fetchall()
            ids = [row["id"] for row in rows]
            for task_id in ids:
                conn.execute(
                    """
                    UPDATE tasks
                    SET status='interrupted', error=?, finished_at=?, updated_at=?
                    WHERE id=? AND status IN ('leased','running')
                    """,
                    (f"task timed out after {int(timeout_seconds)} seconds", stamp, stamp, task_id),
                )
                self.append_event(task_id, "error", {"status": "interrupted", "error": f"task timed out after {int(timeout_seconds)} seconds"}, conn=conn)
            return ids

    @staticmethod
    def _schedule(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        data = dict(row)
        data["enabled"] = bool(data.get("enabled"))
        return data

    def create_schedule(self, payload: dict[str, Any]) -> dict[str, Any]:
        schedule_id = str(uuid.uuid4())
        now = time.time()
        title = str(payload.get("title") or "").strip() or "Untitled schedule"
        prompt = str(payload.get("prompt") or "")
        cron = str(payload.get("cron") or "").strip() or "@manual"
        enabled = 1 if bool(payload.get("enabled", True)) else 0
        next_run_at = self._next_schedule_run(cron, now) if enabled else None
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO schedules(id, title, prompt, cron, enabled, created_at, updated_at, next_run_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (schedule_id, title, prompt, cron, enabled, now, now, next_run_at),
            )
        return self.get_schedule(schedule_id)

    def get_schedule(self, schedule_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM schedules WHERE id=?", (schedule_id,)).fetchone()
            return self._schedule(row)

    def list_schedules(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM schedules ORDER BY updated_at DESC").fetchall()
            return [self._schedule(r) for r in rows if r is not None]

    def update_schedule(self, schedule_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        current = self.get_schedule(schedule_id)
        if not current:
            return None
        title = str(payload.get("title", current["title"]) or "").strip() or current["title"]
        prompt = str(payload.get("prompt", current["prompt"]) or "")
        cron = str(payload.get("cron", current["cron"]) or "").strip() or current["cron"]
        enabled = 1 if bool(payload.get("enabled", current["enabled"])) else 0
        now = time.time()
        next_run_at = self._next_schedule_run(cron, now) if enabled else None
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE schedules
                SET title=?, prompt=?, cron=?, enabled=?, updated_at=?, next_run_at=?
                WHERE id=?
                """,
                (title, prompt, cron, enabled, now, next_run_at, schedule_id),
            )
        return self.get_schedule(schedule_id)

    def delete_schedule(self, schedule_id: str) -> bool:
        if not self.get_schedule(schedule_id):
            return False
        with self._connect() as conn:
            conn.execute("DELETE FROM schedules WHERE id=?", (schedule_id,))
        return True

    def enqueue_schedule(self, schedule_id: str, now: float | None = None, advance_next: bool = True) -> str | None:
        schedule = self.get_schedule(schedule_id)
        if not schedule:
            return None
        stamp = float(now if now is not None else time.time())
        task_id = self.enqueue_task(
            "schedule",
            f"schedule:{schedule_id}",
            {
                "schedule_id": schedule_id,
                "title": schedule["title"],
                "prompt": schedule["prompt"],
                "cron": schedule["cron"],
            },
        )
        next_run_at = self._next_schedule_run(schedule["cron"], stamp) if advance_next and schedule.get("enabled") else schedule.get("next_run_at")
        with self._connect() as conn:
            conn.execute(
                "UPDATE schedules SET last_task_id=?, last_run_at=?, next_run_at=?, updated_at=? WHERE id=?",
                (task_id, stamp, next_run_at, stamp, schedule_id),
            )
        return task_id

    def enqueue_due_schedules(self, now: float | None = None) -> list[str]:
        stamp = float(now if now is not None else time.time())
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id FROM schedules
                WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at<=?
                ORDER BY next_run_at ASC
                """,
                (stamp,),
            ).fetchall()
        task_ids: list[str] = []
        for row in rows:
            task_id = self.enqueue_schedule(row["id"], now=stamp, advance_next=True)
            if task_id:
                task_ids.append(task_id)
        return task_ids

    def list_schedule_reports(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, status, payload_json, created_at, updated_at, finished_at, error
                FROM tasks
                WHERE kind='schedule'
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (int(limit),),
            ).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            payload = json.loads(row["payload_json"] or "{}")
            items.append(
                {
                    "task_id": row["id"],
                    "schedule_id": payload.get("schedule_id"),
                    "title": payload.get("title", ""),
                    "status": row["status"],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                    "finished_at": row["finished_at"],
                    "error": row["error"],
                }
            )
        return items
