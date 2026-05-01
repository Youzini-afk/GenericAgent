from __future__ import annotations

import argparse
import os
import queue
import sys
import threading
import time

from server.app.workers.protocol import decode_message, send_stdout


def _fake_run(worker_id: str, task: dict, stop: threading.Event) -> None:
    task_id = task["id"]
    send_stdout("task_started", worker_id=worker_id, task_id=task_id)
    for i in range(2):
        if stop.is_set():
            send_stdout("task_finished", worker_id=worker_id, task_id=task_id, status="canceled", error="")
            return
        send_stdout("next", worker_id=worker_id, task_id=task_id, text=f"fake chunk {i + 1}")
        time.sleep(0.05)
    send_stdout("done", worker_id=worker_id, task_id=task_id, text="fake done")
    send_stdout("task_finished", worker_id=worker_id, task_id=task_id, status="succeeded", error="")


def _agent_run(worker_id: str, task: dict, stop: threading.Event) -> None:
    from agentmain import GeneraticAgent

    task_id = task["id"]
    payload = task.get("payload") or {}
    prompt = payload.get("text") or payload.get("prompt") or ""
    agent = GeneraticAgent()
    threading.Thread(target=agent.run, daemon=True).start()
    send_stdout("task_started", worker_id=worker_id, task_id=task_id)
    dq = agent.put_task(prompt, source=task.get("kind", "chat"))
    try:
        while True:
            if stop.is_set():
                agent.abort()
            try:
                item = dq.get(timeout=0.2)
            except queue.Empty:
                if stop.is_set() and not getattr(agent, "is_running", True):
                    send_stdout("task_finished", worker_id=worker_id, task_id=task_id, status="canceled", error="")
                    return
                continue
            if "next" in item:
                send_stdout("next", worker_id=worker_id, task_id=task_id, text=item["next"])
            if "done" in item:
                if not stop.is_set():
                    send_stdout("done", worker_id=worker_id, task_id=task_id, text=item["done"])
                    send_stdout("task_finished", worker_id=worker_id, task_id=task_id, status="succeeded", error="")
                else:
                    send_stdout("task_finished", worker_id=worker_id, task_id=task_id, status="canceled", error="")
                return
    except Exception as e:
        send_stdout("error", worker_id=worker_id, task_id=task_id, error=str(e))
        send_stdout("task_finished", worker_id=worker_id, task_id=task_id, status="failed", error=str(e))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker-id", required=True)
    args = parser.parse_args(argv)
    worker_id = args.worker_id
    stop = threading.Event()
    current: threading.Thread | None = None
    send_stdout("ready", worker_id=worker_id)
    for raw in sys.stdin:
        if not raw.strip():
            continue
        msg = decode_message(raw)
        cmd = msg.get("cmd")
        if cmd == "shutdown":
            stop.set()
            break
        if cmd == "cancel_task":
            stop.set()
            continue
        if cmd == "reload_config":
            send_stdout("ready", worker_id=worker_id, reloaded=True)
            continue
        if cmd == "run_task":
            stop = threading.Event()
            runner = _fake_run if os.environ.get("GA_WORKER_FAKE") == "1" else _agent_run
            current = threading.Thread(target=runner, args=(worker_id, msg["task"], stop), daemon=True)
            current.start()
    if current and current.is_alive():
        stop.set()
        current.join(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
