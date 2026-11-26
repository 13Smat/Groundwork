#!/bin/sh
# Mock segmentation service for Playwright. CV_BACKEND=mock. No weights.
set -eu
cd "$(dirname "$0")/.."
sh scripts/ensure-cv-venv.sh
export PYTHONPATH=services/cv
export CV_BACKEND=mock
exec .venv-cv/bin/python -m uvicorn groundwork_cv.main:app --host 127.0.0.1 --port 8090 --log-level warning
