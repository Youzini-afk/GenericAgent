from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_SRC = ROOT / "web" / "src"


def read_web(path: str) -> str:
    return (WEB_SRC / path).read_text(encoding="utf-8")


class WebP3RegressionTests(unittest.TestCase):
    def test_cli_run_stream_uses_secure_same_origin_url_and_resumes_after_seq(self):
        source = read_web("useCliRunStream.ts")

        self.assertIn('window.location.protocol === "https:" ? "wss:" : "ws:"', source)
        self.assertIn("after_seq", source)
        self.assertIn("lastSeqRef", source)
        self.assertIn("seenSeqsRef", source)
        self.assertIn("window.clearTimeout", source)

    def test_shell_uses_resizable_panels_for_main_aux_and_terminal_regions(self):
        source = read_web("components/layout/AppShell.tsx")

        self.assertIn('from "react-resizable-panels"', source)
        self.assertIn("<PanelGroup", source)
        self.assertIn("<PanelResizeHandle", source)
        self.assertGreaterEqual(len(re.findall(r"<Panel\b", source)), 3)

    def test_run_detail_refreshes_static_result_when_stream_finishes(self):
        source = read_web("App.tsx")

        self.assertIn("lastCliRunEvent", source)
        self.assertIn('["done", "error", "canceled"]', source)
        self.assertIn("setRun(undefined)", source)

    def test_agent_runs_detail_uses_cli_run_stream_instead_of_detail_polling(self):
        source = read_web("pages/AgentRunsPage.tsx")

        self.assertIn("useCliRunStream", source)
        self.assertNotIn("setInterval(() => loadDetail", source)

    def test_layout_and_aux_panel_strings_go_through_i18n(self):
        checked_files = [
            "components/layout/TerminalPanel.tsx",
            "components/layout/StatusBar.tsx",
            "components/layout/AuxPanel.tsx",
            "components/common/DiffViewer.tsx",
        ]
        joined = "\n".join(read_web(path) for path in checked_files)

        for text in [">Terminal<", ">No output<", "Changed files (", ">Blockers<", ">No diff<", ">workers:", ">tasks:", ">cli:"]:
            self.assertNotIn(text, joined)

        i18n = read_web("lib/i18n.ts")
        for key in [
            "common.terminal",
            "common.noOutput",
            "diff.noDiff",
            "tabs.events",
            "tabs.diff",
            "tabs.result",
            "statusBar.workers",
            "statusBar.tasks",
            "statusBar.cli",
        ]:
            self.assertIn(key, i18n)

    def test_sidebar_does_not_use_negative_letter_spacing(self):
        source = read_web("components/layout/Sidebar.tsx")

        self.assertNotIn("letterSpacing", source)


if __name__ == "__main__":
    unittest.main()
