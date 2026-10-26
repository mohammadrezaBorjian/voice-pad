#!/bin/sh
# Double-click this file in Finder after running setup.sh once.
set -eu
VOICE_PAD_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec /bin/sh "$VOICE_PAD_ROOT/run.sh" "$@"
