from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

from runtime_paths import runtime_path
from server.app.cli_agents.registry import get_tool_spec
from server.app.cli_agents.store import CliAgentStore


def cli_tools_dir() -> Path:
    return Path(os.environ.get("GA_CLI_TOOLS_DIR") or runtime_path("tools")).expanduser().resolve()


def command_path_for(install_path: Path, command: str) -> Path:
    suffix = ".cmd" if os.name == "nt" else ""
    return install_path / "node_modules" / ".bin" / f"{command}{suffix}"


class ToolInstaller:
    def __init__(self, store: CliAgentStore):
        self.store = store

    def install(self, tool_id: str, version: str = "latest") -> dict[str, Any]:
        spec = get_tool_spec(tool_id)
        requested = str(version or "latest").strip() or "latest"
        install_path = cli_tools_dir() / spec.id / requested
        command_path = command_path_for(install_path, spec.command) if spec.command else install_path
        self.store.upsert_tool(
            tool_id=spec.id,
            name=spec.name,
            provider=spec.provider,
            install_kind=spec.install_kind,
            requested_version=requested,
            status="installing",
            install_path=str(install_path),
            command_path=str(command_path),
        )

        if spec.install_kind == "custom":
            return self.store.upsert_tool(
                tool_id=spec.id,
                name=spec.name,
                provider=spec.provider,
                install_kind=spec.install_kind,
                requested_version=requested,
                status="installed",
                install_path=str(install_path),
                command_path="",
                resolved_version="custom",
            )

        install_path.mkdir(parents=True, exist_ok=True)
        package = f"{spec.package}@{requested}" if requested != "latest" else spec.package
        try:
            result = subprocess.run(
                ["npm", "install", "--prefix", str(install_path), package],
                text=True,
                capture_output=True,
                timeout=int(os.environ.get("GA_CLI_INSTALL_TIMEOUT_SECONDS", "900") or 900),
            )
            if result.returncode != 0:
                return self._broken(spec.id, requested, install_path, command_path, result.stderr or result.stdout)
            test = self.test_command(str(command_path))
            if test["exit_code"] != 0:
                return self._broken(spec.id, requested, install_path, command_path, test["stderr"] or test["stdout"])
            return self.store.upsert_tool(
                tool_id=spec.id,
                name=spec.name,
                provider=spec.provider,
                install_kind=spec.install_kind,
                requested_version=requested,
                resolved_version=test.get("detected_version") or "",
                status="installed",
                install_path=str(install_path),
                command_path=str(command_path),
            )
        except Exception as exc:
            return self._broken(spec.id, requested, install_path, command_path, str(exc))

    def _broken(self, tool_id: str, version: str, install_path: Path, command_path: Path, error: str) -> dict[str, Any]:
        spec = get_tool_spec(tool_id)
        return self.store.upsert_tool(
            tool_id=spec.id,
            name=spec.name,
            provider=spec.provider,
            install_kind=spec.install_kind,
            requested_version=version,
            status="broken",
            install_path=str(install_path),
            command_path=str(command_path),
            error=str(error or "")[-2000:],
        )

    def test(self, tool_id: str) -> dict[str, Any]:
        tool = self.store.get_tool(tool_id)
        if not tool:
            return {"exit_code": 127, "stdout": "", "stderr": "tool is not installed", "detected_version": ""}
        return self.test_command(tool.get("command_path") or "")

    @staticmethod
    def test_command(command_path: str) -> dict[str, Any]:
        if not command_path:
            return {"exit_code": 0, "stdout": "custom", "stderr": "", "detected_version": "custom"}
        try:
            result = subprocess.run(
                [command_path, "--version"],
                text=True,
                capture_output=True,
                timeout=30,
            )
            output = (result.stdout or result.stderr or "").strip()
            return {
                "exit_code": int(result.returncode),
                "stdout": result.stdout,
                "stderr": result.stderr,
                "detected_version": output.splitlines()[0] if output else "",
            }
        except Exception as exc:
            return {"exit_code": 1, "stdout": "", "stderr": str(exc), "detected_version": ""}

