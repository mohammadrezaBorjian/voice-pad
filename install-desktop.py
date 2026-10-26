#!/usr/bin/env python3
"""Install a launcher in the Linux applications menu and on the desktop."""
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
if sys.platform != "linux":
    raise SystemExit("This installer is for Linux. On macOS use 'bash run.sh' or Voice Pad.command.")


def quote(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$').replace('%', '%%') + '"'


content = (
    "[Desktop Entry]\nType=Application\nVersion=1.0\n"
    "Name=واژه — گفتار به نوشتار\nName[en]=Voice Pad\n"
    "Comment=Offline live voice to text with local Whisper\n"
    f"Exec={quote(sys.executable)} {quote(root / 'launch.py')}\n"
    f"Icon={root / 'static/icon.svg'}\n"
    "Terminal=false\nCategories=AudioVideo;Audio;Utility;\n"
    "StartupWMClass=127.0.0.1\n"
)
applications = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / "applications"
applications.mkdir(parents=True, exist_ok=True)
launcher = applications / "voice-pad.desktop"
launcher.write_text(content, encoding="utf-8")
launcher.chmod(0o755)
try:
    desktop = Path(subprocess.check_output(["xdg-user-dir", "DESKTOP"], text=True).strip())
except (OSError, subprocess.CalledProcessError):
    desktop = Path.home() / "Desktop"
if desktop.is_dir() and desktop != Path.home():
    target = desktop / launcher.name
    target.write_text(content, encoding="utf-8")
    target.chmod(0o755)
    try:
        subprocess.run(["gio", "set", str(target), "metadata::trusted", "true"], check=False)
    except OSError:
        pass
print(f"Installed: {launcher}")
