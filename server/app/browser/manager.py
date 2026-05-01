from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

from runtime_paths import runtime_path
from server.app.browser.playwright_driver import PlaywrightDriver


class FakeBrowserDriver:
    def __init__(self):
        self.pages: list[dict[str, Any]] = []
        self.default_session_id: str | None = None

    def _sid(self, index: int) -> str:
        return f"p{index + 1}"

    def get_all_sessions(self):
        return [
            {"id": self._sid(i), "url": page["url"], "title": page.get("title", "Fake"), "type": "playwright"}
            for i, page in enumerate(self.pages)
        ]

    def get_session_dict(self):
        return {session["id"]: session["url"] for session in self.get_all_sessions()}

    def newtab(self, url=None):
        self.pages.append({"url": url or "about:blank", "title": "Fake"})
        self.default_session_id = self._sid(len(self.pages) - 1)
        return {"data": {"tab_id": self.default_session_id, "url": self.pages[-1]["url"]}}

    def jump(self, url, timeout=10):
        if not self.pages:
            self.newtab()
        idx = max(0, int(str(self.default_session_id or "p1").lstrip("p")) - 1)
        self.pages[idx]["url"] = url
        return {"data": {"url": url}}

    def execute_js(self, code, timeout=15, session_id=None):
        if "document.title" in str(code):
            return {"data": "Fake"}
        return {"data": {"script": str(code)[:40]}}

    def screenshot(self, session_id=None):
        # 1x1 transparent PNG.
        return base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
        )


class BrowserRegistry:
    def __init__(self, fake: bool = False):
        self.fake = fake
        self._drivers: dict[str, Any] = {}

    def get(self, worker_id: str):
        key = str(worker_id or "worker-1")
        if key not in self._drivers:
            if self.fake:
                self._drivers[key] = FakeBrowserDriver()
            else:
                profile = Path(runtime_path("browser", "workers", key))
                profile.mkdir(parents=True, exist_ok=True)
                self._drivers[key] = PlaywrightDriver(user_data_dir=str(profile))
        return self._drivers[key]

    def close_all(self) -> None:
        for driver in self._drivers.values():
            close = getattr(driver, "close", None)
            if close:
                close()
        self._drivers.clear()
