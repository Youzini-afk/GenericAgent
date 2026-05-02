import os
import contextlib
import io
import sys
import tempfile
import time
import unittest
from pathlib import Path


class CliAgentTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_env = dict(os.environ)
        os.environ["GA_DATA_DIR"] = self.tmp.name
        os.environ["GA_MYKEY_PATH"] = os.path.join(self.tmp.name, "mykey.py")
        os.environ["GA_CLI_DEFAULT_WORKSPACE"] = os.path.join(self.tmp.name, "workspace")
        os.environ["GA_CLI_RUNS_DIR"] = os.path.join(self.tmp.name, "agent-runs")
        os.environ["GA_CLI_TOOLS_DIR"] = os.path.join(self.tmp.name, "tools")
        os.environ["GA_CLI_AUTH_DIR"] = os.path.join(self.tmp.name, "tool-auth")
        os.environ["GA_CLI_RUNNER_CONCURRENCY"] = "0"
        os.environ["GA_ADMIN_PASSWORD"] = "secret"
        Path(os.environ["GA_CLI_DEFAULT_WORKSPACE"]).mkdir(parents=True)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.old_env)
        self.tmp.cleanup()

    def store(self):
        from server.app.cli_agents.store import CliAgentStore

        return CliAgentStore(os.path.join(self.tmp.name, "app.db"))


class CliAgentStoreTests(CliAgentTestCase):
    def test_registry_contains_builtin_cli_agents(self):
        from server.app.cli_agents.registry import list_tool_specs

        specs = {item.id: item for item in list_tool_specs()}
        self.assertEqual(specs["claude_code"].package, "@anthropic-ai/claude-code")
        self.assertEqual(specs["codex"].command, "codex")
        self.assertEqual(specs["opencode"].package, "opencode-ai")
        self.assertEqual(specs["custom_shell"].install_kind, "custom")

    def test_env_profiles_mask_secrets_but_preserve_raw_values_for_runner(self):
        store = self.store()
        profile = store.create_env_profile(
            name="Codex",
            tool_id="codex",
            env={"OPENAI_API_KEY": "sk-real", "GA_VISIBLE": "hello", "password": "pw"},
        )

        masked = store.get_env_profile(profile["id"], mask_secrets=True)
        raw = store.get_env_profile(profile["id"], mask_secrets=False)

        self.assertEqual(masked["env"]["OPENAI_API_KEY"], "********")
        self.assertEqual(masked["env"]["password"], "********")
        self.assertEqual(masked["env"]["GA_VISIBLE"], "hello")
        self.assertEqual(raw["env"]["OPENAI_API_KEY"], "sk-real")

    def test_run_lifecycle_events_and_cancel_pending(self):
        store = self.store()
        run = store.create_run(provider="codex", prompt="implement", target_workspace=None, write_intent=True, policy={})
        self.assertEqual(run["status"], "pending")

        leased = store.lease_next_run("slot-1")
        self.assertEqual(leased["id"], run["id"])
        self.assertEqual(store.get_run(run["id"])["status"], "preparing")
        store.mark_run_running(run["id"])
        store.append_event(run["id"], "stdout", {"text": "hello"})
        store.finish_run(run["id"], "succeeded", result={"summary": "ok", "exit_code": 0})

        final = store.get_run(run["id"])
        self.assertEqual(final["status"], "succeeded")
        self.assertEqual(final["result"]["summary"], "ok")
        self.assertEqual([event["type"] for event in store.events_after(run["id"], 0)], ["status", "status", "status", "stdout", "result", "done"])

        pending = store.create_run(provider="codex", prompt="later", target_workspace=None, write_intent=True, policy={})
        self.assertTrue(store.request_cancel(pending["id"]))
        self.assertEqual(store.get_run(pending["id"])["status"], "canceled")

    def test_workspace_direct_then_copy_for_concurrent_writers(self):
        from server.app.cli_agents.workspace import WorkspaceManager

        store = self.store()
        manager = WorkspaceManager(store)
        target = os.environ["GA_CLI_DEFAULT_WORKSPACE"]
        (Path(target) / "hello.txt").write_text("hello", encoding="utf-8")

        first = store.create_run(provider="codex", prompt="one", target_workspace=target, write_intent=True, policy={})
        prepared_first = manager.prepare(first)
        self.assertEqual(prepared_first["workspace_mode"], "direct")
        self.assertEqual(Path(prepared_first["effective_workspace"]).resolve(), Path(target).resolve())

        second = store.create_run(provider="codex", prompt="two", target_workspace=target, write_intent=True, policy={})
        prepared_second = manager.prepare(second)
        self.assertEqual(prepared_second["workspace_mode"], "copy")
        self.assertNotEqual(Path(prepared_second["effective_workspace"]).resolve(), Path(target).resolve())
        self.assertTrue(Path(prepared_second["effective_workspace"], "hello.txt").exists())

        manager.release(prepared_first["id"])
        third = store.create_run(provider="codex", prompt="three", target_workspace=target, write_intent=True, policy={})
        prepared_third = manager.prepare(third)
        self.assertEqual(prepared_third["workspace_mode"], "direct")

    def test_workspace_validation_rejects_paths_outside_allowed_roots(self):
        from server.app.cli_agents.workspace import WorkspaceManager

        store = self.store()
        manager = WorkspaceManager(store)
        outside = Path(self.tmp.name).parent / "outside-workspace"
        run = store.create_run(provider="codex", prompt="bad", target_workspace=str(outside), write_intent=True, policy={})

        with self.assertRaises(ValueError):
            manager.prepare(run)


