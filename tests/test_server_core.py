import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class RuntimePathTests(unittest.TestCase):
    def test_runtime_paths_follow_ga_data_dir(self):
        with tempfile.TemporaryDirectory() as td:
            old = os.environ.get("GA_DATA_DIR")
            os.environ["GA_DATA_DIR"] = td
            try:
                import runtime_paths

                self.assertEqual(Path(runtime_paths.data_dir()), Path(td).resolve())
                self.assertEqual(Path(runtime_paths.runtime_path("temp")), Path(td).resolve() / "temp")
                self.assertTrue(str(runtime_paths.code_path("assets")).endswith("assets"))

                worker_temp = Path(td) / "workers" / "worker-1" / "temp"
                os.environ["GA_WORKER_TEMP_DIR"] = str(worker_temp)
                self.assertEqual(Path(runtime_paths.temp_path()), worker_temp.resolve())
            finally:
                if old is None:
                    os.environ.pop("GA_DATA_DIR", None)
                else:
                    os.environ["GA_DATA_DIR"] = old
                os.environ.pop("GA_WORKER_TEMP_DIR", None)

    def test_llmcore_loads_mykey_from_explicit_env_path(self):
        with tempfile.TemporaryDirectory() as td:
            mykey = Path(td) / "cloud_mykey.py"
            mykey.write_text(
                "native_oai_config = {'apikey': 'key-from-env', 'apibase': 'https://example.test/v1', 'model': 'demo'}\n",
                encoding="utf-8",
            )
            script = (
                "import json, llmcore; "
                "cfg, changed = llmcore.reload_mykeys(); "
                "print(json.dumps({'key': cfg['native_oai_config']['apikey'], 'changed': changed}))"
            )
            env = dict(os.environ, GA_MYKEY_PATH=str(mykey))
            result = subprocess.run(
                [sys.executable, "-c", script],
                cwd=Path(__file__).resolve().parents[1],
                env=env,
                text=True,
                capture_output=True,
                timeout=20,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('"key": "key-from-env"', result.stdout)

    def test_agentmain_initializes_memory_under_ga_data_dir(self):
        with tempfile.TemporaryDirectory() as td:
            script = "import agentmain, pathlib, os; print(pathlib.Path(os.environ['GA_DATA_DIR'], 'memory', 'global_mem.txt').exists())"
            env = dict(os.environ, GA_DATA_DIR=td)
            result = subprocess.run(
                [sys.executable, "-c", script],
                cwd=Path(__file__).resolve().parents[1],
                env=env,
                text=True,
                capture_output=True,
                timeout=20,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("True", result.stdout)


class QueueStoreTests(unittest.TestCase):
    def test_leases_different_sessions_but_serializes_same_session(self):
        with tempfile.TemporaryDirectory() as td:
            from server.app.queue.store import QueueStore

            store = QueueStore(os.path.join(td, "app.db"))
            first = store.enqueue_task("chat", "s1", {"text": "one"})
            second = store.enqueue_task("chat", "s1", {"text": "two"})
            third = store.enqueue_task("chat", "s2", {"text": "three"})

            leased_a = store.lease_next_task("w1", lease_seconds=30)
            leased_b = store.lease_next_task("w2", lease_seconds=30)
            self.assertEqual({leased_a["id"], leased_b["id"]}, {first, third})
            self.assertEqual(store.get_task(second)["status"], "pending")

            store.mark_task_running(first, "w1")
            store.finish_task(first, "succeeded")
            leased_c = store.lease_next_task("w1", lease_seconds=30)
            self.assertEqual(leased_c["id"], second)

    def test_cancel_pending_and_running_tasks(self):
        with tempfile.TemporaryDirectory() as td:
            from server.app.queue.store import QueueStore

            store = QueueStore(os.path.join(td, "app.db"))
            pending = store.enqueue_task("chat", "s1", {"text": "queued"})
            self.assertTrue(store.request_cancel(pending))
            self.assertEqual(store.get_task(pending)["status"], "canceled")

            running = store.enqueue_task("chat", "s2", {"text": "run"})
            store.lease_next_task("w1", lease_seconds=30)
            store.mark_task_running(running, "w1")
            self.assertTrue(store.request_cancel(running))
            row = store.get_task(running)
            self.assertEqual(row["status"], "running")
            self.assertTrue(row["cancel_requested"])

    def test_task_events_are_ordered_and_resumable(self):
        with tempfile.TemporaryDirectory() as td:
            from server.app.queue.store import QueueStore

            store = QueueStore(os.path.join(td, "app.db"))
            task_id = store.enqueue_task("chat", "s1", {"text": "hi"})
            seq1 = store.append_event(task_id, "next", {"text": "a"})
            seq2 = store.append_event(task_id, "done", {"text": "b"})
            self.assertLess(seq1, seq2)
            self.assertEqual([e["type"] for e in store.events_after(task_id, 0)], ["next", "done"])
            self.assertEqual([e["type"] for e in store.events_after(task_id, seq1)], ["done"])

    def test_due_schedules_enqueue_schedule_tasks_without_running_agent(self):
        with tempfile.TemporaryDirectory() as td:
            from server.app.queue.store import QueueStore

            store = QueueStore(os.path.join(td, "app.db"))
            schedule = store.create_schedule({"title": "Tick", "prompt": "run", "cron": "@every 1s", "enabled": True})
            task_ids = store.enqueue_due_schedules(now=schedule["next_run_at"] + 0.1)

            self.assertEqual(len(task_ids), 1)
            task = store.get_task(task_ids[0])
            self.assertEqual(task["kind"], "schedule")
            self.assertEqual(task["status"], "pending")
            self.assertEqual(task["payload"]["schedule_id"], schedule["id"])
            self.assertGreater(store.get_schedule(schedule["id"])["next_run_at"], schedule["next_run_at"])

    def test_running_tasks_can_be_interrupted_after_timeout(self):
        with tempfile.TemporaryDirectory() as td:
            from server.app.queue.store import QueueStore

            store = QueueStore(os.path.join(td, "app.db"))
            task_id = store.enqueue_task("chat", "s1", {"text": "slow"})
            store.lease_next_task("worker-1")
            store.mark_task_running(task_id, "worker-1")
            interrupted = store.interrupt_timed_out_tasks(now=store.get_task(task_id)["started_at"] + 11, timeout_seconds=10)

            self.assertEqual(interrupted, [task_id])
            task = store.get_task(task_id)
            self.assertEqual(task["status"], "interrupted")
            self.assertIn("timed out", task["error"])


class AuthTests(unittest.TestCase):
    def test_password_token_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            from server.app.core.auth import AuthManager

            auth = AuthManager(data_dir=td, admin_password="secret")
            token = auth.issue_token("secret")
            self.assertTrue(auth.verify_token(token))
            self.assertFalse(auth.verify_token(token + "x"))

    def test_wrong_password_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            from server.app.core.auth import AuthManager

            auth = AuthManager(data_dir=td, admin_password="secret")
            with self.assertRaises(PermissionError):
                auth.issue_token("bad")


class SchedulerServiceTests(unittest.TestCase):
    def test_tick_enqueues_due_schedules_only(self):
        with tempfile.TemporaryDirectory() as td:
            from server.app.queue.store import QueueStore
            from server.app.services.scheduler import SchedulerService

            store = QueueStore(os.path.join(td, "app.db"))
            schedule = store.create_schedule({"title": "Due", "prompt": "run", "cron": "@every 1s", "enabled": True})
            service = SchedulerService(store, poll_interval=0.01, now_fn=lambda: schedule["next_run_at"] + 0.1)

            task_ids = service.tick()

            self.assertEqual(len(task_ids), 1)
            self.assertEqual(store.get_task(task_ids[0])["kind"], "schedule")


if __name__ == "__main__":
    unittest.main()
