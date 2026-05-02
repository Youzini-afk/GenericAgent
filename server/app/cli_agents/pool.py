from __future__ import annotations

import threading
import time
from typing import Any

from server.app.cli_agents.runner import CliRunner
from server.app.cli_agents.store import CliAgentStore


class CliRunPool:
    def __init__(self, store: CliAgentStore, concurrency: int = 2, poll_interval: float = 0.5):
        self.store = store
        self.concurrency = max(0, int(concurrency))
        self.poll_interval = float(poll_interval)
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        self._current: dict[str, str | None] = {}

    def start(self) -> None:
        if self._threads:
            return
        for index in range(self.concurrency):
            runner_id = f"cli-runner-{index + 1}"
            self._current[runner_id] = None
            thread = threading.Thread(target=self._loop, args=(runner_id,), daemon=True)
            thread.start()
            self._threads.append(thread)

    def stop(self) -> None:
        self._stop.set()
        for thread in self._threads:
            thread.join(timeout=3)

    def status(self) -> list[dict[str, Any]]:
        return [{"id": runner_id, "current_run_id": run_id} for runner_id, run_id in sorted(self._current.items())]

    def cancel_run(self, run_id: str) -> bool:
        return self.store.request_cancel(run_id)

    def _loop(self, runner_id: str) -> None:
        runner = CliRunner(self.store)
        while not self._stop.is_set():
            run = self.store.lease_next_run(runner_id)
            if not run:
                time.sleep(self.poll_interval)
                continue
            self._current[runner_id] = run["id"]
            try:
                runner.execute(run)
            finally:
                self._current[runner_id] = None

