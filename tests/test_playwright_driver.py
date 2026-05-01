import unittest


class FakePage:
    def __init__(self, url="about:blank"):
        self.url = url
        self._title = "Fake"
        self.closed = False

    def title(self):
        return self._title

    def evaluate(self, script):
        if "document.title" in script:
            return self._title
        return {"script": script[:20]}

    def goto(self, url, wait_until="domcontentloaded", timeout=15000):
        self.url = url

    def close(self):
        self.closed = True


class FakeContext:
    def __init__(self):
        self.pages = []

    def new_page(self):
        page = FakePage()
        self.pages.append(page)
        return page


class PlaywrightDriverTests(unittest.TestCase):
    def test_driver_exposes_tmwebdriver_compatible_interface(self):
        from server.app.browser.playwright_driver import PlaywrightDriver

        context = FakeContext()
        driver = PlaywrightDriver(context=context, max_tabs=2)
        driver.newtab("https://example.test")
        sessions = driver.get_all_sessions()
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["url"], "https://example.test")
        self.assertEqual(driver.get_session_dict(), {sessions[0]["id"]: "https://example.test"})
        result = driver.execute_js("return document.title;", session_id=sessions[0]["id"])
        self.assertEqual(result["data"], "Fake")


if __name__ == "__main__":
    unittest.main()
