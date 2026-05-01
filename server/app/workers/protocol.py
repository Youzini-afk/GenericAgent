from __future__ import annotations

import json
import sys
from typing import Any, TextIO


def encode_message(command: str, **payload: Any) -> str:
    return json.dumps({"cmd": command, **payload}, ensure_ascii=False) + "\n"


def decode_message(line: str) -> dict[str, Any]:
    return json.loads(line)


def send_message(stream: TextIO, event: str, **payload: Any) -> None:
    stream.write(json.dumps({"event": event, **payload}, ensure_ascii=False) + "\n")
    stream.flush()


def send_stdout(event: str, **payload: Any) -> None:
    send_message(sys.stdout, event, **payload)
