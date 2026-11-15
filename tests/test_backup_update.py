import io
import json
import sqlite3
import tempfile
import unittest
import zipfile
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import backup
import updater


class BackupUpdateTests(unittest.TestCase):
    def test_backup_restore_and_checksum(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            db_path = base / "astra.db"
            with closing(sqlite3.connect(db_path)) as db:
                db.execute("CREATE TABLE rules(text TEXT)")
                db.execute("INSERT INTO rules VALUES ('regra original')")
                db.commit()
            result = backup.snapshot(db_path, base / "local", base / "cloud")
            self.assertEqual(backup.digest(Path(result["cloud"])), result["sha256"])
            with closing(sqlite3.connect(db_path)) as db:
                db.execute("DELETE FROM rules")
                db.commit()
            backup.restore(Path(result["cloud"]), db_path)
            with closing(sqlite3.connect(db_path)) as db:
                self.assertEqual(db.execute("SELECT text FROM rules").fetchone()[0], "regra original")

    def test_invalid_backup_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            bad = Path(root) / "bad.sqlite3"
            bad.write_text("não é sqlite", encoding="utf-8")
            with self.assertRaises(ValueError):
                backup.restore(bad, Path(root) / "astra.db")

    def test_update_stage_accepts_only_expected_files(self):
        with tempfile.TemporaryDirectory() as root:
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, "w") as package:
                for name in updater.APP_FILES:
                    content = (updater.ROOT / name).read_bytes()
                    if name == "version.json":
                        content = json.dumps({"version": "0.1.1", "repository": "WeikathLP/astra-assistente"}).encode()
                    package.writestr("repo-123/" + name, content)
            payload = archive.getvalue()
            with patch.object(updater, "DATA", Path(root)), patch.object(updater, "open_url", return_value=io.BytesIO(payload)):
                staged = updater.stage_release({"version": "0.1.1", "url": "https://api.github.com/example"})
            self.assertTrue((staged / "assistant.py").is_file())
            self.assertEqual(json.loads((staged / "version.json").read_text())["version"], "0.1.1")


if __name__ == "__main__":
    unittest.main()
