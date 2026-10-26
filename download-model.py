#!/usr/bin/env python3
"""Download the pinned Turbo model once; the app itself remains offline."""
import hashlib
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parent
LOCK = json.loads((ROOT / "model-lock.json").read_text())
DESTINATION = ROOT / "models/large-v3-turbo"


def verified(path, item):
    if not path.is_file() or path.stat().st_size != item["size"]:
        return False
    if item.get("lfs"):
        digest = hashlib.sha256()
        expected = item["lfs"]["sha256"]
    else:
        digest = hashlib.sha1()
        digest.update(f"blob {item['size']}\0".encode())
        expected = item["blobId"]
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest() == expected


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    # Small config files first; interrupted large downloads can be resumed.
    for item in sorted(LOCK["files"], key=lambda f: f["size"]):
        name = item["rfilename"]
        if Path(name).name != name:
            raise SystemExit("Invalid file in model lock")
        target = DESTINATION / name
        if verified(target, item):
            print(f"Verified existing {name}", flush=True)
            continue
        partial = target.with_name(name + ".part")
        url = f"https://huggingface.co/{LOCK['repo']}/resolve/{LOCK['revision']}/{name}?download=true"
        print(f"Downloading {name} ({item['size'] / 1e6:.1f} MB)", flush=True)
        process = subprocess.Popen([
            "curl", "--fail", "--location", "--silent", "--show-error", "--retry", "4",
            "--retry-delay", "2", "--connect-timeout", "30", "--continue-at", "-",
            "--output", str(partial), url,
        ])
        last_report = time.monotonic()
        while process.poll() is None:
            time.sleep(1)
            if time.monotonic() - last_report >= 20:
                size = partial.stat().st_size if partial.exists() else 0
                print(f"  {name}: {size / 1e6:.0f} / {item['size'] / 1e6:.0f} MB", flush=True)
                last_report = time.monotonic()
        if process.returncode != 0:
            raise SystemExit("Download interrupted. Run this script again to resume.")
        if not verified(partial, item):
            raise SystemExit(f"Checksum mismatch for {name}; the model was not activated.")
        partial.replace(target)
        print(f"Verified {name}", flush=True)
    print(f"Model ready: {DESTINATION}", flush=True)


if __name__ == "__main__":
    main()