class CliAgentRunnerTests(CliAgentTestCase):
    def test_runner_streams_output_captures_diff_and_result(self):
        from server.app.cli_agents.runner import CliRunner

        store = self.store()
        workspace = Path(os.environ["GA_CLI_DEFAULT_WORKSPACE"])
        (workspace / "existing.txt").write_text("before", encoding="utf-8")
        fake_cli = Path(self.tmp.name) / "fake_cli.py"
        fake_cli.write_text(
            "import pathlib, sys\n"
            "print('out:' + sys.stdin.read().strip())\n"
            "print('err-line', file=sys.stderr)\n"
            "pathlib.Path('existing.txt').write_text('after', encoding='utf-8')\n"
            "pathlib.Path('created.txt').write_text('new', encoding='utf-8')\n",
            encoding="utf-8",
        )
        run = store.create_run(
            provider="custom_shell",
            prompt="change files",
            target_workspace=str(workspace),
            write_intent=True,
            policy={"command_argv": [sys.executable, str(fake_cli)]},
        )

        runner = CliRunner(store)
        runner.execute(run)

        final = store.get_run(run["id"])
        self.assertEqual(final["status"], "succeeded", final["error"])
        self.assertIn("existing.txt", final["result"]["changed_files"])
        self.assertIn("created.txt", final["result"]["changed_files"])
        self.assertIn("out:change files", final["result"]["stdout_tail"])
        self.assertTrue(Path(final["result"]["diff_path"]).exists())
        self.assertTrue(any(event["type"] == "stderr" for event in store.events_after(run["id"], 0)))

    def test_runner_timeout_marks_run_interrupted(self):
        from server.app.cli_agents.runner import CliRunner

        os.environ["GA_CLI_RUN_TIMEOUT_SECONDS"] = "1"
        store = self.store()
        fake_cli = Path(self.tmp.name) / "slow_cli.py"
        fake_cli.write_text("import time\nprint('start')\ntime.sleep(30)\n", encoding="utf-8")
        run = store.create_run(
            provider="custom_shell",
            prompt="wait",
            target_workspace=os.environ["GA_CLI_DEFAULT_WORKSPACE"],
            write_intent=False,
            policy={"command_argv": [sys.executable, str(fake_cli)]},
        )

        CliRunner(store).execute(run)

        final = store.get_run(run["id"])
        self.assertEqual(final["status"], "interrupted")
        self.assertIn("timed out", final["error"])

    def test_runner_respects_cancel_before_process_start(self):
        from server.app.cli_agents.runner import CliRunner

        store = self.store()
        run = store.create_run(
            provider="custom_shell",
            prompt="do not run",
            target_workspace=os.environ["GA_CLI_DEFAULT_WORKSPACE"],
            write_intent=False,
            policy={"command_argv": [sys.executable, "-c", "raise SystemExit(2)"]},
        )
        store.request_cancel(run["id"])

        CliRunner(store).execute(store.get_run(run["id"]))

        self.assertEqual(store.get_run(run["id"])["status"], "canceled")


class CliAgentApiTests(CliAgentTestCase):
    def setUp(self):
        super().setUp()
        self.web_dist = Path(self.tmp.name) / "webdist"
        self.web_dist.mkdir()
        (self.web_dist / "index.html").write_text("<html></html>", encoding="utf-8")
        (self.web_dist / "assets").mkdir()
        os.environ["GA_WEB_DIST_DIR"] = str(self.web_dist)
        os.environ["GA_WORKER_CONCURRENCY"] = "0"

    def _client_and_headers(self):
        from fastapi.testclient import TestClient
        from server.app.main import create_app

        client = TestClient(create_app())
        token = client.post("/api/auth/login", json={"password": "secret"}).json()["token"]
        return client, {"Authorization": f"Bearer {token}"}

    def test_cli_api_requires_auth_and_creates_run(self):
        client, headers = self._client_and_headers()
        self.assertEqual(client.get("/api/cli-tools").status_code, 401)

        tools = client.get("/api/cli-tools", headers=headers)
        self.assertEqual(tools.status_code, 200, tools.text)
        self.assertIn("codex", [item["id"] for item in tools.json()["items"]])

        response = client.post(
            "/api/cli-runs",
            headers=headers,
            json={"provider": "codex", "prompt": "hello", "target_workspace": os.environ["GA_CLI_DEFAULT_WORKSPACE"], "write_intent": True, "policy": {}},
        )
        self.assertEqual(response.status_code, 200, response.text)
        run_id = response.json()["id"]
        self.assertEqual(client.get(f"/api/cli-runs/{run_id}", headers=headers).json()["status"], "pending")

    def test_session_child_runs_endpoint_filters_by_parent_session(self):
        client, headers = self._client_and_headers()
        payload = {"provider": "codex", "prompt": "child", "target_workspace": os.environ["GA_CLI_DEFAULT_WORKSPACE"], "write_intent": True, "policy": {}, "parent_session_id": "s1"}
        run = client.post("/api/cli-runs", headers=headers, json=payload).json()
        client.post("/api/cli-runs", headers=headers, json={**payload, "parent_session_id": "s2"})

        response = client.get("/api/sessions/s1/cli-runs", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["id"] for item in response.json()["items"]], [run["id"]])


class GenericAgentCliToolTests(CliAgentTestCase):
    def test_cli_agent_start_records_current_parent_task_and_session(self):
        os.environ["GA_CURRENT_TASK_ID"] = "task-parent"
        os.environ["GA_CURRENT_SESSION_ID"] = "session-parent"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            import ga
            result = ga.cli_agent_start("custom_shell", "hello", write_intent=False, policy={"command_argv": [sys.executable, "-c", "print('x')"]})

        run = self.store().get_run(result["run_id"])
        self.assertEqual(run["parent_task_id"], "task-parent")
        self.assertEqual(run["parent_session_id"], "session-parent")


if __name__ == "__main__":
    unittest.main()
