import importlib
import os
import tempfile
import unittest
from pathlib import Path


class AstraTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["ASTRA_DATA_DIR"] = self.tmp.name
        import assistant
        self.app = importlib.reload(assistant)
        self.app.init_db()

    def tearDown(self):
        self.tmp.cleanup()

    def test_rules_persist_in_prompt(self):
        with self.app.connect() as db:
            db.execute("INSERT INTO rules(text,created_at) VALUES (?,?)", ("Responder de forma curta", self.app.now()))
        self.assertIn("Responder de forma curta", self.app.system_prompt())

    def test_file_changes_stay_in_user_profile(self):
        with self.assertRaises(ValueError):
            self.app.user_path(str(Path.home().parent / "outside.txt"))

    def test_tools_are_logged(self):
        result = self.app.execute_tool("verificar disco", "system_snapshot", {})
        self.assertIn("drives", result)
        self.assertEqual(len(self.app.rows("SELECT * FROM actions")), 1)


if __name__ == "__main__":
    unittest.main()
