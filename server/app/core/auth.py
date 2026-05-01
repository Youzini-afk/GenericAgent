from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path


class AuthManager:
    def __init__(self, data_dir: str | os.PathLike[str], admin_password: str, ttl_seconds: int = 86400):
        if not admin_password:
            raise ValueError("GA_ADMIN_PASSWORD is required")
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.admin_password = admin_password
        self.ttl_seconds = int(ttl_seconds)
        self.secret = self._load_or_create_secret()

    def _load_or_create_secret(self) -> bytes:
        path = self.data_dir / "server_secret"
        if path.exists():
            raw = path.read_text(encoding="utf-8").strip()
            if raw:
                return raw.encode("utf-8")
        raw = secrets.token_urlsafe(48)
        path.write_text(raw, encoding="utf-8")
        return raw.encode("utf-8")

    @staticmethod
    def _b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")

    @staticmethod
    def _unb64(text: str) -> bytes:
        return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))

    def issue_token(self, password: str) -> str:
        if not hmac.compare_digest(str(password or ""), self.admin_password):
            raise PermissionError("invalid password")
        payload = {"iat": int(time.time()), "exp": int(time.time()) + self.ttl_seconds, "nonce": secrets.token_hex(8)}
        body = self._b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        sig = self._b64(hmac.new(self.secret, body.encode("ascii"), hashlib.sha256).digest())
        return f"{body}.{sig}"

    def verify_token(self, token: str) -> bool:
        try:
            body, sig = str(token or "").split(".", 1)
            expected = self._b64(hmac.new(self.secret, body.encode("ascii"), hashlib.sha256).digest())
            if not hmac.compare_digest(sig, expected):
                return False
            payload = json.loads(self._unb64(body).decode("utf-8"))
            return int(payload.get("exp", 0)) >= int(time.time())
        except Exception:
            return False
