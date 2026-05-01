from __future__ import annotations

import threading
import time
from collections.abc import Callable

from server.app.queue.store import QueueStore


class SchedulerService:
    def __init__(
        self,
        store: QueueStore,
        poll_interval: float = 30.0,
        now_fn: Callable[[], float] | None = None,
    ):
        self.store = store
        self.poll_interval = float(poll_interval)
        self.now_fn = now_fn or time.time
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def tick(self) -> list[str]:
        return self.store.enqueue_due_schedules(now=self.now_fn())

    def start(self) -> None:
        if self._thread:
            return
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.tick()
            except Exception:
                pass
            self._stop.wait(self.poll_interval)
