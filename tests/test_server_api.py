import os
import tempfile
import unittest
from pathlib import Path


class ServerApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_env = dict(os.environ)
        os.environ["GA_DATA_DIR"] = self.tmp.name
        os.environ["GA_MYKEY_PATH"] = os.path.join(self.tmp.name, "mykey.py")
        os.environ["GA_ADMIN_PASSWORD"] = "secret"
        os.environ["GA_WORKER_CONCURRENCY"] = "0"
        self.web_dist = Path(self.tmp.name) / "webdist"
        self.web_dist.mkdir()
        (self.web_dist / "index.html").write_text("<html><body>GenericAgent SPA</body></html>", encoding="utf-8")
        (self.web_dist / "assets").mkdir()
        (self.web_dist / "assets" / "app.js").write_text("console.log('ok')", encoding="utf-8")
        os.environ["GA_WEB_DIST_DIR"] = str(self.web_dist)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.old_env)
        self.tmp.cleanup()

    def _client(self):
        from fastapi.testclient import TestClient
        from server.app.main import create_app

        return TestClient(create_app())

    def _token(self, client):
        response = client.post("/api/auth/login", json={"password": "secret"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["token"]

    def test_auth_protects_status_and_login_returns_token(self):
        client = self._client()
        self.assertEqual(client.get("/api/status").status_code, 401)
        token = self._token(client)
        response = client.get("/api/status", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("data_dir", response.json())

    def test_single_service_serves_spa_without_shadowing_api(self):
        client = self._client()
        root = client.get("/")
        self.assertEqual(root.status_code, 200)
        self.assertIn("GenericAgent SPA", root.text)

        deep_link = client.get("/queue/tasks")
        self.assertEqual(deep_link.status_code, 200)
        self.assertIn("GenericAgent SPA", deep_link.text)

        asset = client.get("/assets/app.js")
        self.assertEqual(asset.status_code, 200)
        self.assertIn("console.log", asset.text)

        health = client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json(), {"ok": True})

    def test_chat_message_enqueues_task_and_events_are_readable(self):
        client = self._client()
        token = self._token(client)
        headers = {"Authorization": f"Bearer {token}"}
        session = client.post("/api/sessions", json={"title": "Demo"}, headers=headers).json()
        response = client.post(
            f"/api/sessions/{session['id']}/messages",
            json={"content": "hello"},
            headers=headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        task_id = response.json()["task_id"]
        self.assertEqual(response.json()["status"], "queued")

        task = client.get(f"/api/tasks/{task_id}", headers=headers)
        self.assertEqual(task.status_code, 200)
        self.assertEqual(task.json()["session_id"], session["id"])
        events = client.get(f"/api/tasks/{task_id}/events", headers=headers)
        self.assertEqual(events.status_code, 200)
        self.assertEqual(events.json()["events"], [])

    def test_cancel_pending_task(self):
        client = self._client()
        token = self._token(client)
        headers = {"Authorization": f"Bearer {token}"}
        session = client.post("/api/sessions", json={"title": "Cancel"}, headers=headers).json()
        task_id = client.post(
            f"/api/sessions/{session['id']}/messages",
            json={"content": "stop me"},
            headers=headers,
        ).json()["task_id"]
        response = client.post(f"/api/tasks/{task_id}/cancel", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.get(f"/api/tasks/{task_id}", headers=headers).json()["status"], "canceled")

    def test_chat_enqueue_rejects_when_queue_is_full(self):
        os.environ["GA_MAX_QUEUE_SIZE"] = "1"
        client = self._client()
        token = self._token(client)
        headers = {"Authorization": f"Bearer {token}"}
        first = client.post("/api/sessions", json={"title": "A"}, headers=headers).json()
        second = client.post("/api/sessions", json={"title": "B"}, headers=headers).json()

        ok = client.post(f"/api/sessions/{first['id']}/messages", json={"content": "one"}, headers=headers)
        self.assertEqual(ok.status_code, 200, ok.text)
        full = client.post(f"/api/sessions/{second['id']}/messages", json={"content": "two"}, headers=headers)
        self.assertEqual(full.status_code, 429)


if __name__ == "__main__":
    unittest.main()
