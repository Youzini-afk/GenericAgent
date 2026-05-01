from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

from runtime_paths import runtime_path


class PlaywrightDriver:
    def __init__(self, context=None, max_tabs: int = 6, user_data_dir: str | None = None):
        self.context = context
        self.max_tabs = int(max_tabs)
        self.default_session_id = None
        self._sync = None
        self._playwright = None
        self._browser_context = None
        self.user_data_dir = user_data_dir or str(runtime_path("browser", "default"))
        if self.context is None:
            self._start_context()

    def _start_context(self) -> None:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as e:
            raise RuntimeError("playwright is not installed. Run: python -m pip install playwright") from e
        Path(self.user_data_dir).mkdir(parents=True, exist_ok=True)
        self._sync = sync_playwright().start()
        args = ["--no-sandbox"] if os.environ.get("GA_BROWSER_NO_SANDBOX", "1") == "1" else []
        self.context = self._sync.chromium.launch_persistent_context(
            self.user_data_dir,
            headless=True,
            args=args,
        )
        self._browser_context = self.context
        if not self.context.pages:
            self.context.new_page()

    def close(self) -> None:
        try:
            if self.context:
                self.context.close()
        finally:
            if self._sync:
                self._sync.stop()

    def _active_pages(self):
        pages = [p for p in list(getattr(self.context, "pages", [])) if not getattr(p, "closed", False)]
        if not pages:
            pages = [self.context.new_page()]
        return pages

    def _sid(self, idx: int) -> str:
        return f"p{idx + 1}"

    def _page_by_id(self, session_id: str | None):
        pages = self._active_pages()
        if session_id is None:
            session_id = self.default_session_id or self._sid(0)
        try:
            idx = max(0, int(str(session_id).lstrip("p")) - 1)
        except Exception:
            idx = 0
        if idx >= len(pages):
            idx = 0
        self.default_session_id = self._sid(idx)
        return pages[idx]

    def get_all_sessions(self):
        sessions = []
        for idx, page in enumerate(self._active_pages()):
            try:
                title = page.title()
            except Exception:
                title = ""
            sessions.append({"id": self._sid(idx), "url": getattr(page, "url", ""), "title": title, "type": "playwright"})
        if sessions and self.default_session_id is None:
            self.default_session_id = sessions[0]["id"]
        return sessions

    def get_session_dict(self):
        return {session["id"]: session["url"] for session in self.get_all_sessions()}

    def execute_js(self, code, timeout=15, session_id=None) -> dict[str, Any]:
        page = self._page_by_id(session_id)
        wrapped = f"(() => {{\n{code}\n}})()"
        try:
            data = page.evaluate(wrapped)
            return {"data": data}
        except Exception as e:
            raise Exception(str(e))

    def jump(self, url, timeout=10):
        page = self._page_by_id(None)
        page.goto(url, wait_until="domcontentloaded", timeout=int(timeout * 1000))
        return {"data": {"url": getattr(page, "url", url)}}

    def navigate(self, session_id, url, timeout=10):
        page = self._page_by_id(session_id)
        page.goto(url, wait_until="domcontentloaded", timeout=int(timeout * 1000))
        return {"data": {"url": getattr(page, "url", url)}}

    def screenshot(self, session_id=None):
        page = self._page_by_id(session_id)
        return page.screenshot(type="png")

    def newtab(self, url=None):
        pages = [p for p in list(getattr(self.context, "pages", [])) if not getattr(p, "closed", False)]
        while len(pages) >= self.max_tabs:
            old = pages.pop(0)
            try:
                old.close()
            except Exception:
                pass
        page = self.context.new_page()
        if url:
            page.goto(url, wait_until="domcontentloaded", timeout=15000)
        time.sleep(0.05)
        sessions = self.get_all_sessions()
        self.default_session_id = sessions[-1]["id"]
        return {"data": {"tab_id": self.default_session_id, "url": getattr(page, "url", "")}}
