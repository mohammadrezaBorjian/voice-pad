#!/bin/sh
# Install into this project's own environment on macOS or Linux.
set -eu
VOICE_PAD_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VOICE_PAD_VENV="$VOICE_PAD_ROOT/.venv"
command -v curl >/dev/null 2>&1 || { echo 'curl is required to download the model.' >&2; exit 1; }

if command -v uv >/dev/null 2>&1; then
    if [ ! -x "$VOICE_PAD_VENV/bin/python" ]; then
        uv venv --python "${VOICE_PAD_SETUP_PYTHON:-3.12}" "$VOICE_PAD_VENV"
    fi
    uv pip install --python "$VOICE_PAD_VENV/bin/python" -r "$VOICE_PAD_ROOT/requirements.txt"
else
    VOICE_PAD_BOOTSTRAP="${VOICE_PAD_SETUP_PYTHON:-}"
    if [ -z "$VOICE_PAD_BOOTSTRAP" ]; then
        for candidate in python3.12 python3.13 python3.11 python3; do
            if command -v "$candidate" >/dev/null 2>&1; then
                VOICE_PAD_BOOTSTRAP="$candidate"
                break
            fi
        done
    fi
    if [ -z "$VOICE_PAD_BOOTSTRAP" ]; then
        echo 'Install Python 3.12 first (on macOS: brew install python@3.12), then run bash setup.sh.' >&2
        exit 1
    fi
    "$VOICE_PAD_BOOTSTRAP" -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10+ is required; Python 3.12 is recommended."'
    if [ ! -x "$VOICE_PAD_VENV/bin/python" ]; then
        "$VOICE_PAD_BOOTSTRAP" -m venv "$VOICE_PAD_VENV"
    fi
    "$VOICE_PAD_VENV/bin/python" -m pip install --disable-pip-version-check -r "$VOICE_PAD_ROOT/requirements.txt"
fi

"$VOICE_PAD_VENV/bin/python" "$VOICE_PAD_ROOT/download-model.py"
printf '\nSetup complete. Start Voice Pad with: bash run.sh\n'
