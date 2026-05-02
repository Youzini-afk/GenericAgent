from __future__ import annotations

from typing import Any


DEFAULT_POLICY = {
    "allow_write": True,
    "allow_tests": True,
    "allow_install": False,
    "allow_network": True,
    "allow_commit": False,
    "allow_push": False,
}


def normalize_policy(policy: dict[str, Any] | None, write_intent: bool = True) -> dict[str, Any]:
    merged = dict(DEFAULT_POLICY)
    merged.update(policy or {})
    merged["write_intent"] = bool(write_intent)
    return merged

