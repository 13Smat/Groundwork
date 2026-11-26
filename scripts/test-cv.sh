#!/bin/sh
# Contract tests for the mock CV service. No GPU, no model download, no rasterio.
set -eu
cd "$(dirname "$0")/.."
stamp=".venv-cv/.requirements-stamp"
hash=$(sha256sum services/cv/requirements.txt | awk '{print $1}')
if [ ! -x .venv-cv/bin/python ] || [ "$(cat "$stamp" 2>/dev/null || true)" != "$hash" ]; then
  python3 -m venv .venv-cv
  .venv-cv/bin/pip install --require-hashes -r services/cv/requirements.txt
  printf '%s\n' "$hash" > "$stamp"
fi
PYTHONPATH=services/cv .venv-cv/bin/python -m pytest services/cv/tests -q
