import os
import tempfile
import unittest
from pathlib import Path


class ServerResourceApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_env = dict(os.environ)
        os.environ["GA_DATA_DIR"] = self.tmp.name
        os.environ["GA_MYKEY_PATH"] = os.path.join(self.tmp.name, "mykey.py")
        os.environ["GA_ADMIN_PASSWORD"] = "secret"
        os.environ["GA_WORKER_CONCURRENCY"] = "0"

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.old_env)
        self.tmp.cleanup()

    def _client(self):
        from fastapi.testclient import TestClient
        from server.app.main import create_app

        return TestClient(create_app())

    def _headers(self, client):
        response = client.post("/api/auth/login", json={"password": "secret"})
        self.assertEqual(response.status_code, 200, response.text)
        return {"Authorization": f"Bearer {response.json()['token']}"}

    def test_memory_file_read_write_rejects_path_escape(self):
        client = self._client()
        headers = self._headers(client)

        response = client.put(
            "/api/memory/files/notes/demo.md",
            json={"content": "remember this"},
            headers=headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["path"], "notes/demo.md")

        response = client.get("/api/memory/files/notes/demo.md", headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["content"], "remember this")

        escaped = client.get("/api/memory/files/%2e%2e%2fmykey.py", headers=headers)
        self.assertEqual(escaped.status_code, 400)

    def test_workspace_file_api_lists_reads_writes_and_rejects_escape(self):
        client = self._client()
        headers = self._headers(client)

        write = client.put(
            "/api/files",
            json={"root": "workspace", "path": "drafts/a.txt", "content": "hello"},
            headers=headers,
        )
        self.assertEqual(write.status_code, 200, write.text)

        listing = client.get("/api/files", params={"root": "workspace", "path": "drafts"}, headers=headers)
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertEqual([item["name"] for item in listing.json()["items"]], ["a.txt"])

        read = client.get(
            "/api/files",
            params={"root": "workspace", "path": "drafts/a.txt", "read": "true"},
            headers=headers,
        )
        self.assertEqual(read.status_code, 200, read.text)
        self.assertEqual(read.json()["content"], "hello")

        escaped = client.put(
            "/api/files",
            json={"root": "workspace", "path": "../owned.txt", "content": "bad"},
            headers=headers,
        )
        self.assertEqual(escaped.status_code, 400)
        self.assertFalse(Path(self.tmp.name, "owned.txt").exists())

    def test_schedule_api_crud_and_manual_enqueue_records_schedule_task(self):
        client = self._client()
        headers = self._headers(client)

        created = client.post(
            "/api/schedules",
            json={"title": "Daily", "prompt": "summarize", "cron": "0 9 * * *", "enabled": True},
            headers=headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        schedule_id = created.json()["id"]

        updated = client.put(
            f"/api/schedules/{schedule_id}",
            json={"title": "Daily updated", "prompt": "summarize", "cron": "0 10 * * *", "enabled": False},
            headers=headers,
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["title"], "Daily updated")

        enqueued = client.post(f"/api/schedules/{schedule_id}/enqueue", headers=headers)
        self.assertEqual(enqueued.status_code, 200, enqueued.text)
        task = client.get(f"/api/tasks/{enqueued.json()['task_id']}", headers=headers).json()
        self.assertEqual(task["kind"], "schedule")
        self.assertEqual(task["payload"]["schedule_id"], schedule_id)

        reports = client.get("/api/schedules/reports", headers=headers)
        self.assertEqual(reports.status_code, 200, reports.text)
        self.assertEqual(reports.json()["items"][0]["task_id"], enqueued.json()["task_id"])

        deleted = client.delete(f"/api/schedules/{schedule_id}", headers=headers)
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(client.get("/api/schedules", headers=headers).json()["items"], [])

    def test_logs_api_tails_known_log_files(self):
        Path(self.tmp.name, "server.log").write_text("one\ntwo\n", encoding="utf-8")
        client = self._client()
        headers = self._headers(client)

        response = client.get("/api/logs", params={"kind": "server", "lines": 1}, headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["content"], "two\n")

        bad = client.get("/api/logs", params={"kind": "../server"}, headers=headers)
        self.assertEqual(bad.status_code, 400)

    def test_browser_api_uses_worker_scoped_driver(self):
        os.environ["GA_BROWSER_FAKE"] = "1"
        client = self._client()
        headers = self._headers(client)

        created = client.post(
            "/api/browser/workers/worker-1/tabs",
            json={"url": "https://example.test"},
            headers=headers,
        )
        self.assertEqual(created.status_code, 200, created.text)

        tabs = client.get("/api/browser/workers/worker-1/tabs", headers=headers)
        self.assertEqual(tabs.status_code, 200, tabs.text)
        self.assertEqual(tabs.json()["items"][0]["url"], "https://example.test")

        executed = client.post(
            "/api/browser/workers/worker-1/tabs/p1/execute",
            json={"code": "return document.title;"},
            headers=headers,
        )
        self.assertEqual(executed.status_code, 200, executed.text)
        self.assertEqual(executed.json()["data"], "Fake")


if __name__ == "__main__":
    unittest.main()
