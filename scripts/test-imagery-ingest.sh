#!/bin/sh
# Unit tests for the imagery ingest CLI. Fixtures only. No live tile download.
set -eu
cd "$(dirname "$0")/.."
stamp=".venv-imagery/.requirements-stamp"
hash=$(sha256sum services/imagery-ingest/requirements.txt | awk '{print $1}')
if [ ! -x .venv-imagery/bin/python ] || [ "$(cat "$stamp" 2>/dev/null || true)" != "$hash" ]; then
  python3 -m venv .venv-imagery
  .venv-imagery/bin/pip install --require-hashes -r services/imagery-ingest/requirements.txt
  printf '%s\n' "$hash" > "$stamp"
fi
PYTHONPATH=services/imagery-ingest .venv-imagery/bin/python -m unittest discover -s services/imagery-ingest/tests -v
