#!/bin/sh
# Mock CV dependencies only. No GPU, no model download. ADR 0016.
set -eu
cd "$(dirname "$0")/.."
stamp=".venv-cv/.requirements-stamp"
hash=$(sha256sum services/cv/requirements.txt | awk '{print $1}')
if [ ! -x .venv-cv/bin/python ] || [ "$(cat "$stamp" 2>/dev/null || true)" != "$hash" ]; then
  python3 -m venv .venv-cv
  .venv-cv/bin/pip install --require-hashes -r services/cv/requirements.txt
  printf '%s\n' "$hash" > "$stamp"
fi
