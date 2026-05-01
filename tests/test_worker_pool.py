import os
import tempfile
import time
import unittest


class WorkerPoolTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_env = dict(os.environ)
        os.environ["GA_DATA_DIR"] = self.tmp.name
        os.environ["GA_MYKEY_PATH"] = os.path.join(self.tmp.name, "mykey.py")
        os.environ["GA_WORKER_FAKE"] = "1"

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.old_env)
        self.tmp.cleanup()

    def test_pool_completes_tasks_with_session_ordering(self):
        from server.app.queue.store import QueueStore
        from server.app.workers.pool import WorkerPool

        store = QueueStore(os.path.join(self.tmp.name, "app.db"))
        first = store.enqueue_task("chat", "same", {"text": "one"})
        second = store.enqueue_task("chat", "same", {"text": "two"})
        third = store.enqueue_task("chat", "other", {"text": "three"})

        pool = WorkerPool(store, concurrency=2, data_dir=self.tmp.name, poll_interval=0.05)
        pool.start()
        try:
            deadline = time.time() + 10
            while time.time() < deadline:
                statuses = {tid: store.get_task(tid)["status"] for tid in (first, second, third)}
                if all(status == "succeeded" for status in statuses.values()):
                    break
                time.sleep(0.05)
            self.assertEqual(store.get_task(first)["status"], "succeeded")
            self.assertEqual(store.get_task(second)["status"], "succeeded")
            self.assertEqual(store.get_task(third)["status"], "succeeded")
            first_started = [e for e in store.events_after(first, 0) if e["type"] == "worker_status" and e["payload"].get("status") == "running"][0]
            second_started = [e for e in store.events_after(second, 0) if e["type"] == "worker_status" and e["payload"].get("status") == "running"][0]
            self.assertLess(first_started["created_at"], second_started["created_at"])
        finally:
            pool.stop()

    def test_dead_worker_marks_current_task_interrupted(self):
        from server.app.queue.store import QueueStore
        from server.app.workers.pool import WorkerPool

        class DeadProc:
            def poll(self):
                return 7

        class DeadWorker:
            worker_id = "worker-1"
            data_dir = self.tmp.name
            current_task_id = None
            last_error = "boom"
            ready = True
            proc = DeadProc()

            def stop(self):
                pass

        store = QueueStore(os.path.join(self.tmp.name, "app.db"))
        task_id = store.enqueue_task("chat", "s1", {"text": "die"})
        store.lease_next_task("worker-1")
        store.mark_task_running(task_id, "worker-1")
        worker = DeadWorker()
        worker.current_task_id = task_id

        pool = WorkerPool(store, concurrency=1, data_dir=self.tmp.name, poll_interval=0.05)
        pool.workers = [worker]
        pool._recover_dead_workers(restart=False)

        task = store.get_task(task_id)
        self.assertEqual(task["status"], "interrupted")
        self.assertIn("boom", task["error"])

    def test_pool_cancels_running_task(self):
        from server.app.queue.store import QueueStore
        from server.app.workers.pool import WorkerPool

        os.environ["GA_WORKER_FAKE_STEPS"] = "50"
        os.environ["GA_WORKER_FAKE_DELAY"] = "0.05"
        store = QueueStore(os.path.join(self.tmp.name, "app.db"))
        task_id = store.enqueue_task("chat", "s1", {"text": "long"})
        pool = WorkerPool(store, concurrency=1, data_dir=self.tmp.name, poll_interval=0.02)
        pool.start()
        try:
            deadline = time.time() + 5
            while time.time() < deadline and store.get_task(task_id)["status"] != "running":
                time.sleep(0.02)
            self.assertEqual(store.get_task(task_id)["status"], "running")
            self.assertTrue(store.request_cancel(task_id))
            pool.cancel_task(task_id)

            deadline = time.time() + 5
            while time.time() < deadline and store.get_task(task_id)["status"] != "canceled":
                time.sleep(0.02)
            self.assertEqual(store.get_task(task_id)["status"], "canceled")
        finally:
            pool.stop()

    def test_reload_config_is_deferred_until_running_worker_finishes(self):
        from server.app.queue.store import QueueStore
        from server.app.workers.pool import WorkerPool

        class BusyWorker:
            worker_id = "worker-1"
            current_task_id = "task-1"
            needs_reload = False

            def __init__(self):
                self.sent = []

            def is_idle(self):
                return False

            def send(self, command, **payload):
                self.sent.append((command, payload))

        store = QueueStore(os.path.join(self.tmp.name, "app.db"))
        task_id = store.enqueue_task("chat", "s1", {"text": "x"})
        worker = BusyWorker()
        worker.current_task_id = task_id
        pool = WorkerPool(store, concurrency=1, data_dir=self.tmp.name, poll_interval=0.05)
        pool.workers = [worker]

        pool.reload_config()
        self.assertTrue(worker.needs_reload)
        self.assertEqual(worker.sent, [])

        pool._handle_event(worker, {"event": "task_finished", "task_id": task_id, "status": "succeeded"})
        self.assertEqual(worker.sent, [("reload_config", {})])

    def test_done_event_persists_assistant_message_for_chat_task(self):
        from server.app.queue.store import QueueStore
        from server.app.workers.pool import WorkerPool

        class Worker:
            worker_id = "worker-1"
            current_task_id = None

        store = QueueStore(os.path.join(self.tmp.name, "app.db"))
        session = store.create_session("Chat")
        task_id = store.enqueue_task("chat", session["id"], {"text": "hello"})
        pool = WorkerPool(store, concurrency=1, data_dir=self.tmp.name, poll_interval=0.05)

        pool._handle_event(Worker(), {"event": "done", "task_id": task_id, "text": "answer"})

        messages = store.list_messages(session["id"])
        self.assertEqual(messages[-1]["role"], "assistant")
        self.assertEqual(messages[-1]["content"], "answer")


if __name__ == "__main__":
    unittest.main()
