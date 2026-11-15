import importlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


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

    def test_repair_uses_elevation_instead_of_returning_commands(self):
        with patch.object(self.app, "run_elevated_action", return_value={"success": True}) as elevated:
            result = self.app.run_repair("dns_cache")
        elevated.assert_called_once_with("repair_dns_cache")
        self.assertTrue(result["success"])
        self.assertIn("Não devolva comandos", self.app.system_prompt())

    def test_elevated_helper_rejects_result_outside_data(self):
        with self.assertRaises(ValueError):
            self.app.elevated_main("repair_dns_cache", str(Path(self.tmp.name).parent / "outside.json"))

    def test_explicit_repair_runs_even_if_model_only_suggests_commands(self):
        responses = [{"message": {"content": "Abra o prompt e use ipconfig /flushdns"}},
                     {"message": {"content": "Limpei o cache DNS com sucesso."}}]
        with patch.object(self.app, "request_json", side_effect=responses), \
             patch.object(self.app, "execute_tool", return_value={"success": True}) as execute:
            result = self.app.chat("Corrija o erro de DNS", save=False)
        execute.assert_called_once_with("Corrija o erro de DNS", "run_repair", {"name": "dns_cache"})
        self.assertEqual(result["answer"], "Limpei o cache DNS com sucesso.")
        self.assertIsNone(self.app.requested_repair("Como corrigir erros de DNS?"))

    def test_windows_command_output_decodes_sfc_and_dism(self):
        message = "A Proteção de Recursos do Windows não encontrou erros."
        self.assertEqual(self.app.decode_command_output(message.encode("utf-16-le")), message)
        self.assertEqual(self.app.decode_command_output(message.encode("oem")), message)


if __name__ == "__main__":
    unittest.main()
