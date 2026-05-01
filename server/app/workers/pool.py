from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from server.app.queue.store import QueueStore
from server.app.workers.protocol import decode_message, encode_message


class WorkerProcess:
    def __init__(self, worker_id: str, data_dir: str, on_event):
        self.worker_id = worker_id
        self.data_dir = data_dir
        self.on_event = on_event
        self.proc: subprocess.Popen | None = None
        self.current_task_id: str | None = None
        self.ready = False
        self.last_error = ""
        self.log_path = Path(self.data_dir) / "workers" / self.worker_id / "worker.log"
        self.needs_reload = False

    def start(self) -> None:
        worker_dir = Path(self.data_dir) / "workers" / self.worker_id
        worker_dir.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["GA_WORKER_ID"] = self.worker_id
        env["GA_DATA_DIR"] = self.data_dir
        env.setdefault("GA_MYKEY_PATH", str(Path(self.data_dir) / "mykey.py"))
        env["GA_BROWSER_PROFILE"] = str(Path(self.data_dir) / "browser" / "workers" / self.worker_id)
        env["GA_WORKER_TEMP_DIR"] = str(Path(self.data_dir) / "workers" / self.worker_id / "temp")
        env["PYTHONUNBUFFERED"] = "1"
        cmd = [sys.executable, "-m", "server.worker_main", "--worker-id", self.worker_id]
        self.proc = subprocess.Popen(
            cmd,
            cwd=Path(__file__).resolve().parents[3],
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

    def _read_stdout(self) -> None:
        assert self.proc and self.proc.stdout
        for line in self.proc.stdout:
            try:
                event = decode_message(line)
                self.on_event(self, event)
            except Exception as e:
                self.last_error = str(e)

    def _read_stderr(self) -> None:
        assert self.proc and self.proc.stderr
        for line in self.proc.stderr:
            self.last_error = line.strip()
            try:
                self.log_path.parent.mkdir(parents=True, exist_ok=True)
                with self.log_path.open("a", encoding="utf-8") as f:
                    f.write(line)
            except Exception:
                pass

    def send(self, command: str, **payload: Any) -> None:
        if not self.proc or not self.proc.stdin:
            return
        self.proc.stdin.write(encode_message(command, **payload))
        self.proc.stdin.flush()

    def stop(self) -> None:
        try:
            self.send("shutdown")
        except Exception:
            pass
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        if self.proc:
            for stream in (self.proc.stdin, self.proc.stdout, self.proc.stderr):
                try:
                    if stream:
                        stream.close()
                except Exception:
                    pass

    def is_idle(self) -> bool:
        return bool(self.ready and self.proc and self.proc.poll() is None and not self.current_task_id)


class WorkerPool:
    def __init__(self, store: QueueStore, concurrency: int, data_dir: str, poll_interval: float = 0.5):
        self.store = store
        self.concurrency = max(0, int(concurrency))
        self.data_dir = data_dir
        self.poll_interval = float(poll_interval)
        self.workers: list[WorkerProcess] = []
        self._stop = threading.Event()
        self._loop: threading.Thread | None = None

    def start(self) -> None:
        if self._loop:
            return
        for i in range(self.concurrency):
            worker = WorkerProcess(f"worker-{i + 1}", self.data_dir, self._handle_event)
            worker.start()
            self.workers.append(worker)
        self._loop = threading.Thread(target=self._dispatch_loop, daemon=True)
        self._loop.start()

    def stop(self) -> None:
        self._stop.set()
        for worker in self.workers:
            worker.stop()
        if self._loop:
            self._loop.join(timeout=3)

    def reload_config(self) -> None:
        for worker in self.workers:
            if worker.is_idle():
                worker.send("reload_config")
                worker.needs_reload = False
            else:
                worker.needs_reload = True

    def cancel_task(self, task_id: str) -> None:
        for worker in self.workers:
            if worker.current_task_id == task_id:
                worker.send("cancel_task", task_id=task_id)
                return

    def restart_worker(self, worker_id: str) -> bool:
        for idx, worker in enumerate(list(self.workers)):
            if worker.worker_id != worker_id:
                continue
            if worker.current_task_id:
                self.store.finish_task(worker.current_task_id, "interrupted", error="worker restarted")
            try:
                worker.stop()
            except Exception:
                pass
            replacement = WorkerProcess(worker.worker_id, self.data_dir, self._handle_event)
            replacement.start()
            self.workers[idx] = replacement
            return True
        return False

    def _dispatch_loop(self) -> None:
        while not self._stop.is_set():
            self._recover_dead_workers(restart=True)
            self._interrupt_timed_out_workers()
            for worker in self.workers:
                if not worker.is_idle():
                    continue
                task = self.store.lease_next_task(worker.worker_id, lease_seconds=60)
                if not task:
                    continue
                worker.current_task_id = task["id"]
                worker.send("run_task", task=task)
            time.sleep(self.poll_interval)

    def _recover_dead_workers(self, restart: bool = True) -> None:
        for idx, worker in enumerate(list(self.workers)):
            proc = getattr(worker, "proc", None)
            if not proc or proc.poll() is None:
                continue
            task_id = getattr(worker, "current_task_id", None)
            if task_id:
                code = proc.poll()
                error = getattr(worker, "last_error", "") or f"worker exited with code {code}"
                self.store.finish_task(task_id, "interrupted", error=error)
                worker.current_task_id = None
            if restart:
                try:
                    worker.stop()
                except Exception:
                    pass
                replacement = WorkerProcess(worker.worker_id, self.data_dir, self._handle_event)
                replacement.start()
                self.workers[idx] = replacement

    def _interrupt_timed_out_workers(self) -> None:
        timeout_seconds = int(os.environ.get("GA_TASK_TIMEOUT_SECONDS", "3600") or 3600)
        if timeout_seconds <= 0:
            return
        timed_out = set(self.store.interrupt_timed_out_tasks(timeout_seconds=timeout_seconds))
        if not timed_out:
            return
        for idx, worker in enumerate(list(self.workers)):
            if worker.current_task_id not in timed_out:
                continue
            try:
                worker.send("cancel_task", task_id=worker.current_task_id)
                worker.stop()
            except Exception:
                pass
            replacement = WorkerProcess(worker.worker_id, self.data_dir, self._handle_event)
            replacement.start()
            self.workers[idx] = replacement

    def _handle_event(self, worker: WorkerProcess, event: dict[str, Any]) -> None:
        etype = event.get("event")
        task_id = event.get("task_id")
        if etype == "ready":
            worker.ready = True
            if event.get("reloaded"):
                worker.needs_reload = False
            return
        if etype == "task_started" and task_id:
            self.store.mark_task_running(task_id, worker.worker_id)
        elif etype == "next" and task_id:
            self.store.append_event(task_id, "next", {"text": event.get("text", ""), "worker_id": worker.worker_id})
        elif etype == "done" and task_id:
            text = event.get("text", "")
            self.store.append_event(task_id, "done", {"text": text, "worker_id": worker.worker_id})
            task = self.store.get_task(task_id)
            if task and task.get("kind") == "chat":
                try:
                    self.store.add_message(task["session_id"], "assistant", str(text or ""), task_id=task_id)
                except Exception:
                    pass
        elif etype == "error" and task_id:
            self.store.append_event(task_id, "error", {"error": event.get("error", ""), "worker_id": worker.worker_id})
        elif etype == "task_finished" and task_id:
            status = event.get("status") or "failed"
            error = event.get("error", "")
            self.store.finish_task(task_id, status, error=error, emit_event=False)
            worker.current_task_id = None
            if getattr(worker, "needs_reload", False):
                worker.send("reload_config")
                worker.needs_reload = False

    def status(self) -> list[dict[str, Any]]:
        return [
            {
                "id": worker.worker_id,
                "ready": worker.ready,
                "current_task_id": worker.current_task_id,
                "last_error": worker.last_error,
                "alive": bool(worker.proc and worker.proc.poll() is None),
            }
            for worker in self.workers
        ]
