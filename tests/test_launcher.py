import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("voice_launch", Path(__file__).parents[1] / "launch.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class LauncherTests(unittest.TestCase):
    def test_mac_opens_default_browser_without_linux_commands(self):
        with patch.object(app.sys, "platform", "darwin"), patch.object(app.subprocess, "run") as run:
            app.open_window("http://127.0.0.1:8791")
            run.assert_called_once_with(["open", "http://127.0.0.1:8791"], check=True)

    def test_mac_cache_location(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(app.sys, "platform", "darwin"):
            self.assertEqual(app.cache_directory(), Path.home() / "Library/Caches/voice-pad")

    def test_prefers_project_environment_without_machine_specific_paths(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            root = Path(folder)
            python = root / ".venv/bin/python"
            python.parent.mkdir(parents=True)
            python.touch()
            with patch.object(app, "ROOT", root):
                self.assertEqual(app.find_python(), python)

    def test_explicit_python_override_and_missing_path(self):
        with tempfile.TemporaryDirectory() as folder:
            python = Path(folder) / "python"
            python.touch()
            with patch.dict(os.environ, {"VOICE_PAD_PYTHON": str(python)}):
                self.assertEqual(app.find_python(), python)
            with patch.dict(os.environ, {"VOICE_PAD_PYTHON": str(python) + ".missing"}):
                with self.assertRaises(SystemExit):
                    app.find_python()

    def test_first_install_gives_setup_instruction(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            with patch.object(app, "ROOT", Path(folder)), patch.object(app.importlib.util, "find_spec", return_value=None):
                with self.assertRaisesRegex(SystemExit, "bash setup.sh"):
                    app.find_python()


if __name__ == "__main__":
    unittest.main()
