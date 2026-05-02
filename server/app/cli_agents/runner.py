from __future__ import annotations

import os
import json
import queue
import shlex
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from runtime_paths import runtime_path
from server.app.cli_agents.registry import get_tool_spec
from server.app.cli_agents.result import collect_diff, create_baseline, tail_file
from server.app.cli_agents.store import CliAgentStore
from server.app.cli_agents.workspace import WorkspaceManager

BASE_ENV_KEYS = {
    "PATH",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
}


def _tool_auth_home(provider: str) -> Path:
    base = Path(os.environ.get("GA_CLI_AUTH_DIR") or runtime_path("tool-auth")).expanduser().resolve()
    return base / provider / "home"


def _split_command(command: str) -> list[str]:
    return shlex.split(command, posix=os.name != "nt")


def _format_arg(value: str, prompt: str, workspace: str, run_id: str) -> str:
    return value.format(prompt=prompt, workspace=workspace, run_id=run_id)


class CliRunner:
    def __init__(self, store: CliAgentStore):
        self.store = store
        self.workspace = WorkspaceManager(store)

    def execute(self, run: dict[str, Any]) -> None:
        run_id = run["id"]
        run_dir = self.workspace.run_dir(run_id)
        logs_dir = run_dir / "logs"
        transcript_dir = run_dir / "transcript"
        baseline_path = run_dir / "baseline.json"
        diff_path = run_dir / "diff.patch"
        result_path = run_dir / "result.json"
        stdout_path = logs_dir / "stdout.log"
        stderr_path = logs_dir / "stderr.log"
        run_dir.mkdir(parents=True, exist_ok=True)
        logs_dir.mkdir(parents=True, exist_ok=True)
        transcript_dir.mkdir(parents=True, exist_ok=True)

        status = "failed"
        error = ""
        result: dict[str, Any] = {}
        try:
            if run.get("status") == "pending":
                self.store.mark_run_preparing(run_id)
            run = self.workspace.prepare(self.store.get_run(run_id) or run)
            current = self.store.get_run(run_id)
            if current and current.get("cancel_requested"):
                result = {
                    "summary": "canceled before process start",
                    "changed_files": [],
                    "diff_path": str(diff_path),
                    "exit_code": None,
                    "stdout_tail": "",
                    "stderr_tail": "",
                    "blockers": [],
                }
                self.store.finish_run(run_id, "canceled", result=result, error="")
                return
            workspace = Path(run["effective_workspace"]).resolve()
            create_baseline(workspace, baseline_path)
            self._write_run_metadata(run_dir / "run.json", run)
            command = self._build_command(run)
            env = self._build_env(run, command)
            self.store.mark_run_running(run_id)
            status, error, exit_code = self._run_process(run, command, env, workspace, stdout_path, stderr_path)
            diff = collect_diff(workspace, baseline_path, diff_path)
            result = {
                "summary": self._summary(status, exit_code, diff["changed_files"], error),
                "changed_files": diff["changed_files"],
                "diff_path": str(diff_path),
                "exit_code": exit_code,
                "stdout_tail": tail_file(stdout_path),
                "stderr_tail": tail_file(stderr_path),
                "blockers": [error] if error and status != "succeeded" else [],
            }
            result_path.write_text(self.store._json(result), encoding="utf-8")
            self.store.finish_run(run_id, status, result=result, error=error)
            self._record_provider_feedback(run, status, result, error)
        except Exception as exc:
            error = str(exc)
            result = {
                "summary": f"failed before completion: {error}",
                "changed_files": [],
                "diff_path": str(diff_path),
                "exit_code": None,
                "stdout_tail": tail_file(stdout_path),
                "stderr_tail": tail_file(stderr_path),
                "blockers": [error],
            }
            try:
                result_path.write_text(self.store._json(result), encoding="utf-8")
            except Exception:
                pass
            self.store.finish_run(run_id, "failed", result=result, error=error)
            self._record_provider_feedback(run, "failed", result, error)
        finally:
            self.workspace.release(run_id)

    def _build_command(self, run: dict[str, Any]) -> list[str]:
        provider = run["provider"]
        policy = run.get("policy") or {}
        prompt = run.get("prompt") or ""
        workspace = run.get("effective_workspace") or run.get("target_workspace") or ""
        if provider == "custom_shell":
            command_argv = policy.get("command_argv")
            if isinstance(command_argv, list) and command_argv:
                return [str(_format_arg(str(item), prompt, workspace, run["id"])) for item in command_argv]
            command_template = str(policy.get("command_template") or policy.get("command") or "").strip()
            if command_template:
                return _split_command(_format_arg(command_template, prompt, workspace, run["id"]))
            raise ValueError("custom_shell requires policy.command_argv or policy.command_template")

        tool = self.store.get_tool(provider)
        if not tool or tool.get("status") != "installed":
            raise ValueError(f"CLI tool is not installed: {provider}")
        command_path = tool.get("command_path") or ""
        if not command_path:
            raise ValueError(f"CLI tool command path is empty: {provider}")
        spec = get_tool_spec(provider)
        args = [_format_arg(arg, prompt, workspace, run["id"]) for arg in spec.args_template]
        return [command_path, *args]

    def _build_env(self, run: dict[str, Any], command: list[str]) -> dict[str, str]:
        env = {key: value for key, value in os.environ.items() if key in BASE_ENV_KEYS}
        provider = run.get("provider") or "custom"
        home = _tool_auth_home(provider)
        home.mkdir(parents=True, exist_ok=True)
        env["HOME"] = str(home)
        env["USERPROFILE"] = str(home)
        env["XDG_CONFIG_HOME"] = str(home / ".config")
        env["GA_CLI_RUN_ID"] = run["id"]
        env["GA_DATA_DIR"] = str(runtime_path())
        env["GA_CLI_WORKSPACE"] = run.get("effective_workspace") or run.get("target_workspace") or ""
        if command:
            bin_dir = str(Path(command[0]).parent)
            env["PATH"] = bin_dir + os.pathsep + env.get("PATH", "")
        profile_id = run.get("env_profile_id")
        if profile_id:
            profile = self.store.get_env_profile(profile_id, mask_secrets=False)
            if profile:
                for key, value in (profile.get("env") or {}).items():
                    env[str(key)] = str(value)
        return env

    def _run_process(
        self,
        run: dict[str, Any],
        command: list[str],
        env: dict[str, str],
        workspace: Path,
        stdout_path: Path,
        stderr_path: Path,
    ) -> tuple[str, str, int | None]:
        timeout_seconds = int(os.environ.get("GA_CLI_RUN_TIMEOUT_SECONDS", "7200") or 7200)
        output_limit = int(os.environ.get("GA_CLI_OUTPUT_LIMIT_BYTES", "1000000") or 1000000)
        events: queue.Queue[tuple[str, str]] = queue.Queue()
        startupinfo = None
        creationflags = 0
        if os.name == "nt":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = 0
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP
        proc = subprocess.Popen(
            command,
            cwd=str(workspace),
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            startupinfo=startupinfo,
            creationflags=creationflags,
        )
        if proc.stdin:
            try:
                proc.stdin.write(str(run.get("prompt") or ""))
                proc.stdin.close()
            except Exception:
                pass

        stdout_count = 0
        stderr_count = 0
        stdout_thread = threading.Thread(target=self._read_stream, args=(proc.stdout, "stdout", stdout_path, events), daemon=True)
        stderr_thread = threading.Thread(target=self._read_stream, args=(proc.stderr, "stderr", stderr_path, events), daemon=True)
        stdout_thread.start()
        stderr_thread.start()
        started = time.time()
        final_status = ""
        error = ""

        while proc.poll() is None:
            stdout_count, stderr_count = self._drain_events(run["id"], events, stdout_count, stderr_count, output_limit)
            current = self.store.get_run(run["id"])
            if current and current.get("cancel_requested"):
                final_status = "canceled"
                error = "canceled"
                self._kill_tree(proc)
                break
            if timeout_seconds > 0 and time.time() - started > timeout_seconds:
                final_status = "interrupted"
                error = f"run timed out after {timeout_seconds} seconds"
                self._kill_tree(proc)
                break
            time.sleep(0.05)

        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._kill_tree(proc)
        stdout_thread.join(timeout=2)
        stderr_thread.join(timeout=2)
        for stream in (proc.stdout, proc.stderr):
            try:
                if stream:
                    stream.close()
            except Exception:
                pass
        stdout_count, stderr_count = self._drain_events(run["id"], events, stdout_count, stderr_count, output_limit)
        exit_code = proc.poll()
        if final_status:
            return final_status, error, exit_code
        if exit_code == 0:
            return "succeeded", "", exit_code
        return "failed", f"process exited with code {exit_code}", exit_code

    def _read_stream(self, stream, event_type: str, log_path: Path, events: queue.Queue[tuple[str, str]]) -> None:
        if stream is None:
            return
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8", errors="replace") as log:
            for line in stream:
                log.write(line)
                log.flush()
                events.put((event_type, line))

    def _drain_events(self, run_id: str, events: queue.Queue[tuple[str, str]], stdout_count: int, stderr_count: int, limit: int) -> tuple[int, int]:
        while True:
            try:
                event_type, text = events.get_nowait()
            except queue.Empty:
                return stdout_count, stderr_count
            encoded_len = len(text.encode("utf-8", errors="replace"))
            if event_type == "stdout":
                stdout_count += encoded_len
                if stdout_count <= limit:
                    self.store.append_event(run_id, "stdout", {"text": text})
            else:
                stderr_count += encoded_len
                if stderr_count <= limit:
                    self.store.append_event(run_id, "stderr", {"text": text})

    def _kill_tree(self, proc: subprocess.Popen) -> None:
        try:
            import psutil

            parent = psutil.Process(proc.pid)
            children = parent.children(recursive=True)
            for child in children:
                child.terminate()
            parent.terminate()
            gone, alive = psutil.wait_procs([parent, *children], timeout=2)
            for item in alive:
                item.kill()
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    @staticmethod
    def _summary(status: str, exit_code: int | None, changed_files: list[str], error: str) -> str:
        if status == "succeeded":
            return f"completed with exit code {exit_code}; changed {len(changed_files)} file(s)"
        if status == "canceled":
            return "canceled by user"
        if status == "interrupted":
            return error or "interrupted"
        return error or f"failed with exit code {exit_code}"

    @staticmethod
    def _write_run_metadata(path: Path, run: dict[str, Any]) -> None:
        path.write_text(json.dumps(run, ensure_ascii=False, indent=2, default=str), encoding="utf-8")

    def _record_provider_feedback(self, run: dict[str, Any], status: str, result: dict[str, Any], error: str) -> None:
        provider = run.get("provider")
        if not provider:
            return
        policy = run.get("policy") or {}
        orchestration = policy.get("_orchestration") or {}
        tags = [orchestration.get("mode") or "run"]
        if policy.get("write_intent"):
            tags.append("write")
        blockers = result.get("blockers") or []
        outcome = "success" if status == "succeeded" and not blockers else "failure"
        note = error or (str(blockers[0]) if blockers else "")
        try:
            self.store.update_provider_profile(provider, tags, outcome, note=note)
        except Exception:
            pass
