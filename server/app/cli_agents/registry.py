from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class ToolSpec:
    id: str
    name: str
    provider: str
    install_kind: str
    package: str
    command: str
    args_template: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, object]:
        data = asdict(self)
        data["args_template"] = list(self.args_template)
        return data


_SPECS = {
    "claude_code": ToolSpec(
        id="claude_code",
        name="Claude Code",
        provider="anthropic",
        install_kind="npm",
        package="@anthropic-ai/claude-code",
        command="claude",
        args_template=("-p", "{prompt}"),
    ),
    "codex": ToolSpec(
        id="codex",
        name="Codex CLI",
        provider="openai",
        install_kind="npm",
        package="@openai/codex",
        command="codex",
        args_template=("exec", "{prompt}"),
    ),
    "opencode": ToolSpec(
        id="opencode",
        name="OpenCode",
        provider="opencode",
        install_kind="npm",
        package="opencode-ai",
        command="opencode",
        args_template=("run", "{prompt}"),
    ),
    "custom_shell": ToolSpec(
        id="custom_shell",
        name="Custom Shell",
        provider="custom",
        install_kind="custom",
        package="",
        command="",
        args_template=(),
    ),
}


def list_tool_specs() -> list[ToolSpec]:
    return list(_SPECS.values())


def get_tool_spec(tool_id: str) -> ToolSpec:
    key = str(tool_id or "").strip()
    if key not in _SPECS:
        raise KeyError(key)
    return _SPECS[key]

