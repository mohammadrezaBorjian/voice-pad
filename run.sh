#!/bin/sh
set -eu
VOICE_PAD_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${VOICE_PAD_PYTHON:-}" ]; then
    exec "$VOICE_PAD_PYTHON" "$VOICE_PAD_ROOT/launch.py" "$@"
elif [ -x "$VOICE_PAD_ROOT/.venv/bin/python" ]; then
    exec "$VOICE_PAD_ROOT/.venv/bin/python" "$VOICE_PAD_ROOT/launch.py" "$@"
else
    exec python3 "$VOICE_PAD_ROOT/launch.py" "$@"
fi
