import os
import tempfile
import unittest


class ConfigServiceTests(unittest.TestCase):
    def test_config_roundtrip_writes_mykey_py(self):
        with tempfile.TemporaryDirectory() as td:
            os.environ["GA_MYKEY_PATH"] = os.path.join(td, "mykey.py")
            from server.app.services.llm_config import load_llm_config, save_llm_config

            payload = {
                "configs": [
                    {
                        "var": "native_oai_config",
                        "kind": "native_oai",
                        "data": {"name": "gpt", "apikey": "sk-test", "apibase": "https://api.example/v1", "model": "gpt-demo"},
                    }
                ],
                "extras": {"proxy": "http://127.0.0.1:7890"},
            }
            save_llm_config(payload)
            loaded = load_llm_config(mask_secrets=False)
            self.assertEqual(loaded["configs"][0]["data"]["apikey"], "sk-test")
            with open(os.environ["GA_MYKEY_PATH"], encoding="utf-8") as f:
                self.assertIn("native_oai_config", f.read())

            masked = load_llm_config(mask_secrets=True)
            self.assertEqual(masked["configs"][0]["data"]["apikey"], "sk-...test")


if __name__ == "__main__":
    unittest.main()
