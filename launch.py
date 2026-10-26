#!/usr/bin/env python3
"""Start/reuse the local server, then open Voice Pad on macOS or Linux."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent


def find_python():
    override = os.environ.get("VOICE_PAD_PYTHON")
    if override:
        path = Path(override).expanduser()
        if path.is_file():
            return path
        raise SystemExit("VOICE_PAD_PYTHON does not exist: " + str(path))
    project_python = ROOT / ".venv/bin/python"
    if project_python.is_file():
        return project_python
    if importlib.util.find_spec("faster_whisper") is not None:
        return Path(sys.executable)
    raise SystemExit("Run 'bash setup.sh' once to install Voice Pad, then 'bash run.sh'.")


def cache_directory():
    override = os.environ.get("XDG_CACHE_HOME")
    if override:
        return Path(override).expanduser() / "voice-pad"
    if sys.platform == "darwin":
        return Path.home() / "Library/Caches/voice-pad"
    return Path.home() / ".cache/voice-pad"


def open_window(url):
    if sys.platform == "darwin":
        subprocess.run(["open", url], check=True)
        return
    if not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        print("No graphical session detected. Open the URL above in your browser.")
        return
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        browser = shutil.which(name)
        if browser:
            subprocess.Popen([browser, "--app=" + url, "--new-window"],
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
            return
    opener = shutil.which("xdg-open")
    if opener:
        subprocess.Popen([opener, url], stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
    else:
        print("Open the URL above in your browser.")


def status(url):
    try:
        with urllib.request.urlopen(url + "/api/status", timeout=1) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-open", action="store_true", help="Only start the server")
    parser.add_argument("--port", type=int, default=int(os.environ.get("VOICE_PAD_PORT", 8791)))
    args = parser.parse_args()
    url = f"http://127.0.0.1:{args.port}"
    current = status(url)
    if current and current.get("app") != "voice-pad":
        raise SystemExit("This port is used by another app. Set VOICE_PAD_PORT.")
    if not current:
        python = find_python()
        model = Path(os.environ.get("VOICE_PAD_MODEL", str(ROOT / "models/large-v3-turbo"))).expanduser()
        if not (model / "model.bin").is_file():
            raise SystemExit("Model not installed. Run 'bash setup.sh' once.")
        cache = cache_directory()
        cache.mkdir(parents=True, exist_ok=True)
        with (cache / "server.log").open("ab") as log:
            process = subprocess.Popen(
                [str(python), str(ROOT / "server.py"), "--port", str(args.port)],
                cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                start_new_session=True,
            )
        for _ in range(60):
            current = status(url)
            if current and current.get("app") == "voice-pad":
                break
            if process.poll() is not None:
                raise SystemExit(f"Server did not start. See {cache / 'server.log'}")
            time.sleep(0.25)
        else:
            raise SystemExit(f"Server did not start. See {cache / 'server.log'}")
    print(url)
    if args.no_open:
        return
    open_window(url)


if __name__ == "__main__":
    main()
