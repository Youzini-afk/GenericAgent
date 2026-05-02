from __future__ import annotations

from collections import Counter
from typing import Any

from server.app.cli_agents.registry import get_tool_spec
from server.app.cli_agents.store import CliAgentStore


PROVIDERS = ("codex", "claude_code", "opencode", "custom_shell")


def _contains(text: str, *needles: str) -> bool:
    lowered = text.lower()
    return any(item in lowered for item in needles)


def _tool_is_available(store: CliAgentStore, provider: str) -> bool:
    if provider == "custom_shell":
        return True
    tool = store.get_tool(provider)
    return bool(tool and tool.get("status") == "installed")


def _base_scores(goal: str, mode: str, task_size: str, domain: str, risk: str) -> tuple[dict[str, float], dict[str, list[str]]]:
    text = goal or ""
    mode = (mode or "implement").lower()
    task_size = (task_size or "medium").lower()
    domain = (domain or "unknown").lower()
    risk = (risk or "medium").lower()
    scores = {provider: 0.25 for provider in PROVIDERS}
    reasons = {provider: [] for provider in PROVIDERS}

    def add(provider: str, amount: float, reason: str) -> None:
        scores[provider] += amount
        reasons[provider].append(reason)

    if task_size == "large" or risk == "high" or _contains(text, "refactor", "architecture", "cross-module", "complex", "large", "migration"):
        add("codex", 0.45, "large or cross-module engineering work")
    if mode in {"analyze", "review"} or _contains(text, "understand", "architecture", "design", "review", "explain"):
        add("codex", 0.18, "complex code understanding")
        add("claude_code", 0.2, "context judgement or review")
    if domain == "frontend" or _contains(text, "frontend", "react", "vite", "ui", "interaction", "ux", "visual", "component", "layout"):
        add("claude_code", 0.55, "frontend or interaction judgement")
    if mode == "implement" and task_size in {"small", "medium"} and risk in {"low", "medium"}:
        add("opencode", 0.42, "ordinary small or medium implementation")
    if _contains(text, "small", "focused", "endpoint", "field", "bugfix", "ordinary", "simple"):
        add("opencode", 0.18, "bounded implementation scope")
    if mode == "verify" or _contains(text, "test", "smoke", "script", "verify", "lint"):
        add("custom_shell", 0.6, "scripted verification")

    return scores, reasons


def _apply_profile_feedback(store: CliAgentStore, scores: dict[str, float], reasons: dict[str, list[str]]) -> None:
    for profile in store.list_provider_profiles():
        provider = profile["provider"]
        if provider not in scores:
            continue
        success = int(profile.get("recent_success") or 0)
        failure = int(profile.get("recent_failure") or 0)
        if failure > success:
            penalty = min(0.75, 0.25 * (failure - success))
            scores[provider] -= penalty
            reasons[provider].append(f"recent failures lowered confidence by {penalty:.2f}")
        elif success > failure:
            bonus = min(0.18, 0.04 * (success - failure))
            scores[provider] += bonus
            reasons[provider].append(f"recent successes raised confidence by {bonus:.2f}")


def _sorted_scores(scores: dict[str, float]) -> list[tuple[str, float]]:
    return sorted(scores.items(), key=lambda item: (-item[1], item[0]))


def select_provider(
    store: CliAgentStore,
    *,
    goal: str,
    mode: str = "implement",
    task_size: str = "medium",
    domain: str = "unknown",
    risk: str = "medium",
    preferred_provider: str | None = None,
) -> dict[str, Any]:
    scores, reasons = _base_scores(goal, mode, task_size, domain, risk)
    base_winner = _sorted_scores(scores)[0][0]
    _apply_profile_feedback(store, scores, reasons)

    if preferred_provider:
        get_tool_spec(preferred_provider)
        provider = preferred_provider
        reason = f"explicit provider requested: {preferred_provider}"
        fallback = _sorted_scores({key: value for key, value in scores.items() if key != provider})[0][0]
    else:
        provider = _sorted_scores(scores)[0][0]
        reason = "; ".join(reasons.get(provider) or ["balanced provider fit"])
        fallback = base_winner if base_winner != provider else _sorted_scores({key: value for key, value in scores.items() if key != provider})[0][0]

    confidence = max(0.35, min(0.95, round(scores.get(provider, 0.25), 2)))
    return {
        "provider": provider,
        "mode": mode or "implement",
        "confidence": confidence,
        "reason": reason,
        "fallback_provider": fallback,
        "needs_install": not _tool_is_available(store, provider),
        "available": _tool_is_available(store, provider),
    }


def compare_results(store: CliAgentStore, run_ids: list[str]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for run_id in run_ids:
        run = store.get_run(run_id)
        if not run:
            raise KeyError(run_id)
        result = run.get("result") or {}
        orchestration = (run.get("policy") or {}).get("_orchestration") or {}
        items.append(
            {
                "run_id": run["id"],
                "provider": run["provider"],
                "status": run["status"],
                "mode": orchestration.get("mode", ""),
                "provider_reason": orchestration.get("provider_reason", ""),
                "summary": result.get("summary", ""),
                "changed_files": result.get("changed_files", []),
                "diff_path": result.get("diff_path", ""),
                "blockers": result.get("blockers", []),
                "stderr_tail": result.get("stderr_tail", ""),
            }
        )
    counts = Counter(item["status"] for item in items)
    summary_parts = [f"{count} {status}" for status, count in sorted(counts.items())]
    return {
        "items": items,
        "combined_summary": f"Compared {len(items)} run(s): " + (", ".join(summary_parts) if summary_parts else "no runs"),
    }
